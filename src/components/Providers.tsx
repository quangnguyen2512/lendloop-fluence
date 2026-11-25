"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useMemo } from "react";

interface ProvidersProps {
  cloudEnabled: boolean;
  convexUrl: string;
  children: React.ReactNode;
}

function ConvexClerkBridge({
  convexUrl,
  children,
}: {
  convexUrl: string;
  children: React.ReactNode;
}) {
  const convex = useMemo(() => new ConvexReactClient(convexUrl), [convexUrl]);

  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}

export function Providers({
  cloudEnabled,
  convexUrl,
  children,
}: ProvidersProps) {
  if (!cloudEnabled) {
    return <>{children}</>;
  }

  return (
    <ClerkProvider>
      <ConvexClerkBridge convexUrl={convexUrl}>{children}</ConvexClerkBridge>
    </ClerkProvider>
  );
}
