import type { Request } from "express";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
// Shared by install-wide settings (AI keys, internet access): who counts as "this PC", and how stored secrets are sealed.
// Secrets are AES-256-GCM sealed with a key derived from SESSION_SECRET, so a copied DB or backup alone does not reveal them.
const keyFor = (secret: string) => createHash("sha256").update("yweb-ai-key-v1|" + secret).digest();
export function sealSecret(secret: string, value: string) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const cipher = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), cipher: cipher.toString("base64") };
}
export function openSecret(secret: string, row: { iv: string; tag: string; cipher: string }) {
  try {
    const d = createDecipheriv("aes-256-gcm", keyFor(secret), Buffer.from(row.iv, "base64"));
    d.setAuthTag(Buffer.from(row.tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(row.cipher, "base64")), d.final()]).toString("utf8");
  } catch { return undefined; } // SESSION_SECRET changed: the secret must be registered again
}
// Install-wide settings change only from a browser on the server PC itself, so opening the app to the internet never exposes them.
// Host must be the loopback address too: a tunnel (cloudflared) also connects from 127.0.0.1 but keeps the public Host header.
export function isLocalRequest(req: Request) {
  const ip = req.socket.remoteAddress || "";
  const host = (req.get("host") || "").replace(/:\d+$/, "").toLowerCase();
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip) && ["127.0.0.1", "localhost", "[::1]"].includes(host)
    && !req.get("x-forwarded-for") && !req.get("cf-connecting-ip");
}
