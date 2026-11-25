import { NextResponse } from "next/server";
import { AuthorizationError } from "@/lib/authz";
import { handleApiError, resolveDemoActorFromRequest } from "@/lib/demoAuth";
import { getDemoStore } from "@/lib/demoStore";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const actor = resolveDemoActorFromRequest(request);
    const body = (await request.json()) as {
      action?: "approve" | "decline" | "return" | "cancel";
    };

    const store = getDemoStore();
    let loan;
    switch (body.action) {
      case "approve":
        loan = store.approveLoan(actor, id);
        break;
      case "decline":
        loan = store.declineLoan(actor, id);
        break;
      case "return":
        loan = store.markReturned(actor, id);
        break;
      case "cancel":
        loan = store.cancelRequest(actor, id);
        break;
      default:
        throw new AuthorizationError(
          "BAD_REQUEST",
          "Unsupported loan action. Expected approve, decline, return, or cancel."
        );
    }

    return NextResponse.json({ loan });
  } catch (error) {
    return handleApiError(error);
  }
}
