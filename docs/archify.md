# Archify

Archify turns a typed JSON specification into a self-contained interactive HTML diagram. Paseo
ships the upstream runtime under `skills/paseo-archify` and exposes it as a built-in workspace
panel. The directory name is namespaced because Paseo manages this skill in the same agent homes a
user may already use for an upstream `archify` installation.

## Generation flow

The daemon owns a run; the panel only starts it, follows it, and can stop it. A run is gated on the
`archifyGeneration` capability, so a host that predates daemon-owned runs advertises `archify`
alone and the panel asks for an update instead of sending requests the host cannot answer.

Starting a run scans the repository first. The scan is deterministic and uses no model: it collects
workspace packages, entry points, internal dependency edges, and candidate anchors into an evidence
sheet capped at 40 KB. The sheet is cached per workspace revision (git HEAD, branch, and status),
so an unchanged workspace is not scanned twice.

The panel lists the candidate anchors — modules, entry points, and package flows — for the user to
confirm. Confirmed anchors ride along with `archify.generation.start.request` and the prompt makes
every diagram cover them; "Whole workspace" starts a run with no anchor list, and the one-shot
`autoGenerate` signal creates the initial diagrams without the confirmation step.

The daemon then creates one background worker agent per requested diagram, each labelled
`paseo.archify.generator` with its `paseo.archify-type`. Workers run in parallel, each owns one
artifact, and use the provider's unattended mode when the provider advertises one, so repository
inspection and renderer calls do not stop for permission prompts. A worker reads the evidence
sheet, uses the `paseo-archify` skill to author a schema-valid specification, then calls the
`archify_render` Paseo tool for its artifact. Workers are archived when they finish, delivered or
not, so a run leaves nothing behind in the sidebar; a worker that fails only fails its own diagram.

`archify_render` resolves the caller agent's workspace, writes the specification to
`$PASEO_HOME/archify/<workspaceId>/<artifactId>/spec.json`, runs the vendored
`archify deliver ... --quality showcase` command, and writes `metadata.json` and `receipt.json`
only after delivery succeeds. A failed candidate leaves any previous successful artifact untouched.

Every task change is broadcast as `archify.generation.updated` with the stage, the per-diagram
status and timing, the current action line, and the failure reason, so the panel does not poll.
Diagrams land progressively: the first delivery becomes the visible tab until the user picks one,
and the run can be canceled or, once stopped, have its unfinished diagrams rerun.

The first open of a workspace writes `.initialized` and returns `autoGenerate: true`. The panel uses
that one-shot signal to start the initial architecture, method-call, and variable-flow diagrams.
Later opens return stored artifacts and do not spend another agent run. Each successful artifact
has its own viewer tab. When a workspace has several method-call or workflow artifacts, their
specific titles distinguish the variants; legacy or generic titles fall back to the type plus a
one-based ordinal.

## Viewer and search

The generated HTML includes Archify's pan, zoom, focus, relationship, route, reachability, semantic
lens, and guided-view capabilities. Paseo also builds a search index from the stored specification.
It indexes nodes and relationships for all five diagram types, including sequence messages and
dataflow flows. Selecting a result focuses and reveals its endpoint node IDs; a sequence message is
therefore searchable by method name when the generator puts that name in the message label.

Search is limited to authored diagram facts. Route tracing does not infer an edge, method call, or
data flow that the specification did not author.

## Mobile HTML previews

HTML previews call `useBlockMobilePanelOpenGestures(true)` while mounted. Horizontal gestures inside
the preview therefore stay inside the WebView instead of opening the left agent list or right file
explorer. Closing an already-open panel remains available because the blocker only owns the
open-gesture gate.

## Updating upstream

The vendored runtime is pinned to the Archify `v2.16.0` release and keeps its `LICENSE`,
`THIRD_PARTY_NOTICES.md`, schemas, renderers, examples, and viewer template. Update it as one
directory from an official release, then run `node skills/paseo-archify/bin/archify.mjs doctor` and
the focused `packages/server/src/server/archify/service.test.ts` test.
