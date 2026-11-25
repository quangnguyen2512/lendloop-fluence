import { LendLoopShell } from "@/components/LendLoopShell";
import { isCloudStackConfigured } from "@/lib/runtimeConfig";

export default function HomePage() {
  const cloudEnabled = isCloudStackConfigured();
  return <LendLoopShell cloudEnabled={cloudEnabled} />;
}
