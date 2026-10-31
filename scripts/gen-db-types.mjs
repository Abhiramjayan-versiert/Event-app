#!/usr/bin/env node
/**
 * Generates src/lib/database.types.ts in the same shape as `supabase gen types`
 * by introspecting a PostgreSQL database that has the migrations applied.
 *
 *   DATABASE_URL=postgresql://postgres@localhost:54322/eventapp_rls_test npm run db:types
 *
 * Works without Docker / the Supabase CLI. With the CLI available you can use
 * `supabase gen types typescript --local > src/lib/database.types.ts` instead.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgresql://postgres@localhost:54322/eventapp_rls_test";
const out = path.resolve(import.meta.dirname, "../src/lib/database.types.ts");
const client = new pg.Client({ connectionString: url });
await client.connect();

const q = async (sql, params) => (await client.query(sql, params)).rows;

const enums = await q(`
  select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
  from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' group by t.typname order by t.typname`);
const enumNames = new Set(enums.map((e) => e.name));

const columns = await q(`
  select c.relname as table, a.attname as column, a.attnum,
         format_type(a.atttypid, a.atttypmod) as formatted,
         t.typname as type, t.typcategory as category, et.typname as elem_type,
         not a.attnotnull as nullable,
         a.atthasdef as has_default, a.attidentity <> '' as is_identity, a.attgenerated <> '' as is_generated
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_type t on t.oid = a.atttypid
  left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
  where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
  order by c.relname, a.attnum`);

const fks = await q(`
  select con.conname as name, c.relname as table, rc.relname as ref_table,
         array(select att.attname from unnest(con.conkey) k join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k order by att.attname)::text[] as cols,
         array(select att.attname from unnest(con.confkey) k join pg_attribute att on att.attrelid = con.confrelid and att.attnum = k)::text[] as ref_cols,
         exists (
           select 1 from pg_index i
           where i.indrelid = con.conrelid and i.indisunique and i.indpred is null
             and (select array_agg(x order by x) from unnest(i.indkey::int2[]) x) = (select array_agg(x order by x) from unnest(con.conkey) x)
         ) as one_to_one
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
  join pg_class rc on rc.oid = con.confrelid join pg_namespace rn on rn.oid = rc.relnamespace
  where con.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'
  order by c.relname, con.conname`);

const functions = await q(`
  select p.proname as name,
         -- Input argument names only (RETURNS TABLE columns are also in proargnames).
         array(select a.name from unnest(coalesce(p.proargnames, '{}')::text[]) with ordinality a(name, ord)
               where p.proargmodes is null or p.proargmodes[a.ord] in ('i', 'b') order by a.ord) as arg_names,
         -- RETURNS TABLE / OUT columns as [name, typname] pairs.
         array(select json_build_array(a.name, t2.typname)::text
               from unnest(coalesce(p.proargnames, '{}')::text[], coalesce(p.proallargtypes, '{}')::oid[]) with ordinality a(name, typ, ord)
               join pg_type t2 on t2.oid = a.typ
               where p.proargmodes is not null and p.proargmodes[a.ord] in ('t', 'o') order by a.ord) as out_cols,
         array(select format_type(x, null) from unnest(p.proargtypes::oid[]) x) as arg_types,
         array(select t.typname::text from unnest(p.proargtypes::oid[]) with ordinality x(oid, ord) join pg_type t on t.oid = x.oid order by x.ord) as arg_typnames,
         p.pronargdefaults as n_defaults,
         t.typname as return_type, p.proretset as returns_set
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
  where n.nspname = 'public' and p.prokind = 'f' and t.typname <> 'trigger'
  order by p.proname`);

await client.end();

const scalar = (typname) => {
  if (enumNames.has(typname)) return `Database["public"]["Enums"]["${typname}"]`;
  switch (typname) {
    case "int2": case "int4": case "int8": case "float4": case "float8": case "numeric": return "number";
    case "bool": return "boolean";
    case "json": case "jsonb": return "Json";
    case "void": return "undefined";
    default: return "string";
  }
};
const tsType = (col) => (col.category === "A" ? `${scalar(col.elem_type)}[]` : scalar(col.type));

const tables = new Map();
for (const c of columns) {
  if (!tables.has(c.table)) tables.set(c.table, []);
  tables.get(c.table).push(c);
}

const ind = (n) => "  ".repeat(n);
let o = `// AUTO-GENERATED by scripts/gen-db-types.mjs — do not edit by hand.\n// Regenerate with \`npm run db:types\` after changing migrations.\n\n`;
o += `export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];\n\n`;
o += `export type Database = {\n${ind(1)}__InternalSupabase: { PostgrestVersion: "12" };\n${ind(1)}public: {\n${ind(2)}Tables: {\n`;

for (const [table, cols] of tables) {
  o += `${ind(3)}${table}: {\n`;
  o += `${ind(4)}Row: {\n`;
  for (const c of cols) o += `${ind(5)}${c.column}: ${tsType(c)}${c.nullable ? " | null" : ""};\n`;
  o += `${ind(4)}};\n${ind(4)}Insert: {\n`;
  for (const c of cols) {
    if (c.is_generated) { o += `${ind(5)}${c.column}?: never;\n`; continue; }
    const optional = c.nullable || c.has_default || c.is_identity;
    o += `${ind(5)}${c.column}${optional ? "?" : ""}: ${tsType(c)}${c.nullable ? " | null" : ""};\n`;
  }
  o += `${ind(4)}};\n${ind(4)}Update: {\n`;
  for (const c of cols) {
    if (c.is_generated) { o += `${ind(5)}${c.column}?: never;\n`; continue; }
    o += `${ind(5)}${c.column}?: ${tsType(c)}${c.nullable ? " | null" : ""};\n`;
  }
  o += `${ind(4)}};\n${ind(4)}Relationships: [\n`;
  for (const fk of fks.filter((f) => f.table === table)) {
    o += `${ind(5)}{\n${ind(6)}foreignKeyName: "${fk.name}";\n${ind(6)}columns: [${fk.cols.map((x) => `"${x}"`).join(", ")}];\n`;
    o += `${ind(6)}isOneToOne: ${fk.one_to_one};\n${ind(6)}referencedRelation: "${fk.ref_table}";\n`;
    o += `${ind(6)}referencedColumns: [${fk.ref_cols.map((x) => `"${x}"`).join(", ")}];\n${ind(5)}},\n`;
  }
  o += `${ind(4)}];\n${ind(3)}};\n`;
}
o += `${ind(2)}};\n${ind(2)}Views: { [_ in never]: never };\n${ind(2)}Functions: {\n`;
for (const f of functions) {
  const required = f.arg_names.length - f.n_defaults;
  const args = f.arg_names.map((n, i) => `${n}${i >= required ? "?" : ""}: ${f.arg_typnames[i].startsWith("_") ? `${scalar(f.arg_typnames[i].slice(1))}[]` : scalar(f.arg_typnames[i])}`);
  o += `${ind(3)}${f.name}: {\n${ind(4)}Args: ${args.length ? `{ ${args.join("; ")} }` : "never"};\n`;
  const outCols = f.out_cols.map((c) => JSON.parse(c));
  const returns = outCols.length
    ? `{ ${outCols.map(([n, t]) => `${n}: ${t.startsWith("_") ? `${scalar(t.slice(1))}[]` : scalar(t)}`).join("; ")} }`
    : scalar(f.return_type);
  o += `${ind(4)}Returns: ${returns}${f.returns_set ? "[]" : ""};\n${ind(3)}};\n`;
}
o += `${ind(2)}};\n${ind(2)}Enums: {\n`;
for (const e of enums) o += `${ind(3)}${e.name}: ${e.labels.map((l) => `"${l}"`).join(" | ")};\n`;
o += `${ind(2)}};\n${ind(2)}CompositeTypes: { [_ in never]: never };\n${ind(1)}};\n};\n\n`;
o += `type PublicSchema = Database["public"];
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
`;
o += `\nexport const Constants = {\n${ind(1)}public: {\n${ind(2)}Enums: {\n`;
for (const e of enums) o += `${ind(3)}${e.name}: [${e.labels.map((l) => `"${l}"`).join(", ")}],\n`;
o += `${ind(2)}},\n${ind(1)}},\n} as const;\n`;

writeFileSync(out, o);
console.log(`Wrote ${out} (${tables.size} tables, ${functions.length} functions, ${enums.length} enums)`);
