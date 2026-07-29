import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { handleQuickExpenseRequest } from "../supabase/functions/create-concur-quick-expense/handleQuickExpenseRequest.js";

// Deno.serve/Deno.env等には一切依存しない純粋関数のため、
// supabase/functions/ocr-receipt/resolveOcrAuthorization.jsのテストと同じ
// 方針でNode/vitestから直接importしてテストできる。method・authHeader・
// parseBody・fetchUser・fetchCompanyMembershipを呼び出し側が注入する設計の
// ため、実際のHTTPサーバー・Supabaseプロジェクト・fetchは一切使わない。

const VALID_USER = { id: "user-1" };

// buildValidBody()が申告するcompanyId/policyId/botExpenseTypeId/
// concurExpenseTypeIdと完全一致する、テスト専用のダミーmapping
// （実際のConcur Expense Type Codeではない）。
const VALID_MAPPING = {
  companyId: "company-a",
  policyId: "policy-x",
  botExpenseTypeId: "taxi",
  concurExpenseTypeId: "CONCUR_TAXI_A_X",
};
const VALID_MEMBERSHIP = { company_code: "company-a", role: "user", concurExpenseTypeMappings: [VALID_MAPPING] };

function buildValidBody(overrides = {}) {
  return {
    companyId: "company-a",
    policyId: "policy-x",
    botExpenseTypeId: "taxi",
    concurExpenseTypeId: "CONCUR_TAXI_A_X",
    transactionDate: "2026-07-28",
    amount: 1000,
    currencyCode: "JPY",
    receiptRequired: true,
    ...overrides,
  };
}

function parseBodyFor(value) {
  return async () => value;
}

// 有効な認証状態（ログイン中ユーザー・company-aへの所属）を組み立てる
// デフォルトの認証系入力。個々のテストで上書きする。
function buildAuthedInput(overrides = {}) {
  return {
    authHeader: "Bearer valid.jwt",
    fetchUser: async () => VALID_USER,
    fetchCompanyMembership: async () => VALID_MEMBERSHIP,
    ...overrides,
  };
}

