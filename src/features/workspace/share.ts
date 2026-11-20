import type { Language } from "@/features/cfg/build-cfg";

const CODE_PREFIX = "#code=";
const SPEC_PREFIX = "#spec=";

/** Code carried by a share link. */
export type Shared = { source: string; language: Language };

function encodeUtf8Base64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeUtf8Base64Url(encoded: string): string {
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * A link that opens the app with `source` in the editor. The code travels in the
 * fragment, which browsers never send to the server. Python, the original language,
 * is left implicit so that links made before other languages existed stay valid.
 */
export function shareUrl({ source, language }: Shared, base: string): string {
  const url = new URL(base);
  const code = encodeUtf8Base64Url(source);
  url.hash = CODE_PREFIX.slice(1) + code + (language === "python" ? "" : `&lang=${language}`);
  return url.toString();
}

/** The code in a link made by `shareUrl`, or null if the fragment holds none or is corrupt. */
export function sharedSource(hash: string): Shared | null {
  if (!hash.startsWith(CODE_PREFIX)) return null;
  const params = new URLSearchParams(hash.slice(1));
  const lang = params.get("lang") ?? "python";
  if (lang !== "python" && lang !== "cuda") return null;
  try {
    return { source: decodeUtf8Base64Url(params.get("code") ?? ""), language: lang };
  } catch {
    return null;
  }
}

/**
 * A link that opens the app with a full declarative YAML spec (code + granularity +
 * manual node positions + edge overrides) encoded in the `#spec=` URL fragment.
 */
export function shareSpecUrl(yaml: string, base: string): string {
  const url = new URL(base);
  url.hash = SPEC_PREFIX.slice(1) + encodeUtf8Base64Url(yaml);
  return url.toString();
}

/** The declarative YAML spec in a link made by `shareSpecUrl`, or null if missing or corrupt. */
export function sharedSpec(hash: string): string | null {
  if (!hash.startsWith(SPEC_PREFIX)) return null;
  const params = new URLSearchParams(hash.slice(1));
  const raw = params.get("spec");
  if (!raw) return null;
  try {
    return decodeUtf8Base64Url(raw);
  } catch {
    return null;
  }
}
