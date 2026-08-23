export type BrowserLocation = Pick<Location, "hostname" | "origin" | "port" | "protocol">;

export function resolveAdminConsoleUrl(
  configuredUrl: string | undefined,
  location: BrowserLocation,
): string | null {
  const configured = configuredUrl?.trim();
  if (configured !== undefined && configured !== "") {
    try {
      const url = new URL(configured, location.origin);
      return isSafeAdminUrl(url) ? normalizeAdminUrl(url) : null;
    } catch {
      return null;
    }
  }

  if (!isLoopbackHostname(location.hostname)) return null;
  const port = Number.parseInt(location.port, 10);
  if (!Number.isInteger(port) || port < 1 || port >= 65_535) return null;

  return `${location.protocol}//${formatHostname(location.hostname)}:${port + 1}`;
}

export function readBrowserAdminConsoleUrl(configuredUrl: string | undefined): string | null {
  if (typeof window === "undefined") return null;

  try {
    return resolveAdminConsoleUrl(configuredUrl, window.location);
  } catch {
    return null;
  }
}

function isSafeAdminUrl(url: URL): boolean {
  if (url.username !== "" || url.password !== "") return false;
  if (url.search !== "" || url.hash !== "") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && isLoopbackHostname(url.hostname);
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function formatHostname(hostname: string): string {
  return hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
}

function normalizeAdminUrl(url: URL): string {
  return url.pathname === "/" ? url.origin : url.toString();
}