describe("handleQuickExpenseRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("1. 正常な入力でスタブ結果が返る", async () => {
    const { status, body } = await handleQuickExpenseRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: parseBodyFor(buildValidBody()),
    });

    expect(status).toBe(200);
    expect(body).toEqual({
      result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" },
      error: null,
    });
  });

  it.each(["GET", "PUT", "DELETE", "PATCH"])("2. %sはmethod_not_allowed", async (method) => {
    const { status, body } = await handleQuickExpenseRequest({
      method,
      ...buildAuthedInput(),
      parseBody: parseBodyFor(buildValidBody()),
    });

    expect(status).toBe(405);
    expect(body.result).toBeNull();
    expect(body.error.code).toBe("method_not_allowed");
  });

  it("3. 不正なJSON（parseBodyが例外を投げる）はinvalid_json", async () => {
    const { status, body } = await handleQuickExpenseRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: async () => {
        throw new SyntaxError("Unexpected token in JSON");
      },
    });

    expect(status).toBe(400);
    expect(body.result).toBeNull();
    expect(body.error.code).toBe("invalid_json");
  });

  it("4. 必須項目不足はvalidation_error", async () => {
    const { status, body } = await handleQuickExpenseRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: parseBodyFor({}),
    });

    expect(status).toBe(400);
    expect(body.result).toBeNull();
    expect(body.error.code).toBe("validation_error");
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it("5. amountが文字列の場合はエラー", async () => {
    const { status, body } = await handleQuickExpenseRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: parseBodyFor(buildValidBody({ amount: "1000" })),
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("validation_error");
    expect(body.error.details).toContainEqual({ field: "amount", reason: "invalid_type" });
  });

  it("6. amountが0以下の場合はエラー", async () => {
    const { status, body } = await handleQuickExpenseRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: parseBodyFor(buildValidBody({ amount: 0 })),
    });

    expect(status).toBe(400);
    expect(body.error.details).toContainEqual({ field: "amount", reason: "invalid_range" });
  });

  it("7. currencyが不正な形式の場合はエラー", async () => {
    const { status, body } = await handleQuickExpenseRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: parseBodyFor(buildValidBody({ currencyCode: "jpy" })),
    });

    expect(status).toBe(400);
    expect(body.error.details).toContainEqual({ field: "currencyCode", reason: "invalid_format" });
  });

  it("8. transactionDateが不正な形式の場合はエラー", async () => {
    const { status, body } = await handleQuickExpenseRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: parseBodyFor(buildValidBody({ transactionDate: "2026/07/28" })),
    });

    expect(status).toBe(400);
    expect(body.error.details).toContainEqual({ field: "transactionDate", reason: "invalid_format" });
  });

  it("9. 任意項目(vendorName・memo)が未指定でも正常に処理できる", async () => {
    const body = buildValidBody();
    delete body.vendorName;
    delete body.memo;

    const { status, body: responseBody } = await handleQuickExpenseRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: parseBodyFor(body),
    });

    expect(status).toBe(200);
    expect(responseBody.error).toBeNull();
    expect(responseBody.result.status).toBe("stubbed");
  });

  it("10. 内部例外が発生しても機密情報を含まないinternal_errorを返す", async () => {
    const secretLike = "SECRET_TOKEN_SHOULD_NOT_LEAK";
    const throwingCreateQuickExpense = async () => {
      throw new Error(`boom: ${secretLike}`);
    };

    const { status, body } = await handleQuickExpenseRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: parseBodyFor(buildValidBody()),
      createQuickExpense: throwingCreateQuickExpense,
    });

    expect(status).toBe(500);
    expect(body.result).toBeNull();
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain(secretLike);
    expect(JSON.stringify(body)).not.toContain("boom");
  });

  it("スタブ処理自体が{error}を返した場合もそのままinternal_error相当として扱う", async () => {
    const failingCreateQuickExpense = async () => ({
      result: null,
      error: { code: "concur_not_configured", message: "現在この機能は利用できません。" },
    });

    const { status, body } = await handleQuickExpenseRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: parseBodyFor(buildValidBody()),
      createQuickExpense: failingCreateQuickExpense,
    });

    expect(status).toBe(500);
    expect(body.result).toBeNull();
    expect(body.error.code).toBe("concur_not_configured");
  });

  it("11. 実際の外部HTTP通信が一度も発生しない（正常系・バリデーションエラー系・内部例外系・認証エラー系のいずれでも）", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await handleQuickExpenseRequest({ method: "GET", ...buildAuthedInput(), parseBody: parseBodyFor(buildValidBody()) });
    await handleQuickExpenseRequest({
      method: "POST",
      authHeader: null,
      fetchUser: vi.fn(),
      fetchCompanyMembership: vi.fn(),
      parseBody: parseBodyFor(buildValidBody()),
    });
    await handleQuickExpenseRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: async () => {
        throw new Error("bad json");
      },
    });
    await handleQuickExpenseRequest({ method: "POST", ...buildAuthedInput(), parseBody: parseBodyFor({}) });
    await handleQuickExpenseRequest({ method: "POST", ...buildAuthedInput(), parseBody: parseBodyFor(buildValidBody()) });
    await handleQuickExpenseRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: parseBodyFor(buildValidBody()),
      createQuickExpense: async () => {
        throw new Error("internal boom");
      },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe("認証・権限", () => {
    it("Authorizationヘッダーが無い場合は401(unauthorized)。スタブ・Concur通信処理は呼ばれない", async () => {
      const fetchUser = vi.fn();
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        authHeader: null,
        fetchUser,
        fetchCompanyMembership: vi.fn(),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(401);
      expect(body.result).toBeNull();
      expect(body.error.code).toBe("unauthorized");
      expect(fetchUser).not.toHaveBeenCalled();
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("不正なBearer Token（fetchUserがnullを返す）の場合は401(unauthorized)。スタブは呼ばれない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        authHeader: "Bearer invalid.jwt.here",
        fetchUser: async () => null,
        fetchCompanyMembership: vi.fn(),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(401);
      expect(body.error.code).toBe("unauthorized");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("fetchUserが例外を投げた場合も401(unauthorized)として安全に扱う", async () => {
      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        authHeader: "Bearer malformed",
        fetchUser: async () => {
          throw new Error("invalid token");
        },
        fetchCompanyMembership: vi.fn(),
        parseBody: parseBodyFor(buildValidBody()),
      });

      expect(status).toBe(401);
      expect(body.error.code).toBe("unauthorized");
    });

    it("有効なユーザーだがcompany_membersに所属が無い場合は403(forbidden)。スタブは呼ばれない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        authHeader: "Bearer valid.jwt",
        fetchUser: async () => VALID_USER,
        fetchCompanyMembership: async () => null,
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("forbidden");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("認証済みユーザーの所属会社と、本文のcompanyIdが一致しない場合は403(forbidden)。スタブは呼ばれない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({ fetchCompanyMembership: async () => ({ company_code: "company-b", role: "user" }) }),
        parseBody: parseBodyFor(buildValidBody({ companyId: "company-a" })),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.result).toBeNull();
      expect(body.error.code).toBe("forbidden");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("有効なユーザー・所属会社一致の場合はスタブ処理が実行され200を返す", async () => {
      const createQuickExpense = vi.fn().mockResolvedValue({
        result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" },
        error: null,
      });

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput(),
        parseBody: parseBodyFor(buildValidBody({ companyId: "company-a" })),
        createQuickExpense,
      });

      expect(status).toBe(200);
      expect(body.error).toBeNull();
      expect(createQuickExpense).toHaveBeenCalledTimes(1);
    });

    it("認証確認は本文の解析より前に行われる（不正なJSONでも認証エラーが優先される）", async () => {
      const parseBody = vi.fn().mockRejectedValue(new Error("bad json"));

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        authHeader: null,
        fetchUser: vi.fn(),
        fetchCompanyMembership: vi.fn(),
        parseBody,
      });

      expect(status).toBe(401);
      expect(body.error.code).toBe("unauthorized");
      expect(parseBody).not.toHaveBeenCalled();
    });

    it("JWTや認証情報がログへ出力されない（このモジュール自体はconsole.log/errorを一切呼ばない）", async () => {
      const secretToken = "SECRET_JWT_VALUE_SHOULD_NOT_BE_LOGGED";
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await handleQuickExpenseRequest({
        method: "POST",
        authHeader: `Bearer ${secretToken}`,
        fetchUser: async () => VALID_USER,
        fetchCompanyMembership: async () => VALID_MEMBERSHIP,
        parseBody: parseBodyFor(buildValidBody()),
      });

      // 認証失敗時も含めて確認する。
      await handleQuickExpenseRequest({
        method: "POST",
        authHeader: `Bearer ${secretToken}`,
        fetchUser: async () => null,
        fetchCompanyMembership: vi.fn(),
        parseBody: parseBodyFor(buildValidBody()),
      });

      const allLoggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ");
      expect(allLoggedText).not.toContain(secretToken);

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  // mappingの値（Concur Expense Type Code）はすべてテスト専用のダミー値であり、
  // 実際のConcur側のコードではない。
  describe("Concur Expense Type Mapping検証", () => {
    it("正常なmappingが1件一致する場合はスタブ処理が実行され200を返す", async () => {
      const createQuickExpense = vi.fn().mockResolvedValue({
        result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" },
        error: null,
      });

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput(),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(200);
      expect(body.error).toBeNull();
      expect(createQuickExpense).toHaveBeenCalledTimes(1);
    });

    it("concurExpenseTypeIdが一致しない場合はmapping_not_found（403）。スタブは呼ばれない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput(),
        parseBody: parseBodyFor(buildValidBody({ concurExpenseTypeId: "FORGED_CODE" })),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.result).toBeNull();
      expect(body.error.code).toBe("mapping_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("policyIdが所属会社のmappingと一致しない場合はmapping_not_found（403）。スタブは呼ばれない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput(),
        parseBody: parseBodyFor(buildValidBody({ policyId: "does_not_exist" })),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("mapping_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("botExpenseTypeIdが所属会社のmappingと一致しない場合はmapping_not_found（403）。スタブは呼ばれない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput(),
        parseBody: parseBodyFor(buildValidBody({ botExpenseTypeId: "does_not_exist" })),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("mapping_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("所属会社のmappingが0件（Concur未導入の会社）の場合はmapping_not_found（403）。スタブは呼ばれない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({
          fetchCompanyMembership: async () => ({ company_code: "company-a", role: "user", concurExpenseTypeMappings: [] }),
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("mapping_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("concurExpenseTypeMappings自体が未定義（古いconfig_snapshot等）の場合もmapping_not_found（403）。例外にならない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({
          fetchCompanyMembership: async () => ({ company_code: "company-a", role: "user" }),
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("mapping_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("concurExpenseTypeMappingsが配列でない（型不正な設定データ）場合もmapping_not_found（403）。例外にならない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({
          fetchCompanyMembership: async () => ({ company_code: "company-a", role: "user", concurExpenseTypeMappings: "not-an-array" }),
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("mapping_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("同じcompanyId・policyId・botExpenseTypeIdのmappingが複数存在する場合はmultiple_mappings_found（403）。スタブは呼ばれない", async () => {
      const createQuickExpense = vi.fn();
      const duplicatedMappings = [
        VALID_MAPPING,
        { ...VALID_MAPPING, concurExpenseTypeId: "CONCUR_TAXI_A_X_DUPLICATE" },
      ];

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({
          fetchCompanyMembership: async () => ({ company_code: "company-a", role: "user", concurExpenseTypeMappings: duplicatedMappings }),
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("multiple_mappings_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("他社のmappingしか無い場合はmapping_not_found（403）。他社設定の流用不可", async () => {
      const createQuickExpense = vi.fn();
      const otherCompanyMapping = { companyId: "company-b", policyId: "policy-x", botExpenseTypeId: "taxi", concurExpenseTypeId: "CONCUR_TAXI_A_X" };

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({
          fetchCompanyMembership: async () => ({ company_code: "company-a", role: "user", concurExpenseTypeMappings: [otherCompanyMapping] }),
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("mapping_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("mapping検証エラーの本文にmapping全体やconfig_snapshotが含まれない", async () => {
      const secretLikeCode = "SHOULD_NOT_LEAK_MAPPING_CONTENTS";

      const { body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({
          fetchCompanyMembership: async () => ({
            company_code: "company-a",
            role: "user",
            concurExpenseTypeMappings: [{ ...VALID_MAPPING, concurExpenseTypeId: secretLikeCode }],
          }),
        }),
        parseBody: parseBodyFor(buildValidBody()),
      });

      expect(JSON.stringify(body)).not.toContain(secretLikeCode);
    });
  });
});
