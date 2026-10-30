import { useEffect } from "react";
import { consumeQuickInputLaunch } from "@/quick-input/launch-gate";
import { QuickInputScreen } from "@/screens/quick-input-screen";

export default function HostQuickInputRoute() {
  useEffect(() => {
    consumeQuickInputLaunch();
  }, []);

  return <QuickInputScreen />;
}
