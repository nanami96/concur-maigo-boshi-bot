import { describe, it, expect } from "vitest";
import { resolveInitialCompanyId } from "../src/resolveInitialCompanyId";

describe("resolveInitialCompanyId", () => {
  it("?company=が妥当な形式（小文字英数字とハイフン）ならそのまま使う", () => {
    const result = resolveInitialCompanyId({
      search: "?company=company-a",
      defaultCompanyId: "sample-company",
    });
    expect(result).toBe("company-a");
  });

  it("実在するかどうかはここでは検証しない（get_public_config側に委ねる設計）", () => {
    const result = resolveInitialCompanyId({
      search: "?company=not-a-real-company",
      defaultCompanyId: "sample-company",
    });
    expect(result).toBe("not-a-real-company");
  });

  it("クエリが無ければdefaultCompanyIdを使う", () => {
    const result = resolveInitialCompanyId({
      search: "",
      defaultCompanyId: "sample-company",
    });
    expect(result).toBe("sample-company");
  });

  it("他のクエリパラメータと併用してもcompanyだけを見る", () => {
    const result = resolveInitialCompanyId({
      search: "?foo=bar&company=company-a&baz=qux",
      defaultCompanyId: "sample-company",
    });
    expect(result).toBe("company-a");
  });

  it("大文字・アンダースコア等、想定外の文字を含む場合はdefaultCompanyIdへフォールバックする", () => {
    const result = resolveInitialCompanyId({
      search: "?company=Company_A",
      defaultCompanyId: "sample-company",
    });
    expect(result).toBe("sample-company");
  });

  it("空文字列の場合はdefaultCompanyIdへフォールバックする", () => {
    const result = resolveInitialCompanyId({
      search: "?company=",
      defaultCompanyId: "sample-company",
    });
    expect(result).toBe("sample-company");
  });

  it("先頭がハイフンの場合はdefaultCompanyIdへフォールバックする", () => {
    const result = resolveInitialCompanyId({
      search: "?company=-company-a",
      defaultCompanyId: "sample-company",
    });
    expect(result).toBe("sample-company");
  });

  it("65文字以上の異常に長い文字列はdefaultCompanyIdへフォールバックする", () => {
    const result = resolveInitialCompanyId({
      search: `?company=${"a".repeat(65)}`,
      defaultCompanyId: "sample-company",
    });
    expect(result).toBe("sample-company");
  });

  it("<script>等の危険そうな文字列もdefaultCompanyIdへフォールバックする（形式チェックで弾かれる）", () => {
    const result = resolveInitialCompanyId({
      search: "?company=%3Cscript%3E",
      defaultCompanyId: "sample-company",
    });
    expect(result).toBe("sample-company");
  });
});
