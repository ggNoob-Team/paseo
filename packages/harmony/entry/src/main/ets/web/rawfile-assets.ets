import resourceManager from "@ohos.resourceManager";

/**
 * Serves the Expo web build from rawfile over a custom scheme.
 *
 * resource://rawfile/index.html does not work here. Its origin is opaque, so
 * WebSocket connections leave as `Origin: null` and the daemon rejects them,
 * and it is not a secure context, so navigator.clipboard and getUserMedia are
 * unavailable. `paseo://app` is a real origin the daemon already allows for the
 * packaged desktop renderer (packages/server/src/server/bootstrap.ts,
 * fixedAllowedOrigins), and isSecure makes it a secure context.
 */
export const PASEO_SCHEME: string = "paseo";
export const PASEO_ORIGIN: string = "paseo://app";
export const ENTRY_PATH: string = "index.html";
export const ENTRY_URL: string = `${PASEO_ORIGIN}/${ENTRY_PATH}`;

const MIME_TYPES: Map<string, string> = new Map<string, string>([
  ["html", "text/html"],
  ["js", "text/javascript"],
  ["mjs", "text/javascript"],
  ["css", "text/css"],
  ["json", "application/json"],
  ["webmanifest", "application/manifest+json"],
  ["map", "application/json"],
  ["txt", "text/plain"],
  ["svg", "image/svg+xml"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["ico", "image/x-icon"],
  ["ttf", "font/ttf"],
  ["otf", "font/otf"],
  ["woff", "font/woff"],
  ["woff2", "font/woff2"],
  ["wasm", "application/wasm"],
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
  ["mp3", "audio/mpeg"],
  ["wav", "audio/wav"],
]);

export function mimeTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot === path.length - 1) {
    return "application/octet-stream";
  }
  return MIME_TYPES.get(path.substring(dot + 1).toLowerCase()) ?? "application/octet-stream";
}

/** Maps paseo://app/<path> to a rawfile-relative path. Null when the URL is not ours. */
export function rawFilePathForUrl(url: string): string | null {
  const prefix = `${PASEO_ORIGIN}/`;
  if (!url.startsWith(prefix)) {
    return null;
  }
  let rest = url.substring(prefix.length);
  const cut = rest.search(/[?#]/);
  if (cut >= 0) {
    rest = rest.substring(0, cut);
  }
  if (rest.length === 0) {
    return ENTRY_PATH;
  }
  try {
    return decodeURIComponent(rest);
  } catch (error) {
    return rest;
  }
}

/** Reads a rawfile into a standalone ArrayBuffer. Null when it does not exist. */
export function readRawFile(
  resources: resourceManager.ResourceManager,
  path: string,
): ArrayBuffer | null {
  try {
    return resources.getRawFileContentSync(path).slice().buffer;
  } catch (error) {
    return null;
  }
}
