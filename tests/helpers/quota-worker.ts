import { HttpError } from "../../server/site-operations.js";
import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import {
  attachmentUsage,
  enforceAttachmentQuota,
} from "../../server/attachment-quota.js";
import { transaction } from "../../server/db.js";
const { path, site, report, limits, gate } = workerData;
const db = new DatabaseSync(path);
db.exec("PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;");
parentPort!.postMessage("ready");
Atomics.wait(new Int32Array(gate), 0, 0);
try {
  transaction(db, () => {
    enforceAttachmentQuota(attachmentUsage(db, site, report), 11, limits);
    db.prepare(
      "INSERT INTO hazard_attachments VALUES(?,?,?,'fixture.png','image/png',11,'fixture',zeroblob(11),0,'u','now')",
    ).run(report, site, report);
  });
  parentPort!.postMessage("accepted");
} catch (error) {
  if (
    !(error instanceof HttpError) ||
    error.status !== 409 ||
    !error.message.includes("한도")
  )
    throw error;
  parentPort!.postMessage("quota409");
} finally {
  db.close();
}
