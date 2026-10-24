/**
 * Validate browser mutations using the browser Origin and ingress hosts.
 * Reverse proxies can terminate TLS, normalize default ports, or report both
 * the public and upstream host, so compare parsed authorities, not raw strings.
 */
export function isSameOriginRequest(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return false;

  let origin: URL;
  let requestUrl: URL;
  try {
    origin = new URL(originHeader);
    requestUrl = new URL(request.url);
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
  const hosts = [...forwardedHosts, ...directHosts, requestUrl.host];
  if (!hosts.length) return false;

  // Compare host and port using the browser Origin's scheme. TLS may terminate
  // at the Codespaces proxy, so the app can see an internal HTTP scheme even
  // though the browser is on HTTPS; the Origin's host must still match exactly.
  for (const host of hosts) {
    try {
      const candidate = new URL(`${origin.protocol}//${host}`);
      if (
        candidate.pathname === "/" &&
        candidate.search === "" &&
        candidate.hash === "" &&
        candidate.username === "" &&
        candidate.password === "" &&
        candidate.host === origin.host
      ) {
        return true;
      }
    } catch {
      // Ignore malformed proxy entries and check the remaining trusted host.
    }
  }

  // A matching Origin is the CSRF boundary; Fetch Metadata can be inaccurate
  // when a same-origin app is embedded or relayed by a private development proxy.
  return false;
}
