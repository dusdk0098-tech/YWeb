import { test } from "node:test";
import assert from "node:assert/strict";
import { errorText } from "../src/api.js";
test("client error text keeps Korean field reasons once and hides zod English defaults", () => {
  assert.equal(errorText({}), "요청을 처리하지 못했습니다.");
  assert.equal(
    errorText({
      error: "입력값을 확인해 주세요.",
      fields: [
        { message: "0~100 사이, 소수 2자리까지 입력하세요." },
        { message: "Invalid input" },
        { message: "0~100 사이, 소수 2자리까지 입력하세요." },
      ],
    }),
    "입력값을 확인해 주세요. 0~100 사이, 소수 2자리까지 입력하세요.",
  );
});
