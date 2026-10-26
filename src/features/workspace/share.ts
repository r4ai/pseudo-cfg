import type { Language } from "@/features/cfg/build-cfg";

const PREFIX = "#code=";

/** Code carried by a share link. */
export type Shared = { source: string; language: Language };

/**
 * A link that opens the app with `source` in the editor. The code travels in the
 * fragment, which browsers never send to the server. Python, the original language,
 * is left implicit so that links made before other languages existed stay valid.
 */
export function shareUrl({ source, language }: Shared, base: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(source)) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  const url = new URL(base);
  const code = base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  url.hash = PREFIX.slice(1) + code + (language === "python" ? "" : `&lang=${language}`);
  return url.toString();
}

/** The code in a link made by `shareUrl`, or null if the fragment holds none or is corrupt. */
export function sharedSource(hash: string): Shared | null {
  if (!hash.startsWith(PREFIX)) return null;
  const params = new URLSearchParams(hash.slice(1));
  const lang = params.get("lang") ?? "python";
  if (lang !== "python" && lang !== "cuda") return null;
  try {
    const base64 = (params.get("code") ?? "").replaceAll("-", "+").replaceAll("_", "/");
    const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
    return { source: new TextDecoder("utf-8", { fatal: true }).decode(bytes), language: lang };
  } catch {
    return null;
  }
}
