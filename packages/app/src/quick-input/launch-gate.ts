let launchConsumed = false;

export function hasQuickInputLaunchBeenConsumed(): boolean {
  return launchConsumed;
}

export function consumeQuickInputLaunch(): void {
  launchConsumed = true;
}

export function resetQuickInputLaunchGateForTests(): void {
  launchConsumed = false;
}
