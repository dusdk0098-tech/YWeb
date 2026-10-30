import { HttpError } from "./site-operations.js";
export const STOCK_SCALE = 1000000n,
  MAX_STOCK = 1000000000n * STOCK_SCALE;
export function stockUnits(value: string, allowZero = false) {
  if (
    typeof value !== "string" ||
    value.length > 24 ||
    !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)
  )
    throw new HttpError(
      400,
      "수량은 부호·쉼표·지수 없는 소수6자리 이하 문자열이어야 합니다.",
    );
  const [whole, fraction = ""] = value.split(".");
  const n = BigInt(whole) * STOCK_SCALE + BigInt(fraction.padEnd(6, "0"));
  if (n > MAX_STOCK || (!allowZero && n === 0n))
    throw new HttpError(400, "수량은0보다 크고10^9 이하이어야 합니다.");
  return n;
}
export function stockText(n: bigint) {
  const sign = n < 0n ? "-" : "";
  const a = n < 0n ? -n : n;
  const tail = (a % STOCK_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return sign + (a / STOCK_SCALE).toString() + (tail ? "." + tail : "");
}
