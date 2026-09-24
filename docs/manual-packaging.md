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

### Local WSL build

Use this path when the GitHub runner is unavailable or repeatedly canceled. The local build needs JDK 17 and an Android SDK with platform 36, build-tools 36, NDK 27.1, and CMake 3.22.1.

Gradle may auto-install additional NDK or build-tools versions required by individual native modules. Keep the accepted SDK licenses under `$ANDROID_HOME/licenses`.

```bash
export JAVA_HOME="$HOME/.sdkman/candidates/java/17.0.20-tem"
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

npm run build:app-deps

cd packages/app
APP_VARIANT=production CI=1 npx expo prebuild --platform android --clean --no-install
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties
```

If the Gradle distribution download times out, place it in `/tmp` and point the generated wrapper at the local file:

```bash
curl -fL --retry 8 --retry-all-errors -C - \
  -o /tmp/gradle-8.14.3-bin.zip \
  https://services.gradle.org/distributions/gradle-8.14.3-bin.zip

python3 - <<'PY'
from pathlib import Path

path = Path("packages/app/android/gradle/wrapper/gradle-wrapper.properties")
path.write_text(
    path.read_text().replace(
        "https\\://services.gradle.org/distributions/gradle-8.14.3-bin.zip",
        "file\\:/tmp/gradle-8.14.3-bin.zip",
    )
)
PY
```

Then build the APK:

```bash
cd packages/app/android
./gradlew :app:assembleRelease --no-daemon --max-workers=4 \
  -PreactNativeArchitectures=arm64-v8a \
  -x lint -x lintVitalAnalyzeRelease -x lintVitalRelease \
  -x generateReleaseLintModel -x generateReleaseLintVitalModel
```

The APK is written to:

```text
packages/app/android/app/build/outputs/apk/release/app-release.apk
```

The first build can take 30-40 minutes. Later builds reuse `~/.gradle` and are faster.

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
