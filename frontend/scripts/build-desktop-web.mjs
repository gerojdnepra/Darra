import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const command = process.execPath;
const nextCli = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const staleNextExportDir = path.join(process.cwd(), ".next", "export");
const backendPort = process.env.BACKEND_PORT || readRootEnv("BACKEND_PORT") || "3001";
const backendWsPath = process.env.BACKEND_WS_PATH || readRootEnv("BACKEND_WS_PATH") || "/ws";
const backendWsUrl =
  process.env.NEXT_PUBLIC_DESKTOP_BACKEND_WS_URL ||
  `ws://127.0.0.1:${backendPort}${normalizeWsPath(backendWsPath)}`;

console.log(`Desktop backend WebSocket: ${backendWsUrl}`);
removeDirectoryWithRetries(staleNextExportDir);

const result = spawnSync(command, [nextCli, "build"], {
  env: {
    ...process.env,
    NEXT_OUTPUT_MODE: "export",
    NEXT_PUBLIC_BACKEND_WS_URL: backendWsUrl
  },
  stdio: "inherit"
});

if (result.error) {
  console.error(result.error);
}

process.exit(result.status ?? 1);

function removeDirectoryWithRetries(targetPath, retries = 5, delayMs = 150) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 0 });
      return;
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }

      sleep(delayMs * (attempt + 1));
    }
  }
}

function sleep(durationMs) {
  const end = Date.now() + durationMs;

  while (Date.now() < end) {
    // Busy-wait is acceptable here because this is a short-lived build script.
  }
}

function readRootEnv(key) {
  const envPath = path.resolve(process.cwd(), "..", ".env");

  try {
    const source = fs.readFileSync(envPath, "utf8");
    const pattern = new RegExp(`^${escapeRegExp(key)}=(.*)$`, "m");
    const match = source.match(pattern);

    if (!match) {
      return "";
    }

    return match[1].trim().replace(/^['"]|['"]$/g, "");
  } catch {
    return "";
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeWsPath(value) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "/ws";
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
