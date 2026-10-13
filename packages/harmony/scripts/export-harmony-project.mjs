#!/usr/bin/env node
/**
 * Packages packages/harmony as a self-contained project for DevEco Studio, so a
 * Windows/Mac machine can build it and run it on the HarmonyOS emulator.
 *
 * DevEco brings its own HarmonyOS SDK, so the exported copy switches runtimeOS
 * to "HarmonyOS" (also what AGC automatic signing needs) and pins
 * compatibleSdkVersion to 12, which any emulator image from API 12 up can
 * install. The repo copy stays on OpenHarmony for the local smoke build.
 *
 * See docs/harmonyos.md.
 */
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile, chmod } from "node:fs/promises";
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
const RAW_FILE_DIR = path.join(HARMONY_DIR, "entry", "src", "main", "resources", "rawfile");
const ICON_TARGETS = [
  path.join(HARMONY_DIR, "AppScope", "resources", "base", "media", "app_icon.png"),
  path.join(HARMONY_DIR, "entry", "src", "main", "resources", "base", "media", "app_icon.png"),
];

const TOOLS_HOME = process.env.PASEO_HARMONY_HOME ?? path.join(os.homedir(), ".paseo-harmony");
const COMMAND_LINE_TOOLS =
  process.env.PASEO_HARMONY_CLT ?? path.join(TOOLS_HOME, "command-line-tools");

const DEFAULT_API = "26.0.0";
const COMPATIBLE_API = 12;

// hvigor scratch, IDE caches, and anything the export regenerates or must not
// carry (signing material). "build" also covers entry/build.
const EXCLUDED_ENTRIES = new Set([
  ".hvigor",
  "build",
  "oh_modules",
  "node_modules",
  "signing",
  ".cxx",
  "local.properties",
]);

function fail(message) {
  process.stderr.write(`\n[harmony:export] ${message}\n`);
  process.exit(1);
}

function log(message) {
  process.stdout.write(`[harmony:export] ${message}\n`);
}

function relative(target) {
  return path.relative(REPO_ROOT, target);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, ...options });
  if (result.error) {
    fail(`failed to run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} exited with code ${result.status}`);
  }
}

function parseArgs(argv) {
  const options = { api: DEFAULT_API, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--api") {
      const value = argv[index + 1];
      if (!value) {
        fail("--api needs a value, for example --api 20 or --api 26.0.0");
      }
      options.api = value;
      index += 1;
    } else if (arg === "--out") {
      const value = argv[index + 1];
      if (!value) {
        fail("--out needs a path");
      }
      options.out = value;
      index += 1;
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return options;
}

/** hvigor wants a bare number below API 26 and a dotted string from API 26 on. */
function formatApiVersion(value) {
  return /^\d+$/.test(value) ? value : `"${value}"`;
}

async function copyTree(source, target, skip) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (skip.has(entry.name)) {
      continue;
    }
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to, skip);
    } else if (entry.isSymbolicLink()) {
      await cp(from, to, { dereference: true });
    } else if (entry.isFile()) {
      await cp(from, to);
    }
  }
}

/**
 * A DevEco project carries its own hvigor wrapper. The command-line-tools install
 * ships the same three files, just with the wrapper JS sitting next to the shell
 * script instead of under hvigor/.
 */
