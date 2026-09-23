#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const replacements = new Map([
  ["@getpaseo/highlight", "@ggnoob-team/paseo-highlight"],
  ["@getpaseo/relay", "@ggnoob-team/paseo-relay"],
  ["@getpaseo/protocol", "@ggnoob-team/paseo-protocol"],
  ["@getpaseo/client", "@ggnoob-team/paseo-client"],
  ["@getpaseo/plugin", "@ggnoob-team/paseo-plugin"],
  ["@getpaseo/server", "@ggnoob-team/paseo-server"],
  ["@getpaseo/cli", "@ggnoob-team/paseo"],
]);
const packageSpecs = [
  { source: "@getpaseo/highlight", directory: "packages/highlight" },
  { source: "@getpaseo/relay", directory: "packages/relay" },
  { source: "@getpaseo/protocol", directory: "packages/protocol" },
  { source: "@getpaseo/client", directory: "packages/client" },
  { source: "@getpaseo/plugin", directory: "packages/plugin" },
  { source: "@getpaseo/server", directory: "packages/server" },
  { source: "@getpaseo/cli", directory: "packages/cli" },
];
const dependencyFields = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
];
const codeExtensions = new Set([".js", ".mjs", ".cjs", ".d.ts", ".d.mts", ".d.cts"]);

function usage() {
  process.stderr.write(
    "Usage: node scripts/pack-github-daemon-packages.mjs --version <version> --output <directory> [--ignore-scripts]\n",
  );
  process.exit(1);
}

function parseArgs(argv) {
  const options = { ignoreScripts: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--version") {
      options.version = argv[++index];
    } else if (arg === "--output") {
      options.output = argv[++index];
    } else if (arg === "--ignore-scripts") {
      options.ignoreScripts = true;
    } else {
      usage();
    }
  }
  if (!options.version || !options.output) usage();
  return options;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function packWorkspace(spec, destination, ignoreScripts) {
  mkdirSync(destination, { recursive: true });
  const args = ["pack", `--workspace=${spec.source}`, `--pack-destination=${destination}`];
  if (ignoreScripts) args.push("--ignore-scripts");
  execFileSync("npm", args, { cwd: repoRoot, env: process.env, stdio: "inherit" });

  const tarballs = readdirSync(destination).filter((file) => file.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    throw new Error(`Expected one tarball for ${spec.source}, found ${tarballs.length}`);
  }
  return path.join(destination, tarballs[0]);
}

function extractPackage(tarball, destination) {
  mkdirSync(destination, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", destination, "--strip-components=1"], {
    stdio: "inherit",
  });
  rmSync(path.join(destination, "node_modules"), { recursive: true, force: true });
}

function rewriteDependencyField(manifest, field, version) {
  const dependencies = manifest[field];
  if (!dependencies) return;

  for (const [name, value] of Object.entries(dependencies)) {
    const replacement = replacements.get(name);
    if (!replacement) continue;
    delete dependencies[name];
    if (field === "peerDependenciesMeta") {
      dependencies[replacement] = value;
    } else {
      dependencies[replacement] = version;
    }
  }
}

function transformManifest(packageDir, spec, version) {
  const manifestPath = path.join(packageDir, "package.json");
  const manifest = readJson(manifestPath);
  const target = replacements.get(spec.source);
  if (!target) throw new Error(`Missing replacement for ${spec.source}`);

  manifest.name = target;
  manifest.version = version;
  for (const field of dependencyFields) rewriteDependencyField(manifest, field, version);
  delete manifest.devDependencies;
  manifest.repository = {
    type: "git",
    url: "https://github.com/ggNoob-Team/paseo.git",
  };
  manifest.publishConfig = {
    registry: "https://npm.pkg.github.com",
    access: "public",
  };
  writeJson(manifestPath, manifest);
}

function walkFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const filePath = path.join(root, entry);
    const info = statSync(filePath);
    if (info.isDirectory()) {
      files.push(...walkFiles(filePath));
    } else if (info.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

function rewriteCodeReferences(packageDir) {
  for (const filePath of walkFiles(packageDir)) {
    if (
      path.basename(filePath) !== "paseo" &&
      ![...codeExtensions].some((extension) => filePath.endsWith(extension))
    ) {
      continue;
    }
    const source = readFileSync(filePath, "utf8");
    let rewritten = source;
    for (const [from, to] of replacements) {
      rewritten = rewritten.split(from).join(to);
    }
    if (rewritten !== source) writeFileSync(filePath, rewritten);
  }
}

function main() {
  const { version, output, ignoreScripts } = parseArgs(process.argv.slice(2));
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid package version: ${version}`);
  }

  const outputDir = path.resolve(output);
  const packsDir = path.join(outputDir, "packs");
  const packagesDir = path.join(outputDir, "packages");
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(packsDir, { recursive: true });
  mkdirSync(packagesDir, { recursive: true });

  const tarballs = [];
  for (const spec of packageSpecs) {
    const originalTarball = packWorkspace(
      spec,
      path.join(packsDir, spec.source.replace("@getpaseo/", "")),
      ignoreScripts,
    );
    const target = replacements.get(spec.source);
    const packageDir = path.join(packagesDir, ...target.split("/"));
    extractPackage(originalTarball, packageDir);
    transformManifest(packageDir, spec, version);
    rewriteCodeReferences(packageDir);

    execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", outputDir], {
      cwd: packageDir,
      env: process.env,
      stdio: "inherit",
    });
    const expectedPrefix = `${target.replace("@", "").replace("/", "-")}-${version}.tgz`;
    const tarball = path.join(outputDir, expectedPrefix);
    if (!statSync(tarball, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Expected packed tarball at ${tarball}`);
    }
    tarballs.push(tarball);
  }

  const manifestPath = path.join(outputDir, "publish-manifest.txt");
  writeFileSync(manifestPath, `${tarballs.join("\n")}\n`);
  process.stdout.write(`${manifestPath}\n`);
}

main();
