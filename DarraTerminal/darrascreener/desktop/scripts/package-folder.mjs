import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const desktopDir = path.resolve(__dirname, "..");
const desktopPackagePath = path.join(desktopDir, "package.json");
const bundleDir = path.join(desktopDir, ".bundle");
const releaseDir = path.join(desktopDir, "release", "win-unpacked");

const desktopPackage = JSON.parse(fs.readFileSync(desktopPackagePath, "utf8"));
const electronExecutablePath = require("electron");
const electronDistDir = path.dirname(electronExecutablePath);
const appDir = path.join(releaseDir, "resources", "app");
const productName = desktopPackage.build?.productName || desktopPackage.productName || "Darra Terminal";
const executableName = `${productName}.exe`;

if (!fs.existsSync(bundleDir)) {
  throw new Error("Desktop bundle is missing. Run `npm run prepare:bundles` first.");
}

fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });

fs.cpSync(electronDistDir, releaseDir, { recursive: true });

const sourceExecutable = path.join(releaseDir, "electron.exe");
const targetExecutable = path.join(releaseDir, executableName);

if (!fs.existsSync(sourceExecutable)) {
  throw new Error(`Electron runtime executable not found at ${sourceExecutable}`);
}

fs.renameSync(sourceExecutable, targetExecutable);

const packagedAppManifest = {
  name: desktopPackage.name,
  productName,
  version: desktopPackage.version,
  description: desktopPackage.description,
  main: desktopPackage.main
};

fs.writeFileSync(path.join(appDir, "package.json"), JSON.stringify(packagedAppManifest, null, 2));
fs.copyFileSync(path.join(desktopDir, "main.cjs"), path.join(appDir, "main.cjs"));
fs.copyFileSync(path.join(desktopDir, "preload.cjs"), path.join(appDir, "preload.cjs"));
fs.cpSync(bundleDir, path.join(appDir, ".bundle"), { recursive: true });

console.log(`Windows app folder created at ${releaseDir}`);
console.log(`Run ${targetExecutable}`);
