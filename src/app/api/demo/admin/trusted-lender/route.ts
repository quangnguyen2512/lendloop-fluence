import { NextResponse } from "next/server";
import { handleApiError, resolveDemoActorFromRequest } from "@/lib/demoAuth";
import { getDemoStore } from "@/lib/demoStore";

export async function POST(request: Request) {
  try {
    const actor = resolveDemoActorFromRequest(request);
    const body = (await request.json()) as {
      userId: string;
      isTrustedLender: boolean;
    };
    const user = getDemoStore().toggleTrustedLender(
      actor,
      body.userId,
      Boolean(body.isTrustedLender)
    );
    return NextResponse.json({ user });
  } catch (error) {
    return handleApiError(error);
  }
}
