/**
 * Writes Cloudflare's `_headers` file for the static build.
 *
 * Waku inlines its bootstrap and RSC payload as `<script>` tags, so the CSP allows
 * exactly those scripts by hash instead of falling back to 'unsafe-inline'.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT_DIR = "dist/public";

async function htmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".html")).map((e) => join(e.parentPath, e.name));
}

function inlineScriptHashes(html: string): string[] {
  const scripts = html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g);
  return [...scripts].map(
    ([, body = ""]) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`,
  );
}

const pages = await htmlFiles(OUT_DIR);
const hashes = new Set(
  (await Promise.all(pages.map((p) => readFile(p, "utf8")))).flatMap(inlineScriptHashes),
);

const csp = [
  "default-src 'self'",
  `script-src 'self' ${[...hashes].join(" ")}`,
  // CodeMirror and React Flow inject <style> elements and style attributes at runtime.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const headers = `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;

await writeFile(join(OUT_DIR, "_headers"), headers);
console.warn(`Wrote ${OUT_DIR}/_headers (${hashes.size} inline script hashes from ${pages.length} pages)`);
