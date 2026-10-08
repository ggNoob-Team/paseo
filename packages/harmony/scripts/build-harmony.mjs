#!/usr/bin/env node
/**
 * Builds the HarmonyOS hap for the Paseo web app.
 *
 * Steps: export the Expo web build of packages/app, copy it into the entry
 * module's rawfile, stamp the version from native-release-version.js, then run
 * hvigor. Signing is a separate step so no certificate ever lands in the repo.
 *
 * Toolchain and signing material live outside the repo in $HOME/.paseo-harmony
 * (override with PASEO_HARMONY_HOME). See docs/harmonyos.md.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HARMONY_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(HARMONY_DIR, "..", "..");
const APP_DIR = path.join(REPO_ROOT, "packages", "app");
const WEB_SOURCE = path.join(APP_DIR, "dist");
const RAW_FILE_DIR = path.join(HARMONY_DIR, "entry", "src", "main", "resources", "rawfile");
// The web build uses root-absolute URLs (/_expo/..., /assets/...). The shell
// serves paseo://app/* straight out of rawfile/, so the bundle has to sit at
// the rawfile root for those URLs to resolve.
const WEB_TARGET = RAW_FILE_DIR;
const APP_SCOPE_MANIFEST = path.join(HARMONY_DIR, "AppScope", "app.json5");

const TOOLS_HOME = process.env.PASEO_HARMONY_HOME ?? path.join(os.homedir(), ".paseo-harmony");
const COMMAND_LINE_TOOLS =
  process.env.PASEO_HARMONY_CLT ?? path.join(TOOLS_HOME, "command-line-tools");
const SIGNING_DIR = path.join(TOOLS_HOME, "signing");

const BUNDLE_NAME = process.env.PASEO_HARMONY_BUNDLE_NAME ?? "sh.paseo.app";
const ICON_SOURCE = path.join(APP_DIR, "assets", "images", "icon.png");

function fail(message) {
  process.stderr.write(`\n[harmony] ${message}\n`);
  process.exit(1);
}

function log(message) {
  process.stdout.write(`[harmony] ${message}\n`);
}

function run(command, args, options = {}) {
  log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.error) {
    fail(`failed to run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} exited with code ${result.status}`);
  }
}

function parseArgs(argv) {
  const options = {
    assetsOnly: false,
    verifyAssets: false,
    installOnly: false,
    skipWeb: false,
    skipSign: false,
    install: false,
    buildMode: "debug",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--verify-assets") {
      options.verifyAssets = true;
    } else if (arg === "--assets-only") {
      options.assetsOnly = true;
    } else if (arg === "--install-only") {
      options.installOnly = true;
    } else if (arg === "--skip-web") {
      options.skipWeb = true;
    } else if (arg === "--skip-sign") {
      options.skipSign = true;
    } else if (arg === "--install") {
      options.install = true;
    } else if (arg === "--release") {
      options.buildMode = "release";
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return options;
}

async function readNativeVersion() {
  const packageJson = JSON.parse(await readFile(path.join(APP_DIR, "package.json"), "utf8"));
  const { getNativeReleaseVersion } = require(path.join(APP_DIR, "native-release-version.js"));
  return getNativeReleaseVersion(packageJson.version);
}

/**
 * Rewrites single fields in AppScope/app.json5. This mirrors what `expo prebuild`
 * does for packages/app/android: the version has one source of truth
 * (native-release-version.js) and the native manifest is stamped from it.
 */
async function stampAppScopeManifest(nativeVersion) {
  const original = await readFile(APP_SCOPE_MANIFEST, "utf8");
  const replace = (text, key, value) =>
    text.replace(new RegExp(`("${key}"\\s*:\\s*)[^,\\n]+`), `$1${value}`);
  let next = replace(original, "bundleName", `"${BUNDLE_NAME}"`);
  next = replace(next, "versionCode", String(nativeVersion.androidVersionCode));
  next = replace(next, "versionName", `"${nativeVersion.appVersion}"`);
  if (next !== original) {
    await writeFile(APP_SCOPE_MANIFEST, next);
    log(
      `stamped AppScope/app.json5 (${BUNDLE_NAME} ${nativeVersion.appVersion}/${nativeVersion.androidVersionCode})`,
    );
  }
}

