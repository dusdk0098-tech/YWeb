import { test } from "node:test";
import assert from "node:assert/strict";
import { exifTakenDate } from "../src/photo-display.js";
// Synthetic EXIF: IFD0 -> ExifIFD(0x8769) -> DateTimeOriginal(0x9003), or IFD0 DateTime(0x0132) only.
function exifJpeg(date: string, le = true, viaExifIfd = true) {
  const t = Buffer.alloc(80), w16 = (o: number, v: number) => (le ? t.writeUInt16LE(v, o) : t.writeUInt16BE(v, o)),
    w32 = (o: number, v: number) => (le ? t.writeUInt32LE(v, o) : t.writeUInt32BE(v, o));
  t.write(le ? "II" : "MM", 0, "latin1"); w16(2, 42); w32(4, 8);
  w16(8, 1);
  if (viaExifIfd) { w16(10, 0x8769); w16(12, 4); w32(14, 1); w32(18, 26); w16(26, 1); w16(28, 0x9003); w16(30, 2); w32(32, 20); w32(36, 44); }
  else { w16(10, 0x0132); w16(12, 2); w32(14, 20); w32(18, 44); }
  t.write(date + "\0", 44, "latin1");
  const app1 = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), t]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255]), app1, Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9])]);
}
test("EXIF taken date prefill reads DateTimeOriginal or DateTime in both byte orders, rejects bad dates", () => {
  assert.equal(exifTakenDate(exifJpeg("2026:10:03 09:15:00")), "2026-10-03");
  assert.equal(exifTakenDate(exifJpeg("2026:10:04 09:15:00", false)), "2026-10-04");
  assert.equal(exifTakenDate(exifJpeg("2026:10:05 09:15:00", true, false)), "2026-10-05");
  assert.equal(exifTakenDate(exifJpeg("2026:02:30 00:00:00")), null);
  assert.equal(exifTakenDate(exifJpeg("0000:00:00 00:00:00")), null);
  assert.equal(exifTakenDate(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null);
  assert.equal(exifTakenDate(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2])), null);
  assert.equal(exifTakenDate(exifJpeg("2026:10:03 09:15:00").subarray(0, 30)), null); // truncated
});
