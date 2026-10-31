import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";
import {
  boundedRejectedUploadDrainer,
  boundedUploadReader,
  MAX_ATTACHMENT_BYTES,
  MAX_REJECTED_UPLOAD_BYTES,
} from "../server/bounded-upload.js";

function stream(length?: string) {
  const request = new PassThrough() as PassThrough & {
    headers: Record<string, string>;
    aborted: boolean;
  };
  request.headers = length === undefined ? {} : { "content-length": length };
  request.aborted = false;
  return request;
}
const incoming = (request: ReturnType<typeof stream>) => request as unknown as IncomingMessage;

test("rejected upload discard never admits a file or consumes unknown/unbounded bodies", async () => {
  const discard = boundedRejectedUploadDrainer();
  const nearLimit = stream(String(MAX_ATTACHMENT_BYTES + 1));
  assert.throws(() => boundedUploadReader()(incoming(nearLimit)), /5 MiB/);
  const done = discard(incoming(nearLimit));
  nearLimit.end(Buffer.alloc(MAX_ATTACHMENT_BYTES + 1));
  assert.equal(await done, undefined);
  assert.equal(nearLimit.readableEnded, true);
  assert.equal(nearLimit.listenerCount("data"), 0);
  for (const length of [undefined, "invalid", "0", String(MAX_ATTACHMENT_BYTES), String(MAX_REJECTED_UPLOAD_BYTES + 1)]) {
    const rejected = stream(length);
    await discard(incoming(rejected));
    assert.equal(rejected.listenerCount("data"), 0);
    assert.notEqual(rejected.readableFlowing, true);
    rejected.destroy();
  }
});

test("rejected upload discard bounds two concurrent streams, bytes, timeout and abort cleanup", async () => {
  const discard = boundedRejectedUploadDrainer(30);
  const a = stream(String(MAX_ATTACHMENT_BYTES + 1));
  const b = stream(String(MAX_ATTACHMENT_BYTES + 1));
  const blocked = stream(String(MAX_ATTACHMENT_BYTES + 1));
  const pa = discard(incoming(a)), pb = discard(incoming(b));
  await discard(incoming(blocked));
  assert.equal(blocked.listenerCount("data"), 0);
  assert.notEqual(blocked.readableFlowing, true);
  a.emit("aborted");
  await pa;
  const byteLimited = stream(String(MAX_ATTACHMENT_BYTES + 1));
  const over = discard(incoming(byteLimited));
  byteLimited.write(Buffer.alloc(MAX_REJECTED_UPLOAD_BYTES + 1));
  await over;
  assert.equal(byteLimited.listenerCount("data"), 0);
  assert.equal(byteLimited.readableFlowing, false);
  await pb;
  assert.equal(b.listenerCount("data"), 0);
  assert.equal(b.readableFlowing, false);
  const recovered = stream(String(MAX_ATTACHMENT_BYTES + 1));
  const last = discard(incoming(recovered));
  recovered.end(Buffer.alloc(MAX_ATTACHMENT_BYTES + 1));
  await last;
  assert.equal(recovered.readableEnded, true);
  for (const request of [a, b, blocked, byteLimited, recovered]) {
    assert.equal(request.listenerCount("data"), 0);
    assert.equal(request.listenerCount("aborted"), 0);
    request.destroy();
  }
});
