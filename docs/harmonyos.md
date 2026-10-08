# HarmonyOS

`packages/harmony` packages the web app for HarmonyOS. It is an ArkTS Stage-model
project whose only job is to serve the Expo web build of `packages/app` from
`rawfile/` over a custom scheme and load it in a single `Web` component.

There is no app logic in the HarmonyOS code. Connections, pairing links, the
terminal, and the file panes all run in the web app, exactly as they do in a
browser. If you find yourself adding a feature to `Index.ets`, check whether the
web app already has it.

The module is deliberately **not** an npm workspace. It has `oh-package.json5`
instead of `package.json`; adding it to `workspaces` breaks `npm ci`. The root
`harmony:*` scripts call into `packages/harmony/scripts/` directly.

## Layout

| Path                                               | What it is                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| `entry/src/main/ets/pages/Index.ets`               | The `Web` component: request interception, permissions, back key |
| `entry/src/main/ets/web/rawfile-assets.ets`        | `paseo://app/*` → rawfile mapping and MIME table                 |
| `entry/src/main/ets/entryability/EntryAbility.ets` | Registers the scheme, then loads `pages/Index`                   |
| `entry/src/main/resources/rawfile/`                | Generated: the Expo web build, at the rawfile **root**           |
| `AppScope/app.json5`                               | Bundle name, version code, version name                          |

### Why a custom scheme instead of `$rawfile`

Loading `resource://rawfile/index.html` works for assets but gives the page an
opaque origin. Two things break:

- WebSocket connections leave as `Origin: null`, and the daemon rejects any
  origin outside `daemon.cors.allowedOrigins` (`packages/server/src/server/websocket-server.ts`).
- It is not a secure context, so `navigator.clipboard` and `getUserMedia` are
  unavailable.

So the shell registers `paseo://app` as a standard, secure scheme and serves
every request for it out of `rawfile/` from `onInterceptRequest`. That origin is
the same one the packaged desktop renderer uses, and the daemon already allows
it in `fixedAllowedOrigins` (`packages/server/src/server/bootstrap.ts`) — no
daemon config change needed.

Because the scheme is standard, root-absolute URLs resolve the way the web build
expects: `/_expo/...` becomes `paseo://app/_expo/...`, which maps to
`rawfile/_expo/...`. The bundle therefore has to sit at the rawfile root;
nesting it under `rawfile/web/` makes every asset 404. `npm run harmony:verify`
checks that every root-absolute URL in `index.html` and in the JS bundles
resolves inside `rawfile/`.

## Version stamping

`versionCode` and `versionName` come from `packages/app/native-release-version.js`
(the single source of truth for native version math, per [android.md](android.md)).
`npm run harmony:build` writes them into `AppScope/app.json5`, the same way
`expo prebuild` writes them into the Android manifest. Do not edit those fields
by hand.

`bundleName` defaults to `sh.paseo.app`. It has to match the app you create in
AppGallery Connect, and it needs at least three dot-separated segments — the
Android/iOS id `sh.paseo` is rejected by hvigor's schema. Override with
`PASEO_HARMONY_BUNDLE_NAME`.

## Toolchain

Everything lives outside the repo in `~/.paseo-harmony` (override with
`PASEO_HARMONY_HOME`, or point `PASEO_HARMONY_CLT` at an existing install).

```text
~/.paseo-harmony/
  command-line-tools/    # hvigorw, ohpm
  sdk/                   # SDK, laid out as sdk/<platformVersion>/<component>
  signing/               # p12 / cer / p7b + signing.json (never committed)
```

The command line tools are publicly mirrored, no Huawei login needed:

```bash
mkdir -p ~/.paseo-harmony/command-line-tools
curl -L -o /tmp/command-line-tools.tar \
  https://repo.huaweicloud.com/harmonyos/compiler/hvigor/26.0.0.621/command-line-tools.tar
tar -xf /tmp/command-line-tools.tar -C ~/.paseo-harmony/command-line-tools
~/.paseo-harmony/command-line-tools/bin/hvigorw --version   # 6.26.2
```

`command-line-tools/version.txt` names the SDK the tools expect, here
`HarmonyOS SDK: HarmonyOS 26.0.0 Beta2 (... API Version 26 Beta2)`.

