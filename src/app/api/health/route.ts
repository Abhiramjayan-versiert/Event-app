import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "ok", service: "EVENT APP", time: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
