#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

architectures="arm64-v8a"
clean_prebuild=false
sync_prebuild=false
skip_deps=false
use_daemon=true
install_apk=false
workers=""
heap_mb=""
gradle_zip=""
version=""
output_dir="${PASEO_APK_OUTPUT_DIR:-$HOME/paseo-artifacts}"

usage() {
  cat <<'EOF'
Build an Android release APK from the local Paseo checkout.

Usage:
  ./scripts/build-android-apk.sh [options]

Options:
  --architectures <abi>   Comma-separated React Native ABIs (default: arm64-v8a)
  --version <label>       APK filename version label (default: app package version)
  --output-dir <dir>      Output directory (default: $HOME/paseo-artifacts)
  --workers <count>       Gradle worker count (default: auto, capped at 6)
  --heap <mb>             Gradle JVM heap in MB (default: 4096)
  --gradle-zip <path>     Use an existing Gradle distribution zip
  --clean                 Regenerate the Android project with expo prebuild --clean
  --sync                  Run expo prebuild without --clean
  --skip-deps             Skip npm run build:app-deps
  --no-daemon             Disable the Gradle daemon
  --install               Install the APK after building
  -h, --help              Show this help
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[android-apk] %s\n' "$*"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --architectures)
      architectures="${2:-}"
      shift 2
      ;;
    --version)
      version="${2:-}"
      shift 2
      ;;
    --output-dir)
      output_dir="${2:-}"
      shift 2
      ;;
    --workers)
      workers="${2:-}"
      shift 2
      ;;
    --heap)
      heap_mb="${2:-}"
      shift 2
      ;;
    --gradle-zip)
      gradle_zip="${2:-}"
      shift 2
      ;;
    --clean)
      clean_prebuild=true
      sync_prebuild=true
      shift
      ;;
    --sync)
      sync_prebuild=true
      shift
      ;;
    --skip-deps)
      skip_deps=true
      shift
      ;;
    --no-daemon)
      use_daemon=false
      shift
      ;;
    --install)
      install_apk=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

[[ -n "$architectures" ]] || die "--architectures cannot be empty"

resolve_workers() {
  if [[ -n "$workers" ]]; then
    printf '%s\n' "$workers"
    return
  fi

  local cpus
  cpus="$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || printf '4\n')"
  local resolved=$((cpus / 2))
  ((resolved < 2)) && resolved=2
  ((resolved > 6)) && resolved=6
  printf '%s\n' "$resolved"
}

detect_java17() {
  local candidate major
  for candidate in \
    "${JAVA_HOME:-}" \
    "$HOME/.sdkman/candidates/java/17.0.20-tem" \
    "$HOME/.sdkman/candidates/java/17-tem" \
    "/usr/lib/jvm/java-17-openjdk-amd64"; do
    [[ -n "$candidate" && -x "$candidate/bin/java" ]] || continue
    major="$("$candidate/bin/java" -version 2>&1 | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p' | head -n 1)"
    if [[ "$major" == "17" ]]; then
      export JAVA_HOME="$candidate"
      return 0
    fi
  done

  if [[ -x /usr/libexec/java_home ]]; then
    candidate="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
    if [[ -n "$candidate" ]]; then
      export JAVA_HOME="$candidate"
      return 0
    fi
  fi

  die "JDK 17 not found. Install it with: sdk install java 17.0.20-tem"
}

detect_android_sdk() {
  local candidate
  for candidate in \
    "${ANDROID_HOME:-}" \
    "${ANDROID_SDK_ROOT:-}" \
    "$HOME/Android/Sdk" \
    "/usr/local/lib/android/sdk" \
    "$HOME/Library/Android/sdk"; do
    [[ -n "$candidate" && -d "$candidate/platform-tools" ]] || continue
    export ANDROID_HOME="$candidate"
    export ANDROID_SDK_ROOT="$candidate"
    return 0
  done

  die "Android SDK not found. Set ANDROID_HOME or install it under $HOME/Android/Sdk"
}

