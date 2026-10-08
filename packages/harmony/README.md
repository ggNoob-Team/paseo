# @paseo/harmony

HarmonyOS packaging for the Paseo web app.

This module is an ArkTS Stage-model project that serves the Expo web build of
`packages/app` from `rawfile/` over the `paseo://app` scheme and loads it in a
single `Web` component. It contains no app logic and is not part of the npm
workspace.

```bash
npm run harmony:web       # export the web app and sync it into rawfile/
npm run harmony:verify    # check the synced assets resolve
npm run harmony:build     # build a .hap
npm run harmony:install   # hdc install -r
```

See [docs/harmonyos.md](../../docs/harmonyos.md) for toolchain setup, signing,
installation, and the known gaps.
