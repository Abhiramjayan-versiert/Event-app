import { Logo } from "@/components/brand/logo";

export const metadata = { title: "Setup required" };

export default function SetupRequiredPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6">
      <Logo size="lg" />
      <div className="space-y-3 rounded-lg border p-6">
        <h1 className="text-lg font-semibold">Connect EVENT APP to Supabase</h1>
        <p className="text-sm text-muted-foreground">
          The application is running but no Supabase project is configured. Set the following environment variables and
          restart the server (or redeploy on Vercel):
        </p>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
          {`NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # server only`}
        </pre>
        <p className="text-sm text-muted-foreground">See docs/deployment.md for the full setup, including migrations and creating the first Super Admin.</p>
      </div>
    </main>
  );
}
