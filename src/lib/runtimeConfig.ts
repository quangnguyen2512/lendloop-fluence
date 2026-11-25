export function isClerkConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.trim().length > 0
  );
}

export function isConvexConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CONVEX_URL &&
      process.env.NEXT_PUBLIC_CONVEX_URL.trim().length > 0
  );
}

export function isCloudStackConfigured(): boolean {
  return isClerkConfigured() && isConvexConfigured();
}

export function getAutomationHmacSecret(): string | undefined {
  const configured = process.env.LENDLOOP_HMAC_SECRET?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }
  // In local demo mode only (when cloud stack is not linked), allow a deterministic
  // local demo secret so developers can exercise HMAC signing immediately out of the box.
  if (!isCloudStackConfigured() && process.env.NODE_ENV !== "production") {
    return "lendloop-local-demo-secret-do-not-use-in-prod";
  }
  return undefined;
}
