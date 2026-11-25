"use client";

import { CloudLendLoopApp } from "./CloudLendLoopApp";
import { DemoLendLoopApp } from "./DemoLendLoopApp";

interface LendLoopShellProps {
  cloudEnabled: boolean;
}

export function LendLoopShell({ cloudEnabled }: LendLoopShellProps) {
  return cloudEnabled ? <CloudLendLoopApp /> : <DemoLendLoopApp />;
}
