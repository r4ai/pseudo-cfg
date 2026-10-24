const PREFIX = "#code=";

/**
 * A link that opens the app with `source` in the editor. The code travels in the
 * fragment, which browsers never send to the server.
 */
export function shareUrl(source: string, base: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(source)) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  const url = new URL(base);
  url.hash = PREFIX.slice(1) + base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return url.toString();
}

/** The code in a link made by `shareUrl`, or null if the fragment holds none or is corrupt. */
export function sharedSource(hash: string): string | null {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const base64 = hash.slice(PREFIX.length).replaceAll("-", "+").replaceAll("_", "/");
    const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
