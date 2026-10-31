// Reads pixel size from PNG IHDR / JPEG SOF headers without decoding. No imports: shared with the client bundle.
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const u16 = (i: number) => (bytes[i] << 8) | bytes[i + 1];
  if (bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[12] === 73 && bytes[13] === 72 && bytes[14] === 68 && bytes[15] === 82) {
    const u32 = (i: number) => ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
    return { width: u32(16), height: u32(20) };
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    // SOF0-15 except DHT(C4), JPG(C8), DAC(CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { height: u16(i + 5), width: u16(i + 7) };
    if (marker === 0xd9 || marker === 0xda) return null;
    i += 2 + u16(i + 2);
  }
  return null;
}
// 사진대지 정책안 A 초기 한도 (docs/PHOTO_BOARD_POLICY_PROPOSAL.md).
export const PHOTO_DISPLAY_MAX_SIDE = 2048;
export const PHOTO_DISPLAY_MAX_BYTES = 1024 * 1024;
export const PHOTO_ORIGINAL_MAX_PIXELS = 50_000_000;