function exportWebApp() {
  const env = { ...process.env };
  const daemonEndpoint = process.env.PASEO_HARMONY_DAEMON?.trim();
  if (daemonEndpoint) {
    // Inlined at bundle time by Metro, exactly like the Android dev build.
    // See docs/android.md and packages/app/src/runtime/host-runtime.ts.
    env.EXPO_PUBLIC_LOCAL_DAEMON = daemonEndpoint;
    log(`baking EXPO_PUBLIC_LOCAL_DAEMON=${daemonEndpoint}`);
  }
  run("npm", ["run", "build:web", "--workspace=@getpaseo/app"], { cwd: REPO_ROOT, env });
}

async function syncWebAssets() {
  if (!existsSync(WEB_SOURCE)) {
    fail(`missing ${path.relative(REPO_ROOT, WEB_SOURCE)}; run without --skip-web first`);
  }
  await rm(WEB_TARGET, { recursive: true, force: true });
  await mkdir(WEB_TARGET, { recursive: true });
  const entries = await readdir(WEB_SOURCE);
  for (const entry of entries) {
    await cp(path.join(WEB_SOURCE, entry), path.join(WEB_TARGET, entry), { recursive: true });
  }
  const manifest = path.join(WEB_TARGET, "index.html");
  if (!existsSync(manifest)) {
    fail(`synced assets are missing index.html at ${path.relative(REPO_ROOT, manifest)}`);
  }
  log("synced web assets to entry/src/main/resources/rawfile");
}

/**
 * Guards the two ways the shell can silently show a blank screen: assets that
 * never made it into rawfile, and root-absolute URLs in index.html that do not
 * resolve under resource://rawfile/.
 */
function collectRootAbsoluteUrls(text) {
  const urls = new Set();
  for (const match of text.matchAll(/["'(](\/[A-Za-z0-9._~!$&*+,;=:@%/@-]+)["')]/g)) {
    const url = match[1];
    if (
      url.startsWith("/assets/") ||
      url.startsWith("/_expo/") ||
      url === "/manifest.json" ||
      url === "/favicon.ico" ||
      url === "/apple-touch-icon.png" ||
      url === "/pwa-icon-192.png" ||
      url === "/pwa-icon-512.png"
    ) {
      urls.add(url);
    }
  }
  return urls;
}

async function verifyWebAssets() {
  if (!existsSync(WEB_TARGET)) {
    fail(`missing ${path.relative(REPO_ROOT, WEB_TARGET)}; run npm run harmony:web first`);
  }
  const referenced = new Set();
  const indexHtmlPath = path.join(WEB_TARGET, "index.html");
  const html = await readFile(indexHtmlPath, "utf8");
  for (const url of collectRootAbsoluteUrls(html)) {
    referenced.add(url);
  }
  // Metro still emits root-absolute asset URLs inside the bundles, so index.html
  // alone is not enough: every "/assets/..." string in the JS has to resolve too.
  const jsDir = path.join(WEB_TARGET, "_expo", "static", "js", "web");
  if (existsSync(jsDir)) {
    for (const name of await readdir(jsDir)) {
      if (!name.endsWith(".js")) {
        continue;
      }
      const contents = await readFile(path.join(jsDir, name), "utf8");
      for (const url of collectRootAbsoluteUrls(contents)) {
        referenced.add(url);
      }
    }
  }
  const missing = [];
  for (const url of referenced) {
    const target = path.join(WEB_TARGET, url.slice(1));
    if (!existsSync(target)) {
      missing.push(url);
    }
  }
  if (missing.length > 0) {
    fail(`index.html references files that are not in rawfile:\n  ${missing.join("\n  ")}`);
  }
  log(`verified ${referenced.size} root-absolute URL(s) from index.html resolve inside rawfile`);
  log(`rawfile size: ${await directorySize(WEB_TARGET)} bytes`);
  await compareWithDist();
}

/** Relative path -> sha256 for every file under dir, sorted for stable diffs. */
async function hashTree(dir) {
  const hashes = new Map();
  const walk = async (current, prefix) => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(absolute, relative);
      } else if (entry.isFile()) {
        hashes.set(relative, await sha256(absolute));
      }
    }
  };
  await walk(dir, "");
  return hashes;
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * The packaging step is a copy, so rawfile has to be byte-identical to dist.
 * A mismatch means the sync dropped or mangled assets, which shows up on device
 * as a blank screen or a 404 that is very hard to read.
 */
