import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { NoteDetailScreen } from "@/screens/note-detail-screen";

export default function NoteDetailRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <NoteDetailScreen />
    </HostRouteBootstrapBoundary>
  );
}
