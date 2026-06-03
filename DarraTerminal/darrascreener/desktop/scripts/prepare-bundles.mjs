import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopDir = path.resolve(__dirname, "..");
const rootDir = path.resolve(desktopDir, "..");
const frontendDir = path.join(rootDir, "frontend");
const backendDir = path.join(rootDir, "backend");
const backendEntry = path.join(rootDir, "backend", "src", "index.ts");
const desktopPackage = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf8"));
const bundleDir = path.join(desktopDir, ".bundle");
const frontendBundleDir = path.join(bundleDir, "frontend");
const backendBundleDir = path.join(bundleDir, "backend");
const electronVersion = normalizePackageVersion(
  desktopPackage.devDependencies?.electron ?? desktopPackage.dependencies?.electron
);

resetBundleDirectory();
runCommand(
  process.execPath,
  [path.join(frontendDir, "scripts", "build-desktop-web.mjs")],
  frontendDir
);

fs.cpSync(path.join(frontendDir, "out"), frontendBundleDir, { recursive: true });

try {
  await build({
    entryPoints: [backendEntry],
    outfile: path.join(backendBundleDir, "index.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["better-sqlite3"],
    sourcemap: false,
    legalComments: "none"
  });
} catch (error) {
  console.warn("esbuild backend bundle failed; falling back to compiled backend copy.");
  console.warn(error instanceof Error ? error.message : error);
  prepareCompiledBackendFallback();
}

copyBackendRuntimeModules(["better-sqlite3", "bindings", "file-uri-to-path"]);
rebuildBetterSqliteForElectron();

console.log("Desktop bundles prepared in .bundle/");

function normalizePackageVersion(value) {
  return typeof value === "string" ? value.replace(/^[^\d]*/, "") : "";
}

function resetBundleDirectory() {
  fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.mkdirSync(frontendBundleDir, { recursive: true });
  fs.mkdirSync(backendBundleDir, { recursive: true });
}

function runCommand(command, args, workdir) {
  const result = spawnSync(command, args, {
    cwd: workdir,
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with code ${result.status ?? 1}`);
  }
}

function copyBackendRuntimeModules(moduleNames) {
  const backendNodeModulesDir = path.join(backendDir, "node_modules");
  const targetNodeModulesDir = path.join(backendBundleDir, "node_modules");

  for (const moduleName of moduleNames) {
    const sourceDir = path.join(backendNodeModulesDir, moduleName);
    const targetDir = path.join(targetNodeModulesDir, moduleName);

    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Backend runtime module not found at ${sourceDir}`);
    }

    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.cpSync(sourceDir, targetDir, { recursive: true });
  }
}

function rebuildBetterSqliteForElectron() {
  if (!electronVersion) {
    throw new Error("Electron version is missing from desktop package.json.");
  }

  const args = [
    "rebuild",
    "better-sqlite3",
    "--runtime=electron",
    `--target=${electronVersion}`,
    "--dist-url=https://electronjs.org/headers"
  ];

  if (process.platform === "win32") {
    runCommand("cmd.exe", ["/d", "/s", "/c", "npm.cmd", ...args], backendBundleDir);
    return;
  }

  runCommand("npm", args, backendBundleDir);
}

function prepareCompiledBackendFallback() {
  const typescriptCli = path.join(backendDir, "node_modules", "typescript", "bin", "tsc");
  const backendBundleDistDir = path.join(backendBundleDir, "dist");
  const backendNodeModulesDir = path.join(backendDir, "node_modules");

  if (!fs.existsSync(typescriptCli)) {
    throw new Error(`TypeScript compiler not found at ${typescriptCli}`);
  }

  if (!fs.existsSync(backendNodeModulesDir)) {
    throw new Error(`Backend node_modules not found at ${backendNodeModulesDir}`);
  }

  runCommand(
    process.execPath,
    [typescriptCli, "-p", path.join(backendDir, "tsconfig.json"), "--outDir", backendBundleDistDir],
    backendDir
  );

  fs.writeFileSync(
    path.join(backendBundleDir, "index.cjs"),
    "module.exports = require(\"./dist/index.js\");\n"
  );
  fs.copyFileSync(path.join(backendDir, "package.json"), path.join(backendBundleDir, "package.json"));
  fs.cpSync(backendNodeModulesDir, path.join(backendBundleDir, "node_modules"), {
    recursive: true
  });
}
