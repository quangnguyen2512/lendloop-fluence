import { NextResponse } from "next/server";
import { AuthorizationError } from "./authz";
import { getDemoStore } from "./demoStore";
import type { Actor } from "./types";

export const DEMO_ACTOR_HEADER = "x-lendloop-demo-user";

export function resolveDemoActorFromRequest(request: Request): Actor | null {
  const userId = request.headers.get(DEMO_ACTOR_HEADER)?.trim();
  if (!userId) {
    return null;
  }
  return getDemoStore().getActorById(userId);
}

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
      },
      { status: error.statusCode }
    );
  }

  return NextResponse.json(
    {
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    },
    { status: 500 }
  );
}