async function addHvigorWrapper(projectDir) {
  const binDir = path.join(COMMAND_LINE_TOOLS, "hvigor", "bin");
  const sources = {
    shell: path.join(binDir, "hvigorw"),
    bat: path.join(binDir, "hvigorw.bat"),
    wrapper: path.join(binDir, "hvigorw.js"),
  };
  for (const file of Object.values(sources)) {
    if (!existsSync(file)) {
      fail(`missing ${file}; point PASEO_HARMONY_CLT at a command-line-tools install`);
    }
  }
  const shellText = (await readFile(sources.shell, "utf8"))
    .replaceAll("${HVIGOR_APP_HOME}/hvigorw.js", "${HVIGOR_APP_HOME}/hvigor/hvigor-wrapper.js")
    .replace("Couldn't find hvigorw.js in", "Couldn't find hvigor/hvigor-wrapper.js in");
  const batText = (await readFile(sources.bat, "utf8")).replace(
    "%DIRNAME%\\hvigorw.js",
    "%DIRNAME%\\hvigor\\hvigor-wrapper.js",
  );
  const shellTarget = path.join(projectDir, "hvigorw");
  await writeFile(shellTarget, shellText);
  await chmod(shellTarget, 0o755);
  await writeFile(path.join(projectDir, "hvigorw.bat"), batText);
  await mkdir(path.join(projectDir, "hvigor"), { recursive: true });
  await cp(sources.wrapper, path.join(projectDir, "hvigor", "hvigor-wrapper.js"));
  log("added hvigor wrapper (hvigorw, hvigorw.bat, hvigor/hvigor-wrapper.js)");
}

function setField(text, key, value) {
  // Keys are bare in the JSON5 we write, but tolerate quotes.
  const pattern = new RegExp(`(^[ \\t]*"?${key}"?\\s*:\\s*)[^,\\n]+`, "m");
  if (!pattern.test(text)) {
    fail(`build-profile.json5 has no ${key} field`);
  }
  return text.replace(pattern, `$1${value}`);
}

async function writeDevecoBuildProfile(projectDir, api) {
  const target = path.join(projectDir, "build-profile.json5");
  let text = await readFile(target, "utf8");
  text = setField(text, "compileSdkVersion", formatApiVersion(api));
  text = setField(text, "compatibleSdkVersion", String(COMPATIBLE_API));
  text = setField(text, "targetSdkVersion", formatApiVersion(api));
  text = setField(text, "runtimeOS", '"HarmonyOS"');
  await writeFile(target, text);
  log(`export profile: runtimeOS HarmonyOS, compile/target ${api}, compatible ${COMPATIBLE_API}`);
}

async function readAppVersion() {
  const packageJson = JSON.parse(await readFile(path.join(APP_DIR, "package.json"), "utf8"));
  const { getNativeReleaseVersion } = require(path.join(APP_DIR, "native-release-version.js"));
  return getNativeReleaseVersion(packageJson.version).appVersion;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const entryHtml = path.join(RAW_FILE_DIR, "index.html");
  if (!existsSync(entryHtml)) {
    fail(`missing ${relative(entryHtml)}; run npm run harmony:web first`);
  }
  for (const icon of ICON_TARGETS) {
    if (!existsSync(icon)) {
      fail(`missing ${relative(icon)}; run npm run harmony:web first`);
    }
  }

  const version = await readAppVersion();
  const stagingRoot = path.join(HARMONY_DIR, "build", "export");
  const projectDir = path.join(stagingRoot, `paseo-harmony-${version}`);
  await rm(projectDir, { recursive: true, force: true });
  await copyTree(HARMONY_DIR, projectDir, EXCLUDED_ENTRIES);
  await addHvigorWrapper(projectDir);
  await writeDevecoBuildProfile(projectDir, options.api);

  const zipPath = options.out
    ? path.resolve(options.out)
    : path.join(HARMONY_DIR, "build", `paseo-harmony-${version}.zip`);
  await mkdir(path.dirname(zipPath), { recursive: true });
  await rm(zipPath, { force: true });
  run("zip", ["-r", "-q", zipPath, path.basename(projectDir), "-x", "*.DS_Store"], {
    cwd: stagingRoot,
  });

  const size = (await stat(zipPath)).size;
  log(`exported ${relative(zipPath)} (${(size / 1024 / 1024).toFixed(1)} MiB)`);
  log("next: copy it to the DevEco machine, unzip, then File > Open the folder");
  if (options.api === DEFAULT_API) {
    log("if that machine's SDK Manager has no API 26, re-run with --api <highest available>");
  }
}

await main();
