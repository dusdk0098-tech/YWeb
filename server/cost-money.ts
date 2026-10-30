import { HttpError } from "./site-operations.js";
export const MONEY_SCALE = 1_000_000n;
export const MAX_MONEY = 1_000_000_000_000_000n * MONEY_SCALE;
const MAX_QUANTITY = 1_000_000_000n * MONEY_SCALE,
  MAX_PRICE = 1_000_000_000_000n;
function decimalUnits(value: string) {
  if (
    typeof value !== "string" ||
    value.length > 32 ||
    !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)
  )
    throw new HttpError(
      400,
      "금액/수량은 부호·쉼표·지수 없이 소수6자리 이하 숫자 문자열이어야 합니다.",
    );
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * MONEY_SCALE + BigInt(fraction.padEnd(6, "0"));
}
export function moneyUnits(value: string) {
  const n = decimalUnits(value);
  if (n > MAX_MONEY)
    throw new HttpError(400, "금액은 10^15원 한도를 넘을 수 없습니다.");
  return n;
}
export function quantityUnits(value: string) {
  const n = decimalUnits(value);
  if (n <= 0n || n > MAX_QUANTITY)
    throw new HttpError(400, "수량은0보다 크고10^9 이하,소수6자리까지입니다.");
  return n;
}
export function unitPrice(value: string) {
  if (
    typeof value !== "string" ||
    value.length > 16 ||
    !/^[1-9]\d*$/.test(value)
  )
    throw new HttpError(
      400,
      "단가는0보다 큰 원 단위 정수 문자열이어야 합니다. 소수 단가는 반올림하지 않고 거부합니다.",
    );
  const n = BigInt(value);
  if (n > MAX_PRICE)
    throw new HttpError(400, "단가는10^12원을 넘을 수 없습니다.");
  return n;
}
export function decimalText(units: bigint) {
  const sign = units < 0n ? "-" : "";
  const n = units < 0n ? -units : units,
    whole = n / MONEY_SCALE,
    fraction = (n % MONEY_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return sign + whole.toString() + (fraction ? "." + fraction : "");
}
export function lineAmount(quantity: string, price: string) {
  const amount = quantityUnits(quantity) * unitPrice(price);
  if (amount > MAX_MONEY)
    throw new HttpError(400, "행 금액이10^15원 한도를 넘습니다.");
  return decimalText(amount);
}
export function boundedTotal(value: bigint) {
  if (value < 0n || value > MAX_MONEY)
    throw new HttpError(
      409,
      "원장 합계/누계가 허용된0~10^15원 범위를 벗어납니다. 저장하지 않았습니다.",
    );
  return decimalText(value);
}
