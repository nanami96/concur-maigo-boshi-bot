import { describe, it, expect } from "vitest";
import { resolveDefaultCurrencyCode } from "../src/lib/concurRegistrationConfig.js";

describe("resolveDefaultCurrencyCode", () => {
  it("既存configにデフォルト通貨の概念が無いため、常にJPYを返す", () => {
    expect(resolveDefaultCurrencyCode({ company: { company_id: "sample-company" } })).toBe("JPY");
    expect(resolveDefaultCurrencyCode(null)).toBe("JPY");
    expect(resolveDefaultCurrencyCode(undefined)).toBe("JPY");
  });
});