async function compareWithDist() {
  if (!existsSync(WEB_SOURCE)) {
    log("no packages/app/dist to compare against; skipping the dist hash check");
    return;
  }
  const [dist, rawfile] = await Promise.all([hashTree(WEB_SOURCE), hashTree(WEB_TARGET)]);
  const mismatched = [];
  for (const [relative, digest] of dist) {
    const other = rawfile.get(relative);
    if (other === undefined) {
      mismatched.push(`${relative}: missing from rawfile`);
    } else if (other !== digest) {
      mismatched.push(`${relative}: content differs`);
    }
  }
  for (const relative of rawfile.keys()) {
    if (!dist.has(relative)) {
      mismatched.push(`${relative}: extra file in rawfile`);
    }
  }
  if (mismatched.length > 0) {
    fail(
      `rawfile is not in sync with packages/app/dist:\n  ${mismatched.join("\n  ")}\n` +
        `Run npm run harmony:web.`,
    );
  }
  log(`rawfile matches packages/app/dist (${dist.size} files, sha256)`);
}

async function directorySize(dir) {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(entryPath);
    } else {
      total += (await stat(entryPath)).size;
    }
  }
  return total;
}

async function copyIcons() {
  if (!existsSync(ICON_SOURCE)) {
    fail(`missing icon source at ${path.relative(REPO_ROOT, ICON_SOURCE)}`);
  }
  const targets = [
    path.join(HARMONY_DIR, "AppScope", "resources", "base", "media", "app_icon.png"),
    path.join(HARMONY_DIR, "entry", "src", "main", "resources", "base", "media", "app_icon.png"),
  ];
  for (const target of targets) {
    await mkdir(path.dirname(target), { recursive: true });
    await cp(ICON_SOURCE, target);
  }
  log("copied app icon from packages/app/assets/images/icon.png");
}

function resolveHvigorw() {
  const executable = process.platform === "win32" ? "hvigorw.bat" : "hvigorw";
  const candidates = [
    path.join(COMMAND_LINE_TOOLS, "bin", executable),
    path.join(HARMONY_DIR, executable),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    fail(
      [
        `hvigorw not found. Looked in:`,
        ...candidates.map((candidate) => `  - ${candidate}`),
        ``,
        `Install the HarmonyOS command line tools into ${COMMAND_LINE_TOOLS}`,
        `or point PASEO_HARMONY_CLT at an existing install. See docs/harmonyos.md.`,
      ].join("\n"),
    );
  }
  return found;
}

function resolveSdkHome() {
  const candidates = [
    process.env.DEVECO_SDK_HOME,
    process.env.HOS_SDK_HOME,
    path.join(COMMAND_LINE_TOOLS, "sdk"),
    path.join(TOOLS_HOME, "sdk"),
  ].filter((candidate) => typeof candidate === "string" && candidate.length > 0);
  const found = candidates.find((candidate) => existsSync(candidate) && hasSdkPayload(candidate));
  if (!found) {
    fail(
      [
        `HarmonyOS SDK not found. Looked in:`,
        ...candidates.map((candidate) => `  - ${candidate}`),
        ``,
        `Put the SDK under ${path.join(TOOLS_HOME, "sdk")} or set DEVECO_SDK_HOME.`,
        `See docs/harmonyos.md for the download steps.`,
      ].join("\n"),
    );
  }
  return found;
}

function hasSdkPayload(dir) {
  try {
    return require("node:fs")
      .readdirSync(dir)
      .some((entry) => !entry.startsWith("."));
  } catch {
    return false;
  }
}

function buildHap({ buildMode, hvigorw, sdkHome }) {
  run(
    hvigorw,
    [
      "assembleHap",
      "--mode",
      "module",
      "-p",
      "product=default",
      "-p",
      `buildMode=${buildMode}`,
      "--no-daemon",
    ],
    {
      cwd: HARMONY_DIR,
      // HarmonyOS products resolve DEVECO_SDK_HOME; OpenHarmony products
      // resolve OHOS_BASE_SDK_HOME. Set both so either runtimeOS works.
      env: { ...process.env, DEVECO_SDK_HOME: sdkHome, OHOS_BASE_SDK_HOME: sdkHome },
    },
  );
}

async function findLatestHap({ signed = false } = {}) {
  const outputs = path.join(HARMONY_DIR, "entry", "build", "default", "outputs", "default");
  if (!existsSync(outputs)) {
    return null;
  }
  const entries = await readdir(outputs);
  const haps = entries.filter((entry) =>
    signed ? entry.endsWith("-signed.hap") : entry.endsWith(".hap"),
  );
  if (haps.length === 0) {
    return null;
  }
  const withStats = await Promise.all(
    haps.map(async (name) => {
      const filePath = path.join(outputs, name);
      const info = await stat(filePath);
      return { filePath, mtimeMs: info.mtimeMs };
    }),
  );
  withStats.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return withStats[0].filePath;
}

