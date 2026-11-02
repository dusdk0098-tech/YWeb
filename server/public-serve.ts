import type { Express } from "express";
import express from "express";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { join } from "node:path";
import acme from "acme-client";
import type { PublicRuntime, PublicSettings } from "./public-access.js";
// Runtime side of self-hosting; see public-access.ts for the settings. Everything with the outside world (ACME CA, cloudflared,
// sockets) is injectable so the logic is testable without a real domain.
export const RENEW_DAYS = 30;
type Cert = { cert: string; key: string; notAfter: Date };
export type Issue = (domain: string, email: string, dir: string, challenges: Map<string, string>) => Promise<{ cert: string; key: string }>;
// HTTP-01 challenge answers live only in memory, for the few seconds an order is validated.
export function redirectApp(domain: string, challenges: Map<string, string>, httpsPort: number) {
  const app = express();
  app.disable("x-powered-by");
  app.get("/.well-known/acme-challenge/:token", (req, res) => {
    const answer = challenges.get(req.params.token);
    if (!answer) return res.status(404).end();
    res.type("text/plain").send(answer);
  });
  app.use((req, res) => res.redirect(301, `https://${domain}${httpsPort === 443 ? "" : ":" + httpsPort}${req.originalUrl}`));
  return app;
}
// http-01 against one ACME directory. The account key is kept (one file per directory) so renewals reuse the same account;
// the wizard's reachability test uses the staging directory with its own key (public-checks.ts).
export const acmeIssue = (directoryUrl: string, accountFile: string): Issue => async (domain, email, dir, challenges) => {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const accountPath = join(dir, accountFile);
  if (!existsSync(accountPath)) writeFileSync(accountPath, await acme.crypto.createPrivateKey(), { mode: 0o600 });
  const client = new acme.Client({ directoryUrl, accountKey: readFileSync(accountPath) });
  const [key, csr] = await acme.crypto.createCsr({ commonName: domain });
  const cert = await client.auto({
    csr, email: email || undefined, termsOfServiceAgreed: true, challengePriority: ["http-01"],
    challengeCreateFn: async (_a, challenge, keyAuthorization) => { challenges.set(challenge.token, keyAuthorization); },
    challengeRemoveFn: async (_a, challenge) => { challenges.delete(challenge.token); },
  });
  return { cert, key: key.toString() };
};
export const letsEncryptIssue: Issue = acmeIssue(acme.directory.letsencrypt.production, "account.key");
const notAfter = (pem: string) => acme.crypto.readCertificateInfo(pem).notAfter;
// Reuse the stored certificate until RENEW_DAYS before expiry (or when it was issued for another domain), then issue a new one.
export async function ensureCertificate(o: { domain: string; email: string; dir: string; challenges: Map<string, string>; issue?: Issue; readNotAfter?: (pem: string) => Date; now?: Date }): Promise<Cert & { renewed: boolean }> {
  const read = o.readNotAfter ?? notAfter, now = o.now ?? new Date(), certPath = join(o.dir, "cert.pem"), keyPath = join(o.dir, "key.pem"), domainPath = join(o.dir, "domain.txt");
  mkdirSync(o.dir, { recursive: true, mode: 0o700 });
  if (existsSync(certPath) && existsSync(keyPath) && existsSync(domainPath) && readFileSync(domainPath, "utf8") === o.domain) {
    const cert = readFileSync(certPath, "utf8"), until = read(cert);
    if (until.getTime() - now.getTime() > RENEW_DAYS * 86400000) return { cert, key: readFileSync(keyPath, "utf8"), notAfter: until, renewed: false };
  }
  const issued = await (o.issue ?? letsEncryptIssue)(o.domain, o.email, o.dir, o.challenges);
  writeFileSync(keyPath, issued.key, { mode: 0o600 });
  writeFileSync(certPath, issued.cert, { mode: 0o600 });
  writeFileSync(domainPath, o.domain, { mode: 0o600 });
  return { ...issued, notAfter: read(issued.cert), renewed: true };
}
export async function startDirect(app: Express, s: PublicSettings, runtime: PublicRuntime, o: { dir: string; httpPort: number; httpsPort: number; issue?: Issue }) {
  const challenges = new Map<string, string>(), host = "0.0.0.0";
  const redirect = http.createServer(redirectApp(s.domain, challenges, o.httpsPort));
  await new Promise<void>((ok, fail) => redirect.once("error", fail).listen(o.httpPort, host, ok));
  runtime.state = "인증서 확인 중";
  const c = await ensureCertificate({ domain: s.domain, email: s.email, dir: o.dir, challenges, issue: o.issue });
  const server = https.createServer({ cert: c.cert, key: c.key }, app);
  await new Promise<void>((ok, fail) => server.once("error", fail).listen(o.httpsPort, host, ok));
  Object.assign(runtime, { state: "실행 중", detail: `https://${s.domain} (포트 ${o.httpPort}/${o.httpsPort})`, certNotAfter: c.notAfter.toISOString() });
  const timer = setInterval(() => {
    ensureCertificate({ domain: s.domain, email: s.email, dir: o.dir, challenges, issue: o.issue })
      .then((n) => { if (n.renewed) server.setSecureContext({ cert: n.cert, key: n.key }); runtime.certNotAfter = n.notAfter.toISOString(); })
      .catch((e: Error) => { runtime.detail = "인증서 갱신 실패(다시 시도함): " + e.message; });
  }, 12 * 3600000);
  timer.unref();
  return { close: () => { clearInterval(timer); redirect.close(); server.close(); } };
}
// cloudflared from PATH, CLOUDFLARED_PATH, or the default Windows (winget/msi) install location.
export function findCloudflared(env = process.env, exists = existsSync) {
  if (env.CLOUDFLARED_PATH) return env.CLOUDFLARED_PATH;
  const win = ["C:\\Program Files (x86)\\cloudflared\\cloudflared.exe", "C:\\Program Files\\cloudflared\\cloudflared.exe"].find((p) => exists(p));
  return win ?? "cloudflared";
}
type Spawn = (cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv; stdio: ["ignore", "pipe", "pipe"]; windowsHide: boolean }) => ChildProcess;
// The token goes through the TUNNEL_TOKEN environment variable, never argv (argv is visible to other local users).
export function startTunnel(token: string, runtime: PublicRuntime, o: { bin?: string; spawnFn?: Spawn; retryMs?: number; onRunning?: () => void } = {}) {
  let child: ChildProcess | undefined, stopped = false, delay = o.retryMs ?? 5000;
  const run = () => {
    runtime.state = "터널 연결 중";
    const c = (o.spawnFn ?? (spawn as unknown as Spawn))(o.bin ?? findCloudflared(), ["tunnel", "--no-autoupdate", "run"], { env: { ...process.env, TUNNEL_TOKEN: token }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child = c;
    c.stderr?.on("data", (d: Buffer) => { if (/Registered tunnel connection/i.test(d.toString())) { if (runtime.state !== "실행 중") o.onRunning?.(); runtime.state = "실행 중"; delay = o.retryMs ?? 5000; } });
    c.on("error", (e: NodeJS.ErrnoException) => {
      runtime.state = "중지";
      runtime.detail = e.code === "ENOENT" ? "cloudflared를 찾지 못했습니다. 설치 후 앱을 다시 시작하세요(docs/SELF_HOSTING.md)." : "cloudflared 실행 실패: " + e.message;
      stopped = true;
    });
    c.on("exit", (code) => {
      if (stopped) return;
      runtime.state = "재연결 대기";
      runtime.detail = `cloudflared 종료(코드 ${code}). ${Math.round(delay / 1000)}초 뒤 다시 연결합니다. 토큰이 맞는지 확인하세요.`;
      setTimeout(run, delay).unref();
      delay = Math.min(delay * 2, 60000);
    });
  };
  run();
  return { close: () => { stopped = true; child?.kill(); } };
}
