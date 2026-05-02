export function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const cookieHeader = Array.isArray(header) ? header.join("; ") : header;
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...rest] = part.split("=");
        return [name, decodeURIComponent(rest.join("="))];
      })
  );
}

export function serializeAuthCookie(name: string, value: string, options: { maxAgeSeconds: number; secure: boolean }): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${options.maxAgeSeconds}`];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

export function serializeExpiredCookie(name: string, secure: boolean): string {
  const parts = [`${name}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
