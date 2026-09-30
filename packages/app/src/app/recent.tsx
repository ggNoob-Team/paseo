import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { RecentScreen } from "@/screens/recent-screen";

export default function RecentRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <RecentScreen />
    </HostRouteBootstrapBoundary>
  );
}