The HarmonyOS SDK comes from the [DevEco download center](https://developer.huawei.com/consumer/cn/download/),
which requires a Huawei account login. The OpenHarmony SDK from the public mirror
is a drop-in for building and needs no login:

```bash
curl -L -o /tmp/ohos-sdk.tar.gz \
  https://repo.huaweicloud.com/openharmony/os/7.0-Release/ohos-sdk-windows_linux-public.tar.gz
# → sdk/26.0.0/{ets,js,native,previewer,toolchains}
```

hvigor 6.26.2 only accepts an SDK whose components sit at
`<sdkRoot>/<platformVersion>/<component>` — `sdk/26.0.0/ets`, not
`sdk/26/ets` and not `sdk/default/openharmony/ets`. A component in the wrong
place is filed as "incompatible" and the build fails with
`00308018 The SDK management mode has changed`, which reads like a licensing
error and is really a path error. `entry/src/main/module.json5` also has to use
`deviceTypes: ["default"]`; `phone`/`tablet` only exist in the HarmonyOS SDK.

The OpenHarmony SDK is a substitute for smoke testing, not a guarantee: a hap it
produces targets OpenHarmony devices. Whether a retail HarmonyOS 7 phone accepts
one is the open question this module cannot answer without the device.

## Build

```bash
npm run harmony:web      # export the web app and sync it into rawfile/
npm run harmony:verify   # check rawfile/ is complete and URLs resolve
npm run harmony:build    # full build, produces a .hap
npm run harmony:install  # hdc install -r on the newest built hap
```

Artifacts land in `packages/harmony/build/outputs/hap/`. Pass `--skip-web` to
reuse an existing web export, `--skip-sign` to stop before signing, and
`--assets-only` / `--verify-assets` for the resource-only paths.

To bake a daemon endpoint into the bundle (see below):

```bash
PASEO_HARMONY_DAEMON=localhost:6767 npm run harmony:build
```

## Signing

A hap only installs on a device whose UDID is in its signing profile, and there
is no "install from unknown sources" switch. In AppGallery Connect:

1. Create a project and an app. `bundleName` must match `AppScope/app.json5`
   (`sh.paseo.app` by default).
2. Register the device as a debug device and copy its UDID
   (`hdc shell bm get --udid`).
3. Create a debug certificate (`.cer`), a `.p12` keystore, and a debug profile
   (`.p7b`) that includes the device.
4. Put the three files in `~/.paseo-harmony/signing/` plus a `signing.json`:

```json
{
  "keyAlias": "paseo",
  "keystoreFile": "/home/you/.paseo-harmony/signing/paseo.p12",
  "keystorePwd": "...",
  "keyPwd": "...",
  "appCertFile": "/home/you/.paseo-harmony/signing/paseo.cer",
  "profileFile": "/home/you/.paseo-harmony/signing/paseo.p7b"
}
```

`npm run harmony:build` signs with `hap-sign-tool.jar` from the SDK toolchains
when that file exists, and leaves the hap unsigned otherwise. Signing material
never enters the repo.

## Installing

HarmonyOS has no tap-to-install for a hap. Install over `hdc`, either with the
phone on USB or wirelessly on the same network:

```bash
~/.paseo-harmony/sdk/26.0.0/toolchains/hdc tconn <phone-ip>:<port>
~/.paseo-harmony/sdk/26.0.0/toolchains/hdc install -r <path>.hap
```

The `hdc` binary ships in the SDK toolchains, not in `command-line-tools/bin`.

## Connecting to the daemon

Building and installing do not involve the daemon. It only has to be reachable
when you press Connect:

- **Reverse port forward (recommended).** `hdc rport tcp:6767 tcp:6767`, then
  enter `localhost:6767` in the app. `localhost` is a potentially trustworthy
  origin, so the secure `paseo://app` document is not blocked from opening an
  insecure WebSocket to it.
- **LAN address.** `PASEO_LISTEN=0.0.0.0:6767`, then enter `192.168.1.77:6767`.
  A `ws://` socket to a non-loopback host from a secure origin is mixed content
  and may be refused; prefer the reverse forward.
- **Baked endpoint.** `PASEO_HARMONY_DAEMON=<endpoint> npm run harmony:build`.
  Inlined at bundle time, so changing it needs a rebuild.

Pairing links work as they do on the web: the welcome screen offers a direct
connection and a paste-a-link field. Scanning a pairing QR is native-only and
is not wired up in the shell.

## Known gaps

- No push notifications. `packages/app/src/push-notifications/index.web.ts` is a no-op.
- No QR scanning. The web app shows `pairing.scan.webUnavailableTitle` on non-native platforms.
- The webview suspends when the app is backgrounded, so streams pause.
- Nothing here has been exercised on a device yet: no hap has been installed, and
  no daemon connection has been made from a phone. `window.isSecureContext`,
  IndexedDB, the mic permission prompt, and the file picker are all unverified.
- Downloads are not implemented. `onDownloadStart` only logs; there is no
  `@ohos.request` handler writing into a user-visible directory.
- `entry/oh-package.json5` pins a placeholder `1.0.0` because hvigor's SemVer
  check rejects the app's real `0.x` major. The shipping version is
  `AppScope/app.json5`; the placeholder is inert.
