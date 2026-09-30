import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { NotesScreen } from "@/screens/notes-screen";

export default function NotesRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <NotesScreen />
    </HostRouteBootstrapBoundary>
  );
}
