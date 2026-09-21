# Archify

Archify turns a typed JSON specification into a self-contained interactive HTML diagram. Paseo
ships the upstream runtime under `skills/paseo-archify` and exposes it as a built-in workspace
panel. The directory name is namespaced because Paseo manages this skill in the same agent homes a
user may already use for an upstream `archify` installation.

## Generation flow

The panel does not statically analyze source code. It creates an independent agent with the
`paseo.archify.generator` label. The agent reads the workspace, uses the `paseo-archify` skill to
author a schema-valid specification, then calls the `archify_render` Paseo tool once per artifact.

`archify_render` resolves the caller agent's workspace, writes the specification to
`$PASEO_HOME/archify/<workspaceId>/<artifactId>/spec.json`, runs the vendored
`archify deliver ... --quality showcase` command, and writes `metadata.json` and `receipt.json`
only after delivery succeeds. A failed candidate leaves any previous successful artifact untouched.

The first open of a workspace writes `.initialized` and returns `autoGenerate: true`. The panel uses
that one-shot signal to create the initial architecture, method-call, and variable-flow diagrams.
Later opens return stored artifacts and do not spend another agent run.

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
