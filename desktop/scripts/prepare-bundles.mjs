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
const betterSqliteBindingPath = path.join(
  backendBundleDir,
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node"
);
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
writeBackendBundlePackageManifest();
rebuildBetterSqliteForElectron();
verifyBetterSqliteBinding();

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
  const isWindowsCommandScript = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const result = isWindowsCommandScript
    ? spawnSync(`"${command}" ${args.map(quoteShellArg).join(" ")}`, {
        cwd: workdir,
        stdio: "inherit",
        shell: true
      })
    : spawnSync(command, args, {
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

function quoteShellArg(value) {
  const normalized = String(value);

  if (!/[\s"]/u.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/g, '\\"')}"`;
}

function findExecutableInPath(commandName) {
  const pathEntries = (process.env.PATH || process.env.Path || "")
    .split(path.delimiter)
    .filter(Boolean);

  for (const entry of pathEntries) {
    const candidatePath = path.join(entry, commandName);

    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function resolveNpmCommand() {
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return {
      command: process.execPath,
      argsPrefix: [npmExecPath]
    };
  }

  if (process.platform === "win32") {
    const pathNpm = findExecutableInPath("npm.cmd");
    const programFilesNpm = "C:\\Program Files\\nodejs\\npm.cmd";

    if (pathNpm) {
      return {
        command: pathNpm,
        argsPrefix: []
      };
    }

    if (fs.existsSync(programFilesNpm)) {
      return {
        command: programFilesNpm,
        argsPrefix: []
      };
    }

    return null;
  }

  const pathNpm = findExecutableInPath("npm");

  return pathNpm
    ? {
        command: pathNpm,
        argsPrefix: []
      }
    : null;
}

function resolveElectronRebuildCommand() {
  const electronRebuildCliPath = path.join(
    desktopDir,
    "node_modules",
    "@electron",
    "rebuild",
    "lib",
    "cli.js"
  );

  if (!fs.existsSync(electronRebuildCliPath)) {
    return null;
  }

  return {
    command: process.execPath,
    argsPrefix: [electronRebuildCliPath]
  };
}

function resolvePrebuildInstallCommand() {
  const prebuildInstallCliPath = path.join(backendDir, "node_modules", "prebuild-install", "bin.js");

  if (!fs.existsSync(prebuildInstallCliPath)) {
    return null;
  }

  return {
    command: process.execPath,
    argsPrefix: [prebuildInstallCliPath]
  };
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

function writeBackendBundlePackageManifest() {
  const backendPackage = JSON.parse(fs.readFileSync(path.join(backendDir, "package.json"), "utf8"));
  const manifest = {
    name: "scalpstation-backend-bundle",
    version: backendPackage.version ?? "1.0.0",
    private: true,
    dependencies: {
      "better-sqlite3": backendPackage.dependencies?.["better-sqlite3"] ?? "^12.10.0"
    }
  };

  fs.writeFileSync(path.join(backendBundleDir, "package.json"), JSON.stringify(manifest, null, 2));
}

function rebuildBetterSqliteForElectron() {
  if (!electronVersion) {
    throw new Error("Electron version is missing from desktop package.json.");
  }

  const npmArgs = [
    "rebuild",
    "better-sqlite3",
    "--runtime=electron",
    `--target=${electronVersion}`,
    "--dist-url=https://electronjs.org/headers"
  ];
  const npmCommand = resolveNpmCommand();
  const rebuildErrors = [];
  const prebuildInstallCommand = resolvePrebuildInstallCommand();

  if (prebuildInstallCommand) {
    try {
      runCommand(
        prebuildInstallCommand.command,
        [
          ...prebuildInstallCommand.argsPrefix,
          "--runtime",
          "electron",
          "--target",
          electronVersion
        ],
        path.join(backendBundleDir, "node_modules", "better-sqlite3")
      );
      return;
    } catch (error) {
      rebuildErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (npmCommand) {
    try {
      runCommand(npmCommand.command, [...npmCommand.argsPrefix, ...npmArgs], backendBundleDir);
      return;
    } catch (error) {
      rebuildErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const electronRebuildCommand = resolveElectronRebuildCommand();

  if (electronRebuildCommand) {
    try {
      runCommand(
        electronRebuildCommand.command,
        [
          ...electronRebuildCommand.argsPrefix,
          "--module-dir",
          backendBundleDir,
          "--only",
          "better-sqlite3",
          "--version",
          electronVersion
        ],
        backendBundleDir
      );
      return;
    } catch (error) {
      rebuildErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(
    [
      "Could not rebuild better-sqlite3 for Electron.",
      "prebuild-install, npm, and electron-rebuild were unavailable or failed.",
      "npm lookup used process.env.npm_execpath, PATH, and C:\\Program Files\\nodejs\\npm.cmd.",
      `Expected Electron target: ${electronVersion}.`,
      rebuildErrors.length ? `Errors: ${rebuildErrors.join(" | ")}` : ""
    ].join(" ")
  );
}

function verifyBetterSqliteBinding() {
  if (!fs.existsSync(betterSqliteBindingPath)) {
    throw new Error(
      `better-sqlite3 native binding is missing after Electron rebuild: ${betterSqliteBindingPath}`
    );
  }

  const stat = fs.statSync(betterSqliteBindingPath);

  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(
      `better-sqlite3 native binding is invalid after Electron rebuild: ${betterSqliteBindingPath}`
    );
  }
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
