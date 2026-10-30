import type { IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import type { Response } from "express";
import { HttpError } from "./site-operations.js";
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
// One reader per app. Limits bytes retained in memory; does NOT decode or scan files.
export function boundedUploadReader(timeoutMs = 30_000) {
  let active = 0;
  return function read(req: IncomingMessage): Promise<Buffer> {
    if (active >= 2)
      throw new HttpError(
        429,
        "동시 업로드 2건 제한입니다. 잠시 후 다시 시도하세요.",
      );
    const length = req.headers["content-length"];
    if (
      length !== undefined &&
      (!/^\d+$/.test(length) || Number(length) > MAX_ATTACHMENT_BYTES)
    )
      throw new HttpError(413, "파일은 5 MiB 이하여야 합니다.");
    active++;
    return new Promise((resolve, reject) => {
      let total = 0;
      const chunks: Buffer[] = [];
      let done = false;
      const timer = setTimeout(
        () => finish(new HttpError(408, "업로드 30초 제한을 초과했습니다.")),
        timeoutMs,
      );
      function cleanup() {
        clearTimeout(timer);
        req.off("data", data);
        req.off("end", end);
        req.off("aborted", aborted);
        req.off("error", failed);
        active--;
      }
      function finish(error?: Error) {
        if (done) return;
        done = true;
        cleanup();
        if (error) {
          req.pause();
          chunks.length = 0;
          reject(error);
        } else resolve(Buffer.concat(chunks, total));
      }
      function data(chunk: Buffer) {
        total += chunk.length;
        if (total > MAX_ATTACHMENT_BYTES)
          return finish(new HttpError(413, "파일은 5 MiB 이하여야 합니다."));
        chunks.push(chunk);
      }
      function end() {
        if (!total || (length !== undefined && Number(length) !== total))
          return finish(
            new HttpError(
              400,
              "비어 있거나 전송 길이가 일치하지 않는 파일입니다.",
            ),
          );
        finish();
      }
      function aborted() {
        finish(new HttpError(400, "업로드가 중단되었습니다."));
      }
      function failed() {
        finish(new HttpError(400, "파일 전송 오류입니다."));
      }
      req.on("data", data);
      req.once("end", end);
      req.once("aborted", aborted);
      req.once("error", failed);
      if (req.aborted || req.destroyed) aborted();
    });
  };
}
// Original is unscanned: verify stored size/hash, then serve only as a download, never inline.
export function sendAttachment(res: Response, file: Record<string, unknown>, stored: Uint8Array) {
  const bytes = Buffer.from(stored);
  if (bytes.length !== Number(file.size) || createHash("sha256").update(bytes).digest("hex") !== file.sha256)
    throw new HttpError(409, "보존 원본 크기/해시가 일치하지 않습니다.");
  res.set({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="attachment-${file.id}.bin"; filename*=UTF-8''${encodeURIComponent(String(file.filename)).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "X-Attachment-Scan": "UNSCANNED",
  });
  res.send(bytes);
}
