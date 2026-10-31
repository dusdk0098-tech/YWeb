import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { costEvidenceFixture, pdf, png } from "./fixtures/cost-evidence-fixture.js";
import { imageSize } from "../server/image-size.js";
const origin = "http://127.0.0.1:3000";
// Synthetic JPEG header: SOI, APP0, SOF0 with the given size, EOI. Not a decodable picture; the server never decodes.
function jpeg(width: number, height: number, pad = 0) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]),
    Buffer.alloc(pad), Buffer.from([0xff, 0xd9]),
  ]);
}
test("image size reads PNG IHDR and JPEG SOF without decoding", () => {
  assert.deepEqual(imageSize(jpeg(640, 480)), { width: 640, height: 480 });
  const ihdr = Buffer.concat([png.subarray(0, 8), Buffer.from([0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 3, 32, 0, 0, 2, 88])]);
  assert.deepEqual(imageSize(ihdr), { width: 800, height: 600 });
  assert.equal(imageSize(pdf), null);
  assert.equal(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), null);
});
test("SC 사진대지 display: browser JPEG only, fixed image, open-month labels, preflight warnings, per-group print", async () => {
  const f = await costEvidenceFixture();
  try {
    await f.expense("안전망 설치");
    let r = await f.upload(png, "현장.png", "image/png");
    assert.equal(r.status, 200, r.text);
    const photo = r.body.items[0].file.id;
    r = await f.upload(pdf, "영수증.pdf", "application/pdf");
    const receipt = r.body.items.find((i: { file: { format: string } }) => i.file.format === "application/pdf").file.id;
    const put = async (id: string, bytes: Buffer, type = "image/jpeg", name = "display.jpg", key = randomUUID()) => {
      const p = await f.current();
      return f.agent.post(`${f.siteBase}${f.base}/evidence/files/${id}/display`).set("Origin", origin).set("x-csrf-token", f.csrf)
        .set("content-type", "application/octet-stream").set("x-cost-period-version", String(p.version))
        .set("x-file-name", encodeURIComponent(name)).set("x-file-type", type).set("idempotency-key", key).send(bytes);
    };
    assert.equal((await put(photo, png, "image/png", "display.png")).status, 400); // JPEG only
    assert.equal((await put(photo, jpeg(2049, 10))).status, 400); // long side cap
    assert.equal((await put(photo, jpeg(10, 10, 1024 * 1024))).status, 400); // 1MB cap
    assert.equal((await put(receipt, jpeg(10, 10))).status, 400); // PDF original has no display
    assert.equal((await put(randomUUID(), jpeg(10, 10))).status, 404);
    let board = (await f.agent.get(`${f.siteBase}${f.base}/photo-board`)).body;
    assert.deepEqual([board.photos.length, board.missingDisplay], [0, 1]);
    const key = randomUUID();
    r = await put(photo, jpeg(1600, 1200), "image/jpeg", "display.jpg", key);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.width, r.body.height], [1600, 1200]);
    assert.equal((await put(photo, jpeg(1600, 1200), "image/jpeg", "display.jpg", key)).status, 200); // idempotent replay
    assert.equal((await put(photo, jpeg(800, 600))).status, 409); // display is fixed once made
    assert.throws(() => f.db.prepare("UPDATE cost_evidence_displays SET width=1").run());
    assert.throws(() => f.db.prepare("DELETE FROM cost_evidence_displays").run());
    const shown = await f.agent.get(`${f.siteBase}${f.base}/evidence/files/${photo}/display`);
    assert.equal(shown.status, 200);
    assert.equal(shown.headers["content-type"], "image/jpeg");
    assert.equal(shown.headers["x-content-type-options"], "nosniff");
    const original = await f.agent.get(`${f.siteBase}${f.base}/evidence/files/${photo}/download`);
    assert.equal(original.headers["content-type"], "application/octet-stream"); // original stays a download
    board = (await f.agent.get(`${f.siteBase}${f.base}/photo-board`)).body;
    assert.deepEqual(board.photos[0], { attachmentId: photo, filename: "현장.png", groupName: "안전시설비 등", takenDate: "", description: "", included: true, labelVersion: 1 });
    let pre = (await f.agent.get(`${f.siteBase}${f.base}/preflight`)).body;
    assert.ok(pre.items.some((i: { level: string; message: string }) => i.level === "warning" && i.message.includes("촬영일자")));
    assert.ok(pre.items.some((i: { level: string; message: string }) => i.level === "warning" && i.message.includes("사진대지 내용")));
    const label = (body: object) => f.send(`${f.base}/evidence/files/${photo}/display/label`, body, randomUUID(), "put");
    const good = { labelVersion: 1, groupName: "신호수", takenDate: "2026-10-03", description: "<b>신호수</b> 배치", included: true };
    assert.equal((await label({ ...good, groupName: "없는 분류" })).status, 400);
    assert.equal((await label({ ...good, takenDate: "2026-02-30" })).status, 400);
    assert.equal((await label({ ...good, labelVersion: 2 })).status, 409);
    r = await label(good);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.photos[0].labelVersion, 2);
    assert.equal((await label(good)).status, 409); // stale version
    pre = (await f.agent.get(`${f.siteBase}${f.base}/preflight`)).body;
    assert.ok(!pre.items.some((i: { message: string }) => i.message.includes("촬영일자") || i.message.includes("사진대지 내용")));
    let html = (await f.agent.get(`${f.siteBase}${f.base}/photo-board/print`)).text;
    assert.match(html, /<h2>신호수 \(1\/1\)<\/h2>/);
    assert.match(html, /&lt;b&gt;신호수&lt;\/b&gt; 배치 · 촬영일 2026-10-03/);
    assert.match(html, new RegExp(`evidence/files/${photo}/display`));
    assert.doesNotMatch(html, /download/);
    r = await label({ ...good, labelVersion: 2, included: false });
    assert.equal(r.status, 200, r.text);
    html = (await f.agent.get(`${f.siteBase}${f.base}/photo-board/print`)).text;
    assert.match(html, /사진대지에 넣을 사진이 없습니다/);
    r = await label({ ...good, labelVersion: 3 });
    assert.equal(r.status, 200, r.text);
    const usage = f.db.prepare("SELECT coalesce(sum(size),0) n FROM cost_evidence_displays").get() as { n: number };
    assert.equal(usage.n, jpeg(1600, 1200).length);
    r = await f.close();
    assert.equal(r.status, 200, r.text);
    assert.equal((await put(photo, jpeg(10, 10))).status, 409); // closed month
    assert.equal((await f.agent.get(`${f.siteBase}${f.base}/photo-board/print`)).status, 200);
    assert.equal((await label({ ...good, labelVersion: 4 })).status, 409); // closed month labels are fixed
    assert.throws(() => f.db.prepare("UPDATE cost_evidence_displays SET description='x'").run());
  } finally {
    f.db.close();
  }
});
