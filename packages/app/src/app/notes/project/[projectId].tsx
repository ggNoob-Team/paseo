import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { ProjectNotesScreen } from "@/screens/project-notes-screen";

export default function ProjectNotesRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <ProjectNotesScreen />
    </HostRouteBootstrapBoundary>
  );
}
