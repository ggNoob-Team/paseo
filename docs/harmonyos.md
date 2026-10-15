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

The `Web` component loads the origin root (`paseo://app/`), not `/index.html`:
Expo Router matches routes against the document path, and an `/index.html`
document path matches no route (its "Unmatched Route" page).

## Links

The shell owns one `Web` component and draws no browser chrome, so a page loaded
into it would have no address bar, no back button, and no way to close it. Links
leave the app instead: `window.open` reaches `onWindowNew`, which refuses the new
window and hands the URL to the system browser, and `onLoadIntercept` does the
same for anything that still tries to navigate the component itself to an
`http(s)` page. The web app keeps its own history, so the system back key walks
that history instead of reloading the bundle.

## Clipboard

ArkWeb's clipboard API asks for a read permission the shell is never granted, so
text the user had just copied read back empty — the notes capture answered "copy
first" to a clipboard that already had the text. The shell injects a pasteboard
bridge (`window.paseoClipboard`, `readText`/`writeText`) and the web app's
`utils/clipboard.ts` prefers it over `expo-clipboard` for both directions. A
shell without the bridge is harmless: the helper falls back to the browser API.

## Version stamping

`versionCode` and `versionName` come from `packages/app/native-release-version.js`
(the single source of truth for native version math, per [android.md](android.md)).
`npm run harmony:build` writes them into `AppScope/app.json5`, the same way
`expo prebuild` writes them into the Android manifest. Do not edit those fields
by hand.

**Every install needs a new version.** HarmonyOS treats a hap whose `versionCode`
matches the installed one as a no-op: the previous rawfile and the previous
compiled ArkTS keep running, so a change that appears to do nothing on the device
usually was never installed. Bump `packages/app/package.json` before the install
you want to land — the build stamps both fields from it.

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

DevEco Studio's bundled SDK uses the rejected `sdk/default/openharmony/...`
shape, so pointing `DEVECO_SDK_HOME` at a DevEco install from WSL fails with
the same `00308018`. Keep the public mirror SDK at `~/.paseo-harmony/sdk`.

The SDK's `releaseType` is copied into the hap as `app.apiReleaseType` and into
`pack.info`, and AppGallery rejects Beta packages at submit with
`205339313 beta api not allowed to submit`. Take the SDK from `7.0-Release`, not
`7.0-Beta1`: the version strings match (`26.0.0.38`), so a Beta SDK produces a
hap that builds, signs, and installs without any sign of trouble and only fails
at submission. Check before uploading:

```bash
unzip -p entry-default-unsigned.hap module.json | grep -o '"apiReleaseType":"[^"]*"'
```

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

The app icon comes from `packages/harmony/assets/app_icon.png`; point
`PASEO_HARMONY_ICON` at another PNG for a one-off package.

## Building in DevEco Studio

DevEco Studio has no Linux build, and its SDK and emulator both live behind a
Huawei account inside the IDE. On Windows or Mac, build there instead of with
the command-line tools:

```bash
npm run harmony:web      # refresh rawfile/; the export copies it as-is
npm run harmony:export   # → packages/harmony/build/paseo-harmony-<version>.zip
```

The script copies the project, adds the hvigor wrapper a DevEco project carries,
and rewrites **only the copy**: `runtimeOS: "HarmonyOS"` (what AGC automatic
signing requires), `compatibleSdkVersion: 12` so any emulator image from API 12
up can install it, and `compileSdkVersion`/`targetSdkVersion` from `--api`
(default `26.0.0`). Caches, `build/`, and signing material are stripped. The repo
copy stays on `OpenHarmony` for the local smoke build.

Then, on the DevEco machine:

1. Unzip it and open the folder with **File > Open**.
2. **File > Project Structure > Signing Configs**, tick **Automatically generate
   signature** and log in with a Huawei account. That creates the AGC app
   (`sh.paseo.app`), the certificate, and a debug profile covering the emulator's
   UDID — no manual AGC work.
3. Run `entry` — the signed hap lands in
   `entry/build/default/outputs/default/`.

If SDK Manager has no API 26, re-export with the highest it does have:
`npm run harmony:export -- --api 20`.

## Signing

There is no "install from unknown sources" switch. A hap installs only when its
signing profile covers the device, and profiles come in two types:

- **调试 (debug)** — covers the devices registered in it and nothing else.
- **发布 (release)** — covers every device, needs no registration, and does not
  require the app to be published. Use it for any hap you hand to someone else.

In AppGallery Connect:

1. Create a project and an app. `bundleName` must match `AppScope/app.json5`
   (`sh.paseo.app` by default).
2. Generate a keystore and a CSR (`keytool`), then create a certificate from
   the CSR — 调试证书 for device-bound builds, 发布证书 for shareable ones.
