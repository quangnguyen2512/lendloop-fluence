import { NextResponse } from "next/server";
import { getDemoStore } from "@/lib/demoStore";

/**
 * Unauthenticated public endpoint enforcing strict data minimization:
 * returns ONLY available tools with `{ id, name, category }`.
 */
export async function GET() {
  const tools = getDemoStore().listPublicAvailableTools();
  return NextResponse.json(
    { tools },
    { headers: { "Cache-Control": "no-store" } }
  );
}
