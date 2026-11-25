import { NextResponse } from "next/server";
import { handleApiError, resolveDemoActorFromRequest } from "@/lib/demoAuth";
import { getDemoStore } from "@/lib/demoStore";

export async function POST(request: Request) {
  try {
    const actor = resolveDemoActorFromRequest(request);
    const body = (await request.json()) as {
      toolId: string;
      startDate: string;
      endDate: string;
      note?: string;
    };
    const loan = getDemoStore().requestBorrow(actor, body);
    return NextResponse.json({ loan }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
