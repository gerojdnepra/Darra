import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const command = process.execPath;
const nextCli = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const backendPort = process.env.BACKEND_PORT || readRootEnv("BACKEND_PORT") || "3001";
const backendWsPath = process.env.BACKEND_WS_PATH || readRootEnv("BACKEND_WS_PATH") || "/ws";
const backendWsUrl =
  process.env.NEXT_PUBLIC_DESKTOP_BACKEND_WS_URL ||
  `ws://127.0.0.1:${backendPort}${normalizeWsPath(backendWsPath)}`;

console.log(`Desktop backend WebSocket: ${backendWsUrl}`);

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