detect_node() {
  local candidate
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return 0
  fi

  for candidate in \
    "$HOME"/.nvm/versions/node/*/bin \
    "$HOME/.volta/bin" \
    "/opt/homebrew/bin" \
    "/usr/local/bin"; do
    [[ -x "$candidate/node" && -x "$candidate/npm" ]] || continue
    export PATH="$candidate:$PATH"
    return 0
  done

  die "Node.js and npm not found. Install Node 22 or add them to PATH"
}

ensure_gradle_distribution() {
  local wrapper="$repo_root/packages/app/android/gradle/wrapper/gradle-wrapper.properties"
  [[ -f "$wrapper" ]] || die "Android Gradle wrapper is missing: $wrapper"

  local gradle_version zip_path gradle_user_home cached_distribution
  gradle_version="$(sed -n 's/.*gradle-\([0-9][0-9.]*\)-bin.zip.*/\1/p' "$wrapper" | head -n 1)"
  gradle_version="${gradle_version:-8.14.3}"
  gradle_user_home="${GRADLE_USER_HOME:-$HOME/.gradle}"

  if [[ -n "$gradle_zip" ]]; then
    zip_path="$gradle_zip"
  else
    cached_distribution="$(find "$gradle_user_home/wrapper/dists/gradle-$gradle_version-bin" -maxdepth 3 -type d -name "gradle-$gradle_version" -print -quit 2>/dev/null || true)"
    if [[ -n "$cached_distribution" ]]; then
      log "using cached Gradle $gradle_version"
      return 0
    fi

    zip_path="/tmp/gradle-$gradle_version-bin.zip"
    if [[ ! -s "$zip_path" ]]; then
      log "downloading Gradle $gradle_version"
      curl -fL --retry 8 --retry-all-errors --retry-delay 3 -C - \
        -o "$zip_path" \
        "https://services.gradle.org/distributions/gradle-$gradle_version-bin.zip" ||
        die "failed to download Gradle $gradle_version; retry or pass --gradle-zip"
    fi
  fi

  [[ -s "$zip_path" ]] || die "Gradle distribution zip is missing: $zip_path"
  node - "$wrapper" "$zip_path" <<'NODE'
const fs = require("node:fs");
const [, , wrapper, zipPath] = process.argv;
let properties = fs.readFileSync(wrapper, "utf8");
properties = properties.replace(/^distributionUrl=.*$/m, `distributionUrl=file\\:${zipPath}`);
properties = properties.replace(/^networkTimeout=.*$/m, "networkTimeout=60000");
fs.writeFileSync(wrapper, properties);
NODE
}

[[ "$heap_mb" =~ ^[0-9]+$ ]] || [[ -z "$heap_mb" ]] || die "--heap must be an integer"
workers="$(resolve_workers)"
[[ "$workers" =~ ^[0-9]+$ ]] || die "--workers must be an integer"
heap_mb="${heap_mb:-4096}"

detect_java17
detect_android_sdk
detect_node
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

if [[ "$skip_deps" == false ]]; then
  log "building app dependencies"
  npm run build:app-deps
fi

app_dir="$repo_root/packages/app"
android_dir="$app_dir/android"

if [[ "$clean_prebuild" == true ]]; then
  log "regenerating Android project"
  (cd "$app_dir" && APP_VARIANT=production CI=1 npx expo prebuild --platform android --clean --no-install)
elif [[ "$sync_prebuild" == true || ! -d "$android_dir" ]]; then
  log "generating Android project"
  (cd "$app_dir" && APP_VARIANT=production CI=1 npx expo prebuild --platform android --no-install)
else
  log "reusing existing Android project; pass --clean after changing native config"
fi

printf 'sdk.dir=%s\n' "$ANDROID_HOME" > "$android_dir/local.properties"
ensure_gradle_distribution

gradle_args=()
[[ "$use_daemon" == true ]] || gradle_args+=(--no-daemon)
gradle_args+=(
  --build-cache
  --parallel
  --max-workers="$workers"
  :app:assembleRelease
  -PreactNativeArchitectures="$architectures"
  -x lint
  -x lintVitalAnalyzeRelease
  -x lintVitalRelease
  -x generateReleaseLintModel
  -x generateReleaseLintVitalModel
)

export GRADLE_OPTS="-Dorg.gradle.jvmargs=-Xmx${heap_mb}m -XX:MaxMetaspaceSize=1024m -Dorg.gradle.caching=true -Dorg.gradle.workers.max=$workers"
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=4096"

log "building APK for $architectures with $workers workers"
start_seconds="$(date +%s)"
(cd "$android_dir" && ./gradlew "${gradle_args[@]}")
elapsed_seconds=$(( $(date +%s) - start_seconds ))

apk_source="$android_dir/app/build/outputs/apk/release/app-release.apk"
[[ -f "$apk_source" ]] || die "APK was not produced at $apk_source"

version_label="${version:-$(node -p "require('./packages/app/package.json').version")}"
abi_label="${architectures//,/-}"
apk_name="paseo-${version_label}-android-${abi_label}.apk"
mkdir -p "$output_dir"
apk_path="$output_dir/$apk_name"
cp "$apk_source" "$apk_path"

if command -v sha256sum >/dev/null 2>&1; then
  checksum="$(sha256sum "$apk_path" | awk '{print $1}')"
else
  checksum="$(shasum -a 256 "$apk_path" | awk '{print $1}')"
fi

log "APK: $apk_path"
log "size: $(du -h "$apk_path" | awk '{print $1}')"
log "sha256: $checksum"
log "build time: $((elapsed_seconds / 60))m $((elapsed_seconds % 60))s"

if [[ "$install_apk" == true ]]; then
  log "installing APK"
  adb install -r "$apk_path"
fi
