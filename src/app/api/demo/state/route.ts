import { NextResponse } from "next/server";
import { handleApiError, resolveDemoActorFromRequest } from "@/lib/demoAuth";
import { getDemoStore } from "@/lib/demoStore";

export async function GET(request: Request) {
  try {
    const store = getDemoStore();
    const actor = resolveDemoActorFromRequest(request);
    const personas = store.listDemoPersonas();

    if (!actor) {
      return NextResponse.json(
        {
          authenticated: false,
          actor: null,
          personas,
          publicTools: store.listPublicAvailableTools(),
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const tools = store.listAuthenticatedTools(actor);
    const myListings = store.listMyListings(actor);
    const myRequests = store.listMyRequests(actor);
    const incomingRequests = store.listIncomingRequests(actor);
    const adminLoans =
      actor.role === "admin" ? store.listAllLoansAdmin(actor) : undefined;
    const adminUsers =
      actor.role === "admin" ? store.listUsersForAdmin(actor) : undefined;

    return NextResponse.json(
      {
        authenticated: true,
        actor,
        personas,
        publicTools: store.listPublicAvailableTools(),
        tools,
        myListings,
        myRequests,
        incomingRequests,
        adminLoans,
        adminUsers,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
