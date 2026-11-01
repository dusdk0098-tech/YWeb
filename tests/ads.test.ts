import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
// 광고 (결정 6, 2026-11-02 변경: 앱 안에 끄는 스위치 없음): the server fetches a validated feed, keeps the last good copy on
// disk, serves text/link/image itself and shows only ads inside their dates.
const origin = "http://127.0.0.1:3000", feedUrl = "https://feed.example/yweb/ads.json";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]); // header fixture only
const goodFeed = { version: 1, ads: [
  { id: "safety-shop", title: "합성 안전용품", text: "합성 광고 문구", url: "https://example.test/shop", image: "shop.png" },
  { id: "old", title: "지난 광고", text: "", url: "https://example.test/old", to: "2000-01-01" },
] };
test("ads: fetched by the server, cached on disk, dated, no switch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yweb-ads-"));
  let feedBody: string = JSON.stringify(goodFeed);
  const fetches: string[] = [];
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input); fetches.push(url);
    if (url === feedUrl) return new Response(feedBody, { status: 200, headers: { "content-type": "application/json" } });
    if (url === "https://feed.example/yweb/shop.png") return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
    return new Response("missing", { status: 404 });
  }) as unknown as typeof fetch;
  const db = openDatabase(":memory:"), password = randomUUID(), viewer = randomUUID();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(viewer, "v@example.test", "v@example.test", await argon2.hash(password));
  const make = () => createApp(db, { origin, secret: "synthetic-business-only".repeat(3), ads: { feedUrl, dir, fetch: fakeFetch, intervalMs: 3600_000 } });
  let app = await make();
  await app.locals.adsRefresh();
  const login = async (email: string) => {
    const a = request.agent(app), s = await a.get("/api/session");
    const r = await a.post("/api/login").set("Origin", origin).set("x-csrf-token", s.body.csrf).send({ email, password });
    assert.equal(r.status, 200);
    return { a, csrf: r.body.csrf as string };
  };
  try {
    assert.equal((await request(app).get("/api/ads")).status, 401);
    const v = await login("v@example.test");
    let r = await v.a.get("/api/ads");
    assert.equal(r.body.enabled, true);
    assert.deepEqual(r.body.ads, [{ id: "safety-shop", title: "합성 안전용품", text: "합성 광고 문구", url: "https://example.test/shop", image: true }]);
    assert.ok(r.body.fetchedAt);
    r = await v.a.get("/api/ads/image/safety-shop");
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "image/png");
    assert.equal((await v.a.get("/api/ads/image/old")).status, 404);
    assert.ok(existsSync(join(dir, "feed.json")) && existsSync(join(dir, "img-safety-shop.png")));
    assert.ok(fetches.every((u) => !u.includes("?")), "the feed request carries no query data");
    assert.equal((await v.a.get("/api/session")).body.adsEnabled, true);
    // a broken feed keeps the last good copy
    feedBody = JSON.stringify({ version: 1, ads: [{ id: "x", title: "no https", url: "http://example.test", text: "" }] });
    await app.locals.adsRefresh();
    r = await v.a.get("/api/ads");
    assert.equal(r.body.ads.length, 1);
    assert.match(r.body.lastError, /https only|invalid/i);
    feedBody = "not json";
    await app.locals.adsRefresh();
    assert.equal((await v.a.get("/api/ads")).body.ads.length, 1);
    assert.equal((await v.a.put("/api/ads/settings").set("Origin", origin).set("x-csrf-token", v.csrf).send({ enabled: false })).status, 404); // no switch
    // a new process with an unreachable feed still serves the copy on disk
    feedBody = "not json";
    app = await make();
    await app.locals.adsRefresh();
    const again = await login("v@example.test");
    assert.equal((await again.a.get("/api/ads")).body.ads[0].id, "safety-shop");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