function findSigningTool(sdkHome) {
  // hvigor expects the SDK at <sdkHome>/<platformVersion>/<component>; the
  // toolchain version dir changes with every SDK (26.0.0 today), so look it up.
  const candidates = [];
  try {
    for (const entry of require("node:fs").readdirSync(sdkHome, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      candidates.push(
        path.join(sdkHome, entry.name, "toolchains", "lib", "hap-sign-tool.jar"),
        path.join(sdkHome, entry.name, "openharmony", "toolchains", "lib", "hap-sign-tool.jar"),
      );
    }
  } catch {
    // fall through to the static candidates below
  }
  candidates.push(
    path.join(sdkHome, "default", "openharmony", "toolchains", "lib", "hap-sign-tool.jar"),
    path.join(sdkHome, "toolchains", "lib", "hap-sign-tool.jar"),
  );
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function signHap({ hapPath, sdkHome }) {
  const signingJsonPath = path.join(SIGNING_DIR, "signing.json");
  if (!existsSync(signingJsonPath)) {
    log(`no ${path.relative(os.homedir(), signingJsonPath)}; leaving the hap unsigned`);
    return hapPath;
  }
  const signingTool = findSigningTool(sdkHome);
  if (!signingTool) {
    fail(`hap-sign-tool.jar not found under ${sdkHome}; cannot sign`);
  }
  const material = JSON.parse(require("node:fs").readFileSync(signingJsonPath, "utf8"));
  const signedPath = hapPath.replace(/\.hap$/, "-signed.hap");
  const args = [
    "-jar",
    signingTool,
    "sign-app",
    "-mode",
    "localSign",
    "-keyAlias",
    material.keyAlias,
    "-signAlg",
    material.signAlg ?? "SHA256withECDSA",
    "-keystoreFile",
    material.keystoreFile,
    "-keystorePwd",
    material.keystorePwd,
    "-keyPwd",
    material.keyPwd,
    "-appCertFile",
    material.appCertFile,
    "-profileFile",
    material.profileFile,
    "-inFile",
    hapPath,
    "-outFile",
    signedPath,
  ];
  run("java", args);
  return signedPath;
}

function resolveHdc() {
  const candidates = [path.join(COMMAND_LINE_TOOLS, "bin", "hdc")];
  try {
    for (const entry of require("node:fs").readdirSync(path.join(TOOLS_HOME, "sdk"), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) {
        candidates.push(path.join(TOOLS_HOME, "sdk", entry.name, "toolchains", "hdc"));
      }
    }
  } catch {
    // no SDK dir; fall back to PATH
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? "hdc";
}

function installHap(hapPath) {
  run(resolveHdc(), ["install", "-r", hapPath]);
}

/**
 * Copies the hap to packages/harmony/build/outputs/hap so every artifact has one
 * stable path; entry/build/... is hvigor scratch space and gets cleaned.
 */
async function publishHap(hapPath) {
  const publishDir = path.join(HARMONY_DIR, "build", "outputs", "hap");
  await mkdir(publishDir, { recursive: true });
  const target = path.join(publishDir, path.basename(hapPath));
  await cp(hapPath, target);
  log(`hap: ${target}`);
  return target;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const nativeVersion = await readNativeVersion();

  if (options.verifyAssets) {
    await verifyWebAssets();
    return;
  }

  if (options.installOnly) {
    const existing = await findLatestHap({ signed: true });
    if (!existing) {
      fail("no built hap found; run npm run harmony:build first");
    }
    installHap(existing);
    return;
  }

  await stampAppScopeManifest(nativeVersion);
  await copyIcons();

  if (options.skipWeb) {
    log("skipping web export (--skip-web)");
  } else {
    exportWebApp();
  }
  await syncWebAssets();

  if (options.assetsOnly) {
    log("assets only: stopping before hvigor");
    return;
  }

  const sdkHome = resolveSdkHome();
  const hvigorw = resolveHvigorw();
  buildHap({ buildMode: options.buildMode, hvigorw, sdkHome });

  const hapPath = await findLatestHap();
  if (!hapPath) {
    fail("hvigor finished but no .hap was found under entry/build/default/outputs/default");
  }

  let finalPath = hapPath;
  if (!options.skipSign) {
    finalPath = await signHap({ hapPath, sdkHome });
  }
  finalPath = await publishHap(finalPath);

  if (options.install) {
    installHap(finalPath);
  } else {
    log(`install with: hdc install -r ${finalPath}`);
  }
}

await main();
