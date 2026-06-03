import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const command = process.execPath;
const nextCli = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const backendPort = process.env.BACKEND_PORT || readRootEnv("BACKEND_PORT") || "3001";

const configuredBackendWsUrl =
  process.env.NEXT_PUBLIC_ANDROID_BACKEND_WS_URL ||
  process.env.NEXT_PUBLIC_BACKEND_WS_URL ||
  readRootEnv("NEXT_PUBLIC_ANDROID_BACKEND_WS_URL") ||
  readRootEnv("NEXT_PUBLIC_BACKEND_WS_URL") ||
  "";

const backendWsUrl = shouldReplaceWithLanUrl(configuredBackendWsUrl)
  ? buildLanBackendUrl(backendPort)
  : configuredBackendWsUrl;

if (backendWsUrl) {
  console.log(`Android backend WebSocket: ${backendWsUrl}`);
}

const result = spawnSync(command, [nextCli, "build"], {
  env: {
    ...process.env,
    ...(backendWsUrl ? { NEXT_PUBLIC_BACKEND_WS_URL: backendWsUrl } : {}),
    NEXT_OUTPUT_MODE: "export"
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

function shouldReplaceWithLanUrl(value) {
  const trimmed = value.trim();

  if (!trimmed) {
    return true;
  }

  return /^wss?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(trimmed);
}

function buildLanBackendUrl(port) {
  const address = getPreferredLanAddress();
  return address ? `ws://${address}:${port}/ws` : "";
}

function getPreferredLanAddress() {
  const windowsAddress = getPreferredWindowsLanAddress();

  if (windowsAddress) {
    return windowsAddress;
  }

  return Object.entries(os.networkInterfaces())
    .flatMap(([name, addresses]) =>
      (addresses ?? []).map((address) => ({
        name,
        address: address.address,
        family: address.family,
        internal: address.internal
      }))
    )
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .filter((entry) => !entry.address.startsWith("169.254."))
    .map((entry) => ({
      ...entry,
      score: scoreInterface(entry.name, entry.address)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.address;
}

function getPreferredWindowsLanAddress() {
  if (process.platform !== "win32") {
    return "";
  }

  const script = `
    Get-NetIPConfiguration |
      Where-Object { $_.IPv4Address -and $_.IPv4DefaultGateway } |
      ForEach-Object {
        $address = $_.IPv4Address |
          Where-Object { $_.IPAddress -notlike '169.254.*' } |
          Select-Object -First 1 -ExpandProperty IPAddress

        if ($address) {
          [PSCustomObject]@{
            Name = $_.InterfaceAlias
            Description = $_.InterfaceDescription
            Address = $address
          }
        }
      } |
      ConvertTo-Json -Compress
  `;

  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8"
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    return "";
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const entries = Array.isArray(parsed) ? parsed : [parsed];

    return entries
      .filter((entry) => entry?.Address)
      .map((entry) => ({
        address: entry.Address,
        score: scoreInterface(`${entry.Name ?? ""} ${entry.Description ?? ""}`, entry.Address)
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.address ?? "";
  } catch {
    return "";
  }
}

function scoreInterface(name, address) {
  if (/vethernet|wsl|virtual|docker|loopback|hyper-v|vmware|virtualbox/i.test(name)) {
    return 0;
  }

  let score = /^10\.|^172\.(1[6-9]|2\d|3[0-1])\.|^192\.168\./.test(address) ? 10 : 1;

  if (/wi-?fi|wireless|wlan|беспровод/i.test(name)) {
    score += 30;
  } else if (/ethernet/i.test(name)) {
    score += 20;
  }

  return score;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
