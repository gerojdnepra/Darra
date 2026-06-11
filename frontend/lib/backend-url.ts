"use client";

export const localBackendHttpBaseUrl = "http://127.0.0.1:3001";
export const localBackendWsUrl = "ws://127.0.0.1:3001/ws";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

export const isLoopbackHost = (hostname: string): boolean =>
  loopbackHosts.has(hostname.trim().toLowerCase());

export const normalizeBackendPath = (url: URL): string =>
  !url.pathname || url.pathname === "/" ? "/ws" : url.pathname;

export const normalizeLocalBackendWsUrl = (value: string): string => {
  const trimmed = value.trim();

  if (!trimmed) {
    return localBackendWsUrl;
  }

  try {
    const parsed = new URL(trimmed);

    if (
      (parsed.protocol === "ws:" || parsed.protocol === "wss:") &&
      isLoopbackHost(parsed.hostname) &&
      (parsed.port === "" || parsed.port === "3001")
    ) {
      parsed.protocol = "ws:";
      parsed.hostname = "127.0.0.1";
      parsed.port = "3001";
      parsed.pathname = normalizeBackendPath(parsed);
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    }
  } catch {
    return trimmed;
  }

  return trimmed;
};

export const resolveBackendHttpBaseUrl = (backendWsUrl: string): string => {
  const normalizedWsUrl = normalizeLocalBackendWsUrl(backendWsUrl);

  try {
    const parsed = new URL(normalizedWsUrl);
    parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
};
