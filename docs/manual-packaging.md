# Manual Packaging

Every packaging and deployment workflow in this fork is manual. Pushing to `main` or a version tag does not build, publish, or deploy anything. `CI` is manual too.

## Before you start

Open the repository's **Actions** tab. Select a workflow, choose **Run workflow**, and set **Use workflow from** to the ref that contains the code you want to build. Use `main` for the current fork release.

Artifacts are available from the workflow run page. Desktop artifacts normally expire after seven days.

## Windows

1. Open **Actions** -> **Desktop Release** -> **Run workflow**.
2. Set:

```text
Use workflow from: main
tag: v0.9.0-beta.2
platform: windows
checkout_ref: main
publish: false
rollout_hours: 0
```

The run produces:

- `desktop-windows-installers`: x64 and arm64 NSIS `.exe` installers.
- `desktop-windows`: the full Windows release directory.

The artifacts are unsigned unless Windows signing secrets are configured. SmartScreen can warn on unsigned installers.

CLI equivalent:

```bash
gh workflow run desktop-release.yml \
  -R ggNoob-Team/paseo \
  --ref main \
  -f tag=v0.9.0-beta.2 \
  -f platform=windows \
  -f checkout_ref=main \
  -f publish=false \
  -f rollout_hours=0
```

## macOS

1. Open **Actions** -> **Desktop Release** -> **Run workflow**.
2. Set `platform` to `macos`.

```text
Use workflow from: main
tag: v0.9.0-beta.2
platform: macos
checkout_ref: main
publish: false
rollout_hours: 0
```

The run produces:

- `desktop-macos-arm64`: `Paseo-<version>-arm64.dmg`.
- `desktop-macos-x64`: `Paseo-<version>-x64.dmg`.

Without `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`, the DMGs are unsigned and not notarized. Gatekeeper can warn.

CLI equivalent:

```bash
gh workflow run desktop-release.yml \
  -R ggNoob-Team/paseo \
  --ref main \
  -f tag=v0.9.0-beta.2 \
  -f platform=macos \
  -f checkout_ref=main \
  -f publish=false \
  -f rollout_hours=0
```

## Android APK

Use **Android APK Build** for fork APKs. The EAS-based **Android APK Release** workflow is manual too, but it requires an Expo token and access to the upstream EAS project.

1. Open **Actions** -> **Android APK Build** -> **Run workflow**.
2. Set:

```text
Use workflow from: main
version: 0.9.0-beta.2
architectures: arm64-v8a
```

The run produces the `android-apk` artifact. The default build is arm64-only and installable on current Android phones.

For a universal APK, set `architectures` to a comma-separated list such as:

```text
arm64-v8a,armeabi-v7a,x86_64
```

The fork workflow signs the APK with the Expo-generated debug keystore. It is not suitable for Play Store publishing or upgrading an app installed from the official Paseo release.

CLI equivalent:

```bash
gh workflow run android-apk-build.yml \
  -R ggNoob-Team/paseo \
  --ref main \
  -f version=0.9.0-beta.2 \
  -f architectures=arm64-v8a
```

## Web

Use **Deploy App** for the browser app. It deploys the current `packages/app` web export to the fork's Cloudflare Pages project `paseo-app`.

1. Open **Actions** -> **Deploy App** -> **Run workflow**.
2. Select `main` and run it.

The production Pages URL is:

```text
https://paseo-app-8wq.pages.dev
```

The workflow reads these repository settings:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

CLI equivalent:

```bash
gh workflow run deploy-app.yml \
  -R ggNoob-Team/paseo \
  --ref main
```

Do not use **Deploy Website** for the app web client. It deploys the marketing site through Cloudflare Workers and needs a different account, KV namespace, and Workers token configuration.

## Publishing a GitHub Release

`Desktop Release` creates a GitHub Release only when `platform=all` and `publish=true` are used together. The release starts as a draft and is published after every platform manifest is available.

```text
Use workflow from: main
tag: v0.9.0-beta.3
platform: all
checkout_ref: main
publish: true
rollout_hours: 0
```

This builds Windows, macOS, and Linux desktop artifacts. It does not build the Android APK. Run **Android APK Build** separately if the release needs an APK asset.

For a single-platform retry against an existing draft release, follow the release workflow notes in [release.md](release.md).

## CI

CI is manual now. Use **Actions** -> **CI** -> **Run workflow** when you want to run the full quality and test matrix. CI does not create release artifacts.
