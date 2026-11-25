import { NextResponse } from "next/server";
import { handleApiError, resolveDemoActorFromRequest } from "@/lib/demoAuth";
import { getDemoStore } from "@/lib/demoStore";
import type { ToolInput } from "@/lib/types";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const actor = resolveDemoActorFromRequest(request);
    const body = (await request.json()) as ToolInput;
    const tool = getDemoStore().updateTool(actor, id, body);
    return NextResponse.json({ tool });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const actor = resolveDemoActorFromRequest(request);
    const result = getDemoStore().deleteTool(actor, id);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