3. Create a profile of the same type, picking the app and the certificate; a
   debug profile additionally needs its devices registered (`hdc shell bm get
--udid` prints a device's UDID).
4. Put the downloaded certificate (`.cer`, a full chain) and profile (`.p7b`)
   in `~/.paseo-harmony/signing/` alongside the `.p12`, and write
   `signing.json`:

```json
{
  "keyAlias": "paseo",
  "keystoreFile": "/home/you/.paseo-harmony/signing/paseo.p12",
  "keystorePwd": "...",
  "keyPwd": "...",
  "appCertFile": "/home/you/.paseo-harmony/signing/paseo-release.cer",
  "profileFile": "/home/you/.paseo-harmony/signing/paseo-release.p7b"
}
```

`npm run harmony:build` signs with `hap-sign-tool.jar` from the SDK toolchains
when that file exists, and leaves the hap unsigned otherwise. Signing material
never enters the repo. A signed hap can be checked with `verify-app`:

```bash
java -jar ~/.paseo-harmony/sdk/26.0.0/toolchains/lib/hap-sign-tool.jar verify-app \
  -inFile <signed.hap> -outCertChain /tmp/chain.cer -outProfile /tmp/profile.p7b
```

Signing runs on the `java` in `PATH`; override it with `PASEO_HARMONY_JAVA`. JDK
21.0.0 chokes on hvigor's zip64 headers with `Invalid CEN header (invalid zip64
extra data field size)`; 17.0.10+ and 21.0.1+ are fine.

## Installing

HarmonyOS has no tap-to-install for a hap. Install over `hdc`, either with the
phone on USB or wirelessly on the same network:

```bash
~/.paseo-harmony/sdk/26.0.0/toolchains/hdc tconn <phone-ip>:<port>
~/.paseo-harmony/sdk/26.0.0/toolchains/hdc install -r <path>.hap
```

The `hdc` binary ships in the SDK toolchains, not in `command-line-tools/bin`.

### Emulator (Windows)

WSL reaches a DevEco Studio emulator on the same Windows machine when
`.wslconfig` sets `networkingMode=mirrored` (run `wsl --shutdown` from Windows
after the edit, then relaunch the distro): the SDK's Linux `hdc` lists it as
`127.0.0.1:5555` on its own, and `npm run harmony:install` installs to it with
no `tconn` step. Building happens here too — this is the route that does not
need [an export](#building-in-deveco-studio).

The HarmonyOS 7.0.0 emulator image also installs unsigned haps, so emulator
debugging needs no AGC material — `npm run harmony:build --skip-sign`, then
`npm run harmony:install`. Physical devices need a profile that covers them: a
debug profile with their UDID, or a release profile.

## Connecting to the daemon

Building and installing do not involve the daemon. It only has to be reachable
when you press Connect:

- **Reverse port forward (recommended).** `hdc rport tcp:6767 tcp:6767`, then
  enter `localhost:6767` in the app. `localhost` is a potentially trustworthy
  origin, so the secure `paseo://app` document is not blocked from opening an
  insecure WebSocket to it. The forward survives hap reinstalls but not an
  emulator or hdc server restart; re-run it after either. It terminates on the
  machine running the hdc server, so a daemon that runs elsewhere needs an
  extra tunnel (e.g. `ssh -L`) or a pairing link.
- **LAN address.** `PASEO_LISTEN=0.0.0.0:6767`, then enter `192.168.1.77:6767`.
  A `ws://` socket to a non-loopback host from a secure origin is mixed content
  and may be refused; prefer the reverse forward.
- **Baked endpoint.** `PASEO_HARMONY_DAEMON=<endpoint> npm run harmony:build`.
  Inlined at bundle time, so changing it needs a rebuild.

Pairing links work as they do on the web: the welcome screen offers a direct
connection and a paste-a-link field. Scanning a pairing QR is native-only and
is not wired up in the shell; `npm run cli -- pair` prints the daemon's QR code
and link to paste.

## Known gaps

- No push notifications. `packages/app/src/push-notifications/index.web.ts` is a no-op.
- No QR scanning. The web app shows `pairing.scan.webUnavailableTitle` on non-native platforms.
- The webview suspends when the app is backgrounded, so streams pause.
- Verified on the Windows DevEco emulator (HarmonyOS 7.0.0, API 26): the hap
  installs unsigned, renders, and holds a daemon WebSocket over `hdc rport`. A
  physical phone is unverified, including whether it accepts a hap built from
  the public OpenHarmony SDK, `window.isSecureContext`, IndexedDB, the mic
  permission prompt, and the file picker.
- The shell logs the page's `secure`, `idb`, `origin`, and `ua` facts on every
  page load (hilog tag `PaseoHarmony`); read them in DevEco Studio's Log panel
  or with `hdc shell hilog` to check `window.isSecureContext` and IndexedDB on a
  device without a debugger.
- Downloads are not implemented. `onDownloadStart` only logs; there is no
  `@ohos.request` handler writing into a user-visible directory.
- `entry/oh-package.json5` pins a placeholder `1.0.0` because hvigor's SemVer
  check rejects the app's real `0.x` major. The shipping version is
  `AppScope/app.json5`; the placeholder is inert.
