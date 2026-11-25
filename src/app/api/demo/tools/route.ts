import { NextResponse } from "next/server";
import { handleApiError, resolveDemoActorFromRequest } from "@/lib/demoAuth";
import { getDemoStore } from "@/lib/demoStore";
import type { ToolInput } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const actor = resolveDemoActorFromRequest(request);
    const body = (await request.json()) as ToolInput;
    const tool = getDemoStore().createTool(actor, body);
    return NextResponse.json({ tool }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
