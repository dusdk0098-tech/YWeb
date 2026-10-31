import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/db.js";
import { pruneIdempotency } from "../server/site-operations.js";
test("idempotency receipts keep only the newest rows", () => {
  const db = openDatabase(":memory:");
  const insert = db.prepare("INSERT INTO idempotency VALUES('u','s',?,'{}','{}')");
  for (let i = 0; i < 25; i++) insert.run(String(i));
  pruneIdempotency(db, 10);
  assert.deepEqual(db.prepare("SELECT key FROM idempotency ORDER BY rowid").all().map((r) => r.key), Array.from({ length: 10 }, (_, i) => String(15 + i)));
  pruneIdempotency(db, 10);
  assert.equal(db.prepare("SELECT count(*) n FROM idempotency").get()?.n, 10);
  db.close();
});
