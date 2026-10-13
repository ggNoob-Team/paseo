#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

artifacts_dir="${PASEO_APK_OUTPUT_DIR:-$HOME/paseo-artifacts}"
publish_dir="${PASEO_APK_PUBLISH_DIR:-$artifacts_dir/published}"
web_root="${PASEO_APK_WEB_ROOT:-/www/wwwroot/paseo.zxyz.app}"
web_link_name="${PASEO_APK_WEB_LINK:-apk}"
site_url="${PASEO_APK_SITE_URL:-https://paseo.zxyz.app}"
source_apk=""
skip_verify=false

usage() {
  cat <<'USAGE'
Publish an Android APK so https://paseo.zxyz.app links to it.

Usage:
  ./scripts/publish-android-apk.sh [options]

Options:
  --apk <path>       APK to publish (default: newest paseo-*.apk in the artifacts dir)
  --artifacts <dir>  Where builds land (default: $HOME/paseo-artifacts)
  --publish-dir <d>  Published output (default: <artifacts>/published)
  --web-root <dir>   Site root serving the download (default: /www/wwwroot/paseo.zxyz.app)
  --link <name>      Symlink inside the web root (default: apk)
  --no-verify        Skip the local nginx check
  -h, --help         Show this help

The chosen APK becomes <publish-dir>/paseo-latest.apk and is described in
<publish-dir>/latest.json, which the portal page reads.
USAGE
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[publish-apk] %s\n' "$*"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apk)
      source_apk="${2:-}"
      shift 2
      ;;
    --artifacts)
      artifacts_dir="${2:-}"
      shift 2
      ;;
    --publish-dir)
      publish_dir="${2:-}"
      shift 2
      ;;
    --web-root)
      web_root="${2:-}"
      shift 2
      ;;
    --link)
      web_link_name="${2:-}"
      shift 2
      ;;
    --no-verify)
      skip_verify=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

if [[ -z "$source_apk" ]]; then
  source_apk="$(
    find "$artifacts_dir" -maxdepth 1 -type f -name 'paseo-*.apk' -printf '%T@ %p\n' 2>/dev/null |
      sort -nr |
      head -n 1 |
      cut -d ' ' -f 2-
  )"
fi
[[ -n "$source_apk" && -f "$source_apk" ]] || die "no APK found (looked in $artifacts_dir)"

apk_name="$(basename "$source_apk")"
version_label="${apk_name#paseo-}"
version_label="${version_label%-android-*.apk}"

mkdir -p "$publish_dir"
cp "$source_apk" "$publish_dir/paseo-latest.apk"
chmod 644 "$publish_dir/paseo-latest.apk"

if command -v sha256sum >/dev/null 2>&1; then
  sha256="$(sha256sum "$publish_dir/paseo-latest.apk" | awk '{print $1}')"
else
  sha256="$(shasum -a 256 "$publish_dir/paseo-latest.apk" | awk '{print $1}')"
fi
size_bytes="$(stat -c %s "$publish_dir/paseo-latest.apk" 2>/dev/null || stat -f %z "$publish_dir/paseo-latest.apk")"
size_label="$(du -h "$publish_dir/paseo-latest.apk" | awk '{print $1}')"
published_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
built_at="$(stat -c %y "$source_apk" 2>/dev/null | cut -d '.' -f 1 || true)"
download_path="/$web_link_name/paseo-latest.apk"
download_url="$site_url$download_path"

node - "$publish_dir/history.json" "$publish_dir/latest.json" <<NODE
const fs = require("node:fs");
const [, , historyPath, latestPath] = process.argv;
const entry = {
  version: ${version_label@Q},
  name: ${apk_name@Q},
  sha256: ${sha256@Q},
  sizeBytes: Number(${size_bytes@Q}),
  sizeLabel: ${size_label@Q},
  publishedAt: ${published_at@Q},
};
let history = [];
try {
  const parsed = JSON.parse(fs.readFileSync(historyPath, "utf8"));
  if (Array.isArray(parsed)) history = parsed;
} catch {}
history = history.filter((item) => item.sha256 !== entry.sha256);
history.unshift(entry);
fs.writeFileSync(historyPath, JSON.stringify(history.slice(0, 20), null, 2) + "\n");
fs.writeFileSync(
  latestPath,
  JSON.stringify(
    {
      ...entry,
      builtAt: ${built_at@Q} || null,
      downloadPath: ${download_path@Q},
      downloadUrl: ${download_url@Q},
    },
    null,
    2,
  ) + "\n",
);
NODE
chmod 644 "$publish_dir/latest.json" "$publish_dir/history.json"

if [[ ! -e "$web_root/$web_link_name" ]]; then
  log "linking $web_root/$web_link_name -> $publish_dir"
  sudo ln -s "$publish_dir" "$web_root/$web_link_name"
fi

log "version: $version_label"
log "size: $size_label"
log "sha256: $sha256"
log "download: $download_url"

if [[ "$skip_verify" != true ]]; then
  status="$(
    curl -s -o /dev/null -w '%{http_code}' -H "Host: ${site_url#https://}" "http://127.0.0.1$download_path"
  )"
  log "local nginx check: HTTP $status"
  [[ "$status" == "200" ]] || die "the site did not serve $download_path (HTTP $status)"
fi
