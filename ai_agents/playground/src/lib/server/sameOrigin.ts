/**
 * Validate browser mutations using the origin plus the host/protocol seen at
 * ingress. Reverse proxies can normalize default ports or report both the
 * public and upstream host, so compare parsed origins rather than raw strings.
 */
export function isSameOriginRequest(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return false;

  let origin: URL;
  let requestProtocol: string;
  try {
    origin = new URL(originHeader);
    requestProtocol = new URL(request.url).protocol;
  } catch {
    return false;
  }

  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== "" ||
    origin.username !== "" ||
    origin.password !== ""
  ) {
    return false;
  }

  const forwardedHosts = (request.headers.get("x-forwarded-host") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const directHosts = (request.headers.get("host") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const hosts = [...forwardedHosts, ...directHosts];
  if (!hosts.length) return false;

  const forwardedProtocols = (request.headers.get("x-forwarded-proto") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value === "http" || value === "https")
    .map((value) => `${value}:`);
  const protocols = [...new Set([...forwardedProtocols, requestProtocol])].filter(
    (value) => value === "http:" || value === "https:"
  );

  for (const protocol of protocols) {
    for (const host of hosts) {
      try {
        const candidate = new URL(`${protocol}//${host}`);
        if (
          candidate.pathname === "/" &&
          candidate.search === "" &&
          candidate.hash === "" &&
          candidate.username === "" &&
          candidate.password === "" &&
          candidate.origin === origin.origin
        ) {
          return true;
        }
      } catch {
        // Ignore malformed proxy entries and check the remaining trusted host.
      }
    }
  }

  // A matching Origin is the CSRF boundary; Fetch Metadata can be inaccurate
  // when a same-origin app is embedded or relayed by a private development proxy.
  return false;
}
