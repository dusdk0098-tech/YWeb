import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { moveCircle, moveItem, resizeCircle, rotateItem, type SceneItem } from "../src/photo-scene.js";
const origin = "http://127.0.0.1:3000", png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const jpeg = (w: number, h: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 0x11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
test("scene geometry: 90° rotation keeps circles on the same content, four turns restore, moves clamp", () => {
  const item: SceneItem = { photoId: randomUUID(), included: true, rotation: 0, caption: "", circles: [{ x: 0.2, y: 0.1, r: 0.05, color: "red" }] };
  const once = rotateItem(item);
  assert.deepEqual([once.rotation, once.circles[0].x, once.circles[0].y], [90, 0.9, 0.2]); // top-left area moves to top-right
  assert.deepEqual(rotateItem(rotateItem(rotateItem(once))), item);
  assert.deepEqual(moveCircle(item.circles[0], -0.5, 2), { x: 0, y: 1, r: 0.05, color: "red" });
  assert.equal(resizeCircle(item.circles[0], -1).r, 0.01);
  const items = [item, { ...item, photoId: "b" }];
  assert.deepEqual(moveItem(items, 0, 1).map((i) => i.photoId), ["b", item.photoId]);
  assert.equal(moveItem(items, 0, -1), items);
});
test("photo board: originals retained, display set once, scene limited to own photos, version conflicts, roles", async () => {
  const db = openDatabase(":memory:"), site = randomUUID(), other = randomUUID(), password = randomUUID(), hash = await argon2.hash(password), ids: Record<string, string> = {};
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "합성");
  for (const role of ["editor", "viewer"]) {
    ids[role] = randomUUID();
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(ids[role], role + "@example.test", role, hash);
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, ids[role], role);
  }
  try {
    const app = await createApp(db, { origin, secret: "synthetic-photo-board-secret-".repeat(2) });
    const login = async (name: string) => {
      const agent = request.agent(app);
      let r = await agent.get("/api/session");
      r = await agent.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email: name + "@example.test", password });
      return { agent, csrf: r.body.csrf as string };
    };
    const ed = await login("editor"), vw = await login("viewer"), base = `/api/sites/${site}/photo-boards`;
    const send = (a: typeof ed, method: "post" | "put", path: string, body: object, key = randomUUID()) => a.agent[method](path).set("Origin", origin).set("x-csrf-token", a.csrf).set("idempotency-key", key).send(body);
    const raw = (path: string, bytes: Buffer, type: string, name: string, version: number, key = randomUUID()) =>
      ed.agent.post(path).set("Origin", origin).set("x-csrf-token", ed.csrf).set("content-type", "application/octet-stream").set("x-photo-board-version", String(version))
        .set("x-file-name", encodeURIComponent(name)).set("x-file-type", type).set("idempotency-key", key).send(bytes);
    assert.equal((await send(vw, "post", base, { title: "보기 전용" })).status, 403);
    let r = await send(ed, "post", base, { title: "<작업 전후>" });
    assert.equal(r.status, 200, r.text);
    let b = r.body;
    const path = `${base}/${b.id}`;
    r = await raw(`${path}/photos`, png, "image/png", "현장.png", b.version);
    assert.equal(r.status, 200, r.text);
    const photoId = r.body.photoId;
    b = r.body.board;
    assert.equal((await raw(`${path}/photos`, png, "image/png", "현장.png", b.version - 1)).status, 409); // stale board version
    assert.equal((await raw(`${path}/photos/${photoId}/display`, jpeg(2049, 10), "image/jpeg", "display.jpg", b.version)).status, 400);
    r = await raw(`${path}/photos/${photoId}/display`, jpeg(800, 600), "image/jpeg", "display.jpg", b.version);
    assert.equal(r.status, 200, r.text);
    b = r.body;
    assert.deepEqual([b.photos[0].hasDisplay, b.photos[0].width, b.photos[0].height], [true, 800, 600]);
    assert.equal((await raw(`${path}/photos/${photoId}/display`, jpeg(10, 10), "image/jpeg", "display.jpg", b.version)).status, 409); // set once
    const shown = await ed.agent.get(`${path}/photos/${photoId}/display`), original = await vw.agent.get(`${path}/photos/${photoId}/download`);
    assert.deepEqual([shown.headers["content-type"], original.headers["content-type"], original.headers["x-attachment-scan"]], ["image/jpeg", "application/octet-stream", "UNSCANNED"]);
    const scene = { layoutVersion: 1, items: [{ photoId, included: true, rotation: 90, caption: "정리 완료", circles: [{ x: 0.5, y: 0.5, r: 0.1, color: "yellow" }] }] };
    const save = (v: number, s: object) => send(ed, "put", path, { version: v, title: "작업 전후", body: { siteName: "합성 현장", work: "정리", footer: "" }, scene: s });
    assert.equal((await save(b.version, { ...scene, items: [{ ...scene.items[0], photoId: randomUUID() }] })).status, 400); // not this board's photo
    assert.equal((await save(b.version, { ...scene, items: [scene.items[0], scene.items[0]] })).status, 400); // duplicate
    assert.equal((await save(b.version, { ...scene, items: [{ ...scene.items[0], rotation: 45 }] })).status, 400);
    assert.equal((await save(b.version - 1, scene)).status, 409);
    r = await save(b.version, scene);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.scene, scene);
    assert.equal((await send(vw, "put", path, { version: r.body.version, title: "x", body: { siteName: "", work: "", footer: "" }, scene })).status, 403);
    assert.throws(() => db.prepare("UPDATE photo_board_photos SET bytes=x'00'").run());
    assert.throws(() => db.prepare("DELETE FROM photo_board_photos").run());
    assert.equal((await ed.agent.get(`/api/sites/${other}/photo-boards/${b.id}`)).status, 403); // not a member of that site
  } finally {
    db.close();
  }
});
