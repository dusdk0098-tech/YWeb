import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachmentUsage,
  enforceAttachmentQuota,
  ATTACHMENT_QUOTA,
} from "../server/attachment-quota.js";
import { openDatabase, transaction } from "../server/db.js";
const blank = { reportCount: 0, siteCount: 0, siteBytes: 0, totalBytes: 0 };
test("production aggregate byte quotas accept exact cap and reject one byte over independently", () => {
  for (const field of ["siteBytes", "totalBytes"] as const) {
    enforceAttachmentQuota(
      { ...blank, [field]: ATTACHMENT_QUOTA[field] - 11 },
      11,
    );
    assert.throws(
      () =>
        enforceAttachmentQuota(
          { ...blank, [field]: ATTACHMENT_QUOTA[field] - 10 },
          11,
        ),
      /한도/,
    );
  }
  assert.throws(
    () =>
      enforceAttachmentQuota(blank, 1, {
        ...ATTACHMENT_QUOTA,
        totalBytes: ATTACHMENT_QUOTA.totalBytes + 1,
      }),
    /Invalid/,
  );
});
test("same SQL retained usage and transaction enforce tiny exact site/global caps, cross-site worker race one winner", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-quota-")),
    path = join(dir, "test.sqlite"),
    db = openDatabase(path);
  const limits = {
    reportCount: 20,
    siteCount: 200,
    siteBytes: 22,
    totalBytes: 33,
  };
  try {
    db.exec("INSERT INTO users VALUES('u','q@example.test','q','hash');");
    for (const site of ["a", "b", "c"]) {
      db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, site);
      db.prepare(
        "INSERT INTO hazard_reports(id,site_id,owner_id,body,status,created_at,updated_at) VALUES(?,?,'u','{}','draft','now','now')",
      ).run(site, site);
    }
    function put(id: string, site: string, size: number) {
      transaction(db, () => {
        enforceAttachmentQuota(attachmentUsage(db, site, site), size, limits);
        db.prepare(
          "INSERT INTO hazard_attachments VALUES(?,?,?,'fixture.png','image/png',?,'fixture',?,0,'u','now')",
        ).run(id, site, site, size, Buffer.alloc(size));
      });
    }
    put("one", "a", 11);
    put("two", "a", 11); // exact22 retained, including detached
    assert.throws(() => put("over", "a", 1), /한도/);
    assert.equal(attachmentUsage(db, "a", "a").siteBytes, 22);
    const gate = new SharedArrayBuffer(4),
      workers = ["b", "c"].map(
        (site) =>
          new Worker(new URL("./helpers/quota-worker.ts", import.meta.url), {
            workerData: { path, site, report: site, limits, gate },
          }),
      );
    const ready = workers.map(
      (w) =>
        new Promise<void>((resolve, reject) => {
          w.once("message", () => resolve());
          w.once("error", reject);
        }),
    );
    const results = workers.map(
      (w) =>
        new Promise<string>((resolve, reject) => {
          w.on("message", (v) => {
            if (v !== "ready") resolve(v);
          });
          w.once("error", reject);
        }),
    );
    await Promise.all(ready);
    Atomics.store(new Int32Array(gate), 0, 1);
    Atomics.notify(new Int32Array(gate), 0);
    assert.deepEqual((await Promise.all(results)).sort(), [
      "accepted",
      "quota409",
    ]);
    await Promise.all(
      workers.map(
        (w) =>
          new Promise<void>((resolve) => {
            if (w.threadId === -1) resolve();
            else w.once("exit", () => resolve());
          }),
      ),
    );
    assert.equal(attachmentUsage(db, "a", "a").totalBytes, 33);
    assert.throws(() => put("global-over", "b", 1), /한도/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
