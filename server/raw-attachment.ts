import type { Request } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { persistedAccountSession } from "./account-session.js";
const versionSchema=z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export function rawAttachmentMetadata(req:Request,versionHeader:string, allowPdfOriginal = false){
      if (
        req.get("content-type") !== "application/octet-stream" ||
        req.get("content-encoding")
      )
        throw new HttpError(
          415,
          "압축하지 않은 application/octet-stream 전송만 허용합니다.",
        );
      const version = versionSchema.parse(req.get(versionHeader));
      z.uuid().parse(req.get("idempotency-key"));
      const format = allowPdfOriginal ? z.enum(["image/png", "image/jpeg", "application/pdf"]).parse(req.get("x-file-type")) : z.enum(["image/png", "image/jpeg"]).parse(req.get("x-file-type"));
      let filename: string;
      try {
        filename = decodeURIComponent(req.get("x-file-name") || "");
      } catch {
        throw new HttpError(400, "파일 이름 인코딩이 올바르지 않습니다.");
      }
      filename = z
        .string()
        .min(1)
        .max(180)
        .refine(
          (s) =>
            s === s.trim() &&
            !s.includes("/") &&
            !s.includes("\\") &&
            !s.includes(":") &&
            !Array.from(s).some(
              (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
            ) &&
            !/[\u202a-\u202e\u2066-\u2069]/.test(s),
        )
        .parse(filename);
      if (!(format === "application/pdf" ? /\.pdf$/i : format === "image/png" ? /\.png$/i : /\.jpe?g$/i).test(filename))
        throw new HttpError(400, "이름 확장자와 파일 형식이 일치해야 합니다.");
return {version,format,filename};
}
export function checkRawImageHeader(bytes:Buffer,format:string){
      const matches =
        format === "image/png"
          ? bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : bytes.length >= 3 &&
            bytes[0] === 255 &&
            bytes[1] === 216 &&
            bytes[2] === 255;
      if (!matches)
        throw new HttpError(
          400,
          "허용된 PNG/JPEG 파일 헤더가 아닙니다. 내부 형식/악성코드는 검사하지 않습니다.",
        );
}
export function recheckUploadSession(db:Db,req:Request){
      const sessionRow = db
        .prepare("SELECT data,expires FROM sessions WHERE sid=?")
        .get(req.sessionID) as { data: string; expires: number } | undefined;
      const current = sessionRow
        ? (JSON.parse(sessionRow.data) as {
            userId?: string;
            issuedAt?: number;
            csrf?: string;
          })
        : null;
      if (
        !persistedAccountSession(
          db,
          req.sessionID,
          req.session.userId!,
          req.session.authEpoch!,
        ) ||
        !sessionRow ||
        sessionRow.expires <= Date.now() ||
        !current?.issuedAt ||
        Date.now() - current.issuedAt >= 8 * 60 * 60 * 1000 ||
        current.userId !== req.session.userId ||
        current.csrf !== req.session.csrf
      )
        throw new HttpError(
          401,
          "업로드 중 세션이 만료되었습니다. 다시 로그인하세요.",
        );
 }

// Product identification rule only. Does not parse, decode, or validate a PDF.
export function checkRawPdfHeader(bytes: Buffer) {
  const prefix = bytes.subarray(0, 9).toString("latin1");
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(prefix))
    throw new HttpError(400, "허용 PDF 시작 헤더가 아닙니다. PDF 구조·암호·악성코드는 검사하지 않습니다.");
}
