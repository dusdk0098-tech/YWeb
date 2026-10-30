import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import argon2 from "argon2";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import {
  boundedUploadReader,
  MAX_ATTACHMENT_BYTES,
} from "../server/bounded-upload.js";
import { HttpError } from "../server/site-operations.js";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]); // header fixture only; NOT an image
function stream(length?: number) {
  const r = new PassThrough() as PassThrough & {
    headers: Record<string, string>;
    aborted: boolean;
  };
  r.headers = length === undefined ? {} : { "content-length": String(length) };
  r.aborted = false;
  return r;
}
const incoming = (r: ReturnType<typeof stream>) =>
  r as unknown as IncomingMessage;
test("raw reader actual cap, length, two slots, timeout, abort and error release", async () => {
  const read = boundedUploadReader(30);
  const a = stream(),
    b = stream(),
    c = stream();
  const pa = read(incoming(a)),
    pb = read(incoming(b));
  assert.throws(
    () => read(incoming(c)),
    (e: unknown) => e instanceof HttpError && e.status === 429,
  );
  const aborted = assert.rejects(pa, /중단/);
  a.emit("aborted");
  await aborted;
  const pc = read(incoming(c));
  c.end(png);
  assert.deepEqual(await pc, png);
  await assert.rejects(pb, /30초/);
  const d = stream();
  const pd = read(incoming(d));
  d.end(png);
  await pd;
  const huge = stream(MAX_ATTACHMENT_BYTES + 1);
  assert.throws(() => read(incoming(huge)), /5 MiB/);
  const chunked = stream();
  const over = read(incoming(chunked));
  chunked.write(Buffer.alloc(MAX_ATTACHMENT_BYTES));
  chunked.write(Buffer.alloc(1));
  await assert.rejects(over, /5 MiB/);
  const mismatch = stream(5);
  const pm = read(incoming(mismatch));
  mismatch.end(Buffer.alloc(3));
  await assert.rejects(pm, /길이/);
  const empty = stream();
  const pe = read(incoming(empty));
  empty.end();
  await assert.rejects(pe, /비어/);
  const broken = stream();
  const pf = read(incoming(broken));
  broken.emit("error", new Error("fixture"));
  await assert.rejects(pf, /전송/);
  const final = stream();
  const last = read(incoming(final));
  final.end(png);
  await last;
  for (const r of [a, b, c, d, chunked, mismatch, empty, broken, final])
    assert.equal(r.listenerCount("data"), 0);
});
test("raw originals are bounded private retained records with immutable submission manifest", async () => {
  const db = openDatabase(":memory:"),
    origin = "http://127.0.0.1:3000",
    password = randomUUID(),
    hash = await argon2.hash(password);
  const owner = randomUUID(),
    viewer = randomUUID(),
    other = randomUUID(),
    site = randomUUID();
  for (const id of [owner, viewer, other])
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      id,
      id + "@example.test",
      id,
      hash,
    );
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "첨부 현장");
  for (const [id, role] of [
    [owner, "manager"],
    [viewer, "viewer"],
  ])
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, id, role);
  const app = await createApp(db, { origin, secret: "x".repeat(48) });
  async function login(id: string) {
    const agent = request.agent(app);
    let r = await agent.get("/api/session");
    r = await agent
      .post("/api/login")
      .set("Origin", origin)
      .set("x-csrf-token", r.body.csrf)
      .send({ email: id + "@example.test", password });
    assert.equal(r.status, 200);
    return {
      agent,
      csrf: r.body.csrf,
      cookie: (r.headers["set-cookie"] as unknown as string[])
        .map((s) => s.split(";")[0])
        .join("; "),
    };
  }
  const o = await login(owner),
    v = await login(viewer),
    x = await login(other);
  const post = (u: typeof o, path: string, body: object, key = randomUUID()) =>
    u.agent
      .post(path)
      .set("Origin", origin)
      .set("x-csrf-token", u.csrf)
      .set("idempotency-key", key)
      .send(body);
  const url = `/api/sites/${site}/hazards`;
  const created = await post(o, url, {
    title: "test",
    observedDate: "2026-10-28",
    location: "x",
    description: "x",
  });
  assert.equal(created.status, 200);
  const path = url + "/" + created.body.id,
    base = path + "/attachments";
  const upload = (
    u: typeof o,
    version: number,
    key = randomUUID(),
    name = "fixture.png",
    bytes = png,
  ) =>
    u.agent
      .post(base)
      .set("Origin", origin)
      .set("x-csrf-token", u.csrf)
      .set("idempotency-key", key)
      .set("Content-Type", "application/octet-stream")
      .set("x-file-name", encodeURIComponent(name))
      .set("x-file-type", "image/png")
      .set("x-hazard-version", String(version))
      .send(bytes);
  try {
    assert.equal((await upload(v, 1)).status, 403);
    assert.equal((await upload(x, 1)).status, 403);
    assert.equal((await upload(o, 1, randomUUID(), "../bad.png")).status, 400);
    assert.equal(
      (await upload(o, 1, randomUUID(), "bad.png", Buffer.from("notimage")))
        .status,
      400,
    );
    assert.equal(
      (await post(o, base, { large: "x".repeat(300000) })).status,
      415,
    );
    const key = randomUUID(),
      saved = await upload(o, 1, key);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.record.version, 2);
    const attachment = saved.body.attachments[0];
    assert.equal(
      attachment.sha256,
      createHash("sha256").update(png).digest("hex"),
    );
    assert.deepEqual((await upload(o, 1, key)).body, saved.body);
    assert.equal((await upload(o, 1, randomUUID())).status, 409);
    const down = await v.agent.get(base + `/${attachment.id}/download`);
    assert.equal(down.status, 200);
    assert.equal(down.headers["content-type"], "application/octet-stream");
    assert.match(down.headers["content-disposition"], /^attachment;/);
    assert.equal(down.headers["x-attachment-scan"], "UNSCANNED");
    assert.deepEqual(down.body, png);
    assert.equal((await x.agent.get(base)).status, 403);
    let changed = await post(o, base + `/${attachment.id}/state`, {
      version: 2,
      attached: false,
      reason: "분리",
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.attachments[0].attached, 0);
    assert.equal(
      (
        db.prepare("SELECT count(*) AS n FROM hazard_attachments").get() as {
          n: number;
        }
      ).n,
      1,
    );
    changed = await post(o, base + `/${attachment.id}/state`, {
      version: 3,
      attached: true,
      reason: "재연결",
    });
    assert.equal(changed.status, 200);
    const submitted = await post(o, path + "/submit", { version: 4 });
    assert.equal(submitted.status, 200);
    assert.equal(
      submitted.body.submitted_snapshot.attachments[0].sha256,
      attachment.sha256,
    );
    assert.equal((await upload(o, 1, key)).status, 409);
    assert.equal(
      (
        await post(o, base + `/${attachment.id}/state`, {
          version: 5,
          attached: false,
          reason: "불가",
        })
      ).status,
      409,
    );
    assert.throws(() =>
      db
        .prepare("UPDATE hazard_attachments SET attached=0 WHERE id=?")
        .run(attachment.id),
    );
    assert.throws(() =>
      db
        .prepare("DELETE FROM hazard_attachments WHERE id=?")
        .run(attachment.id),
    );
    assert.throws(() =>
      db
        .prepare("UPDATE hazard_attachments SET bytes=? WHERE id=?")
        .run(Buffer.alloc(png.length), attachment.id),
    );
    const print = await v.agent.get(path + "/print");
    assert.equal(print.status, 200);
    assert.match(print.text, /fixture.png/);
    assert.match(print.text, /UNSCANNED/);
    assert.ok(!print.text.includes("<img"));
    // Real bounded HTTP stream paused across other operations, not a fabricated req.body.
    const server = createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      async function midstream(
        intervene: (p: string) => Promise<unknown> | void,
      ) {
        const fresh = await post(o, url, {
          title: "race",
          observedDate: "2026-10-28",
          location: "x",
          description: "x",
        });
        assert.equal(fresh.status, 200);
        const p = url + "/" + fresh.body.id;
        let started!: () => void;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        server.once("request", () => setImmediate(started));
        let client!: ReturnType<typeof httpRequest>;
        const result = new Promise<number>((resolve, reject) => {
          client = httpRequest(
            {
              host: "127.0.0.1",
              port: (server.address() as AddressInfo).port,
              path: p + "/attachments",
              method: "POST",
              headers: {
                cookie: o.cookie,
                origin,
                "x-csrf-token": o.csrf,
                "idempotency-key": randomUUID(),
                "content-type": "application/octet-stream",
                "content-length": String(png.length),
                "x-file-name": "race.png",
                "x-file-type": "image/png",
                "x-hazard-version": "1",
              },
            },
            (res) => {
              res.resume();
              res.on("end", () => resolve(res.statusCode!));
            },
          );
          client.on("error", reject);
          client.write(png.subarray(0, 4));
        });
        await ready;
        await intervene(p);
        client.end(png.subarray(4));
        const status = await result;
        assert.equal(
          (
            db
              .prepare(
                "SELECT count(*) AS n FROM hazard_attachments WHERE report_id=?",
              )
              .get(fresh.body.id) as { n: number }
          ).n,
          0,
        );
        return status;
      }
      assert.equal(
        await midstream(() => {
          db.prepare(
            "DELETE FROM memberships WHERE site_id=? AND user_id=?",
          ).run(site, owner);
        }),
        403,
      );
      db.prepare("INSERT INTO memberships VALUES(?,?,'manager')").run(
        site,
        owner,
      );
      assert.equal(
        await midstream(async (p) => {
          assert.equal(
            (await post(o, p + "/submit", { version: 1 })).status,
            200,
          );
        }),
        409,
      );
      assert.equal(
        await midstream(async () => {
          assert.equal((await post(o, "/api/logout", {})).status, 204);
        }),
        401,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  } finally {
    db.close();
  }
});
