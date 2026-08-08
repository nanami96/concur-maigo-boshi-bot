import { describe, it, expect, vi, afterEach } from "vitest";
import { handleQuickExpenseRequest } from "../supabase/functions/create-concur-quick-expense/handleQuickExpenseRequest.js";

// Deno.serve/Deno.env等には一切依存しない純粋関数のため、
// supabase/functions/ocr-receipt/resolveOcrAuthorization.jsのテストと同じ
// 方針でNode/vitestから直接importしてテストできる。method・authHeader・
// parseBody・fetchUser・fetchCompanyMembershipを呼び出し側が注入する設計の
// ため、実際のHTTPサーバー・Supabaseプロジェクト・fetchは一切使わない。

const VALID_USER = { id: "user-1" };

// buildValidBody()が申告するcompanyId/policyId/expenseTypeIdと完全一致する、
// テスト専用のダミー経費タイプ（実際のConcur EXP_KEYではない）。
const VALID_EXPENSE_TYPE = { id: "taxi", policyId: "policy-x", name: "タクシー", active: true };
// expenseTypeIdMode: "concur_exp_key" は、この会社が経費タイプID＝Concur EXP_KEY
// 方式へ移行済みであることを示す、公開済みconfig_snapshot由来の値
// （resolveMembershipFromPublicConfigRow.js参照）。以降の「正常系」テストは
// 全て「移行済みの会社」を想定するため、既定でこの値を含める（未移行時の
// 挙動は下部の「経費タイプID移行フラグ」describe参照）。
const VALID_MEMBERSHIP = {
  company_code: "company-a",
  role: "user",
  expenseTypes: [VALID_EXPENSE_TYPE],
  expenseTypeIdMode: "concur_exp_key",
};

// company_id（Supabase内部UUID相当）：resolveOAuthCompanyId({ userId,
// companyCode })（resolve_concur_oauth_company_id RPC相当）が解決したと
// 想定するダミー値。membershipオブジェクトはcompany UUIDを一切持たない
// （設計レビューにより責務分離。get_my_public_config()は所属確認・経費タイプ
// 検証専用）。実際のUUID形式である必要はなく、テスト専用のダミー値だが、
// 他社（COMPANY_C_UUID等）と衝突しない値にすることで「A社のリクエストで
// B社のUUIDが使われていないか」を検証できる。
const COMPANY_A_UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// resolveOAuthCompanyIdの既定モック（buildGateOnAuthedInput()参照）。
// VALID_MEMBERSHIPのcompany_code（"company-a"）が指定された場合だけ
// COMPANY_A_UUIDを返す（companyCodeを無視して固定値を返す危険な実装では
// ないことを、この既定モック自体でも体現する）。
function defaultResolveOAuthCompanyId() {
  return vi.fn(async ({ companyCode }) => (companyCode === VALID_MEMBERSHIP.company_code ? COMPANY_A_UUID : null));
}

function buildValidBody(overrides = {}) {
  return {
    companyId: "company-a",
    policyId: "policy-x",
    expenseTypeId: "taxi",
    transactionDate: "2026-07-28",
    amount: 1000,
    currencyCode: "JPY",
    receiptRequired: true,
    concurLoginId: "taro.yamada@example.com",
    ...overrides,
  };
}

function parseBodyFor(value) {
  return async () => value;
}

// Vaultリース取得〜OAuth token更新〜Identity検索まで、すべて正常に完了する
// 場合のデフォルトモック（supabase/functions/lookup-concur-user/
// handleLookupConcurUserRequest.test.jsの構成と同じ考え方）。
const DUMMY_ACCESS_TOKEN = "DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK";
const DUMMY_REFRESH_TOKEN = "DUMMY_REFRESH_TOKEN_SHOULD_NOT_LEAK";
const DUMMY_GEOLOCATION = "https://us.api.concursolutions.test";
const DUMMY_CONCUR_USER_ID = "3df11695-e8bb-40ff-8e98-c85913ab2789";

function defaultGetRefreshTokenForEdge() {
  return async () => ({ connectionId: "conn-1", leaseId: "lease-1", refreshToken: DUMMY_REFRESH_TOKEN });
}

function defaultCompleteOAuthRefresh() {
  return async () => true;
}

function defaultRefreshAccessToken() {
  return async () => ({
    ok: true,
    rotated: false,
    tokens: {
      accessToken: DUMMY_ACCESS_TOKEN,
      refreshToken: DUMMY_REFRESH_TOKEN,
      tokenType: "Bearer",
      expiresIn: 3600,
      scope: "quickexpense.writeonly user.read identity.user.ids.read",
      geolocation: DUMMY_GEOLOCATION,
    },
    logSummary: { ok: true },
  });
}

function defaultLookupUser() {
  return async () => ({ ok: true, userId: DUMMY_CONCUR_USER_ID });
}

// 有効な認証状態（ログイン中ユーザー・company-aへの所属）を組み立てる
// デフォルトの認証系入力。既定では安全ゲート（CONCUR_QUICK_EXPENSE_ENABLED）
// はOFF（env: {}）のままにし、既存の（この機能追加前からの）テスト群が
// 引き続きcreateQuickExpenseStubの挙動を検証できるようにする
// （ゲートがOFFの限り、createQuickExpenseを明示的に渡さない呼び出しは
// 常にcreateQuickExpenseStubへ解決される）。Vault/OAuth/Identityパイプラインを
// 検証するテストはbuildGateOnAuthedInput()を使う。
// 【複数社所属対応】fetchCompanyMembershipは(user, companyCode)の2引数を
// 受け取り、実際に所属している会社のcompanyCodeを渡された場合だけmembershipを
// 返す（それ以外はnull）。buildValidBody()の既定companyId（"company-a"）と
// 一致させているため、companyId未指定の既存テストは従来どおり動作するが、
// 引数を無視して常に固定値を返す実装（＝companyIdの検証をすり抜けてしまう
// 危険な実装）ではないことを、この既定モック自体でも体現している。
function buildAuthedInput(overrides = {}) {
  return {
    authHeader: "Bearer valid.jwt",
    fetchUser: async () => VALID_USER,
    fetchCompanyMembership: async (_user, companyCode) =>
      companyCode === VALID_MEMBERSHIP.company_code ? VALID_MEMBERSHIP : null,
    env: {},
    ...overrides,
  };
}

// 安全ゲート（CONCUR_QUICK_EXPENSE_ENABLED）をONにし、Vault/OAuth/Identity
// パイプラインが正常に完了するデフォルトモックまで揃えたテスト入力。
function buildGateOnAuthedInput(overrides = {}) {
  return buildAuthedInput({
    env: { CONCUR_QUICK_EXPENSE_ENABLED: "true" },
    resolveOAuthCompanyId: defaultResolveOAuthCompanyId(),
    getRefreshTokenForEdge: defaultGetRefreshTokenForEdge(),
    completeOAuthRefresh: defaultCompleteOAuthRefresh(),
    refreshAccessToken: defaultRefreshAccessToken(),
    lookupUser: defaultLookupUser(),
    ...overrides,
  });
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

    it("認証済みユーザーが本文のcompanyIdへ実際には所属していない場合は403(forbidden)。スタブは呼ばれない（cross-company拒否）", async () => {
      const createQuickExpense = vi.fn();
      // このユーザーは実際にはcompany-bにしか所属していない、という状況を
      // 再現する（fetchCompanyMembershipはcompanyCode引数で絞り込み、
      // company-aを問い合わせられた場合はnull＝所属なしを返す）。
      const fetchCompanyMembership = vi.fn(async (_user, companyCode) =>
        companyCode === "company-b" ? { company_code: "company-b", role: "user", expenseTypes: [] } : null,
      );

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({ fetchCompanyMembership }),
        parseBody: parseBodyFor(buildValidBody({ companyId: "company-a" })),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.result).toBeNull();
      expect(body.error.code).toBe("forbidden");
      expect(fetchCompanyMembership).toHaveBeenCalledWith(VALID_USER, "company-a");
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

  // 【複数社所属対応・Commit 1】1人のユーザーがA社・C社の2社に所属している
  // 状況を再現し、companyId（company_code）の明示検証がcross-company混在を
  // 防いでいることを確認する。fetchCompanyMembershipは実際のRPC
  // （get_my_public_config(p_company_code)）と同じく、渡されたcompanyCodeで
  // 絞り込んだ結果だけを返す（先頭行・data[0]への依存が無いことを表現する
  // ため、companyCodeをキーにしたマップから引く実装にしている）。
  describe("複数社所属対応（Commit 1：companyIdの明示検証によるcross-company防止）", () => {
    const COMPANY_A_MEMBERSHIP = {
      company_code: "company-a",
      role: "admin",
      expenseTypes: [{ id: "taxi", policyId: "policy-x", name: "タクシー", active: true }],
      expenseTypeIdMode: "concur_exp_key",
    };
    const COMPANY_C_MEMBERSHIP = {
      company_code: "company-c",
      role: "user",
      expenseTypes: [{ id: "01063", policyId: "policy-y", name: "交通費", active: true }],
      expenseTypeIdMode: "concur_exp_key",
    };
    const MULTI_COMPANY_MEMBERSHIPS = {
      "company-a": COMPANY_A_MEMBERSHIP,
      "company-c": COMPANY_C_MEMBERSHIP,
    };

    function buildMultiCompanyFetchCompanyMembership() {
      return vi.fn(async (_user, companyCode) => MULTI_COMPANY_MEMBERSHIPS[companyCode] ?? null);
    }

    it("12. companyId=company-a・A社所属・A社の経費タイプコードの組み合わせは認可成功（200）", async () => {
      const createQuickExpense = vi.fn().mockResolvedValue({
        result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" },
        error: null,
      });
      const fetchCompanyMembership = buildMultiCompanyFetchCompanyMembership();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({ fetchCompanyMembership }),
        parseBody: parseBodyFor(
          buildValidBody({ companyId: "company-a", policyId: "policy-x", expenseTypeId: "taxi" }),
        ),
        createQuickExpense,
      });

      expect(status).toBe(200);
      expect(body.error).toBeNull();
      expect(createQuickExpense).toHaveBeenCalledTimes(1);
    });

    it("13. companyId=company-bだが所属していない（company-a・company-cにしか所属していない）場合は403(forbidden)", async () => {
      const createQuickExpense = vi.fn();
      const fetchCompanyMembership = buildMultiCompanyFetchCompanyMembership();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({ fetchCompanyMembership }),
        parseBody: parseBodyFor(buildValidBody({ companyId: "company-b" })),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("forbidden");
      expect(fetchCompanyMembership).toHaveBeenCalledWith(VALID_USER, "company-b");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("14. companyId=company-aのリクエストにcompany-cの経費タイプコード（01063）を指定すると拒否される（他社の経費タイプは使えない）", async () => {
      const createQuickExpense = vi.fn();
      const fetchCompanyMembership = buildMultiCompanyFetchCompanyMembership();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({ fetchCompanyMembership }),
        parseBody: parseBodyFor(
          buildValidBody({ companyId: "company-a", policyId: "policy-y", expenseTypeId: "01063" }),
        ),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("expense_type_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("15. fetchCompanyMembershipが必ず本文のcompanyIdとともに呼ばれる（data[0]・先頭membershipへの暗黙依存が無いことの確認）", async () => {
      const fetchCompanyMembership = buildMultiCompanyFetchCompanyMembership();

      await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({ fetchCompanyMembership }),
        parseBody: parseBodyFor(
          buildValidBody({ companyId: "company-c", policyId: "policy-y", expenseTypeId: "01063" }),
        ),
      });

      expect(fetchCompanyMembership).toHaveBeenCalledTimes(1);
      expect(fetchCompanyMembership).toHaveBeenCalledWith(VALID_USER, "company-c");
    });

    it("A社adminがA社の一覧を取得する通常フローでも、C社の経費タイプ一覧が一切参照されない", async () => {
      const createQuickExpense = vi.fn().mockResolvedValue({ result: { quickExpenseId: "x", status: "created" }, error: null });
      const fetchCompanyMembership = buildMultiCompanyFetchCompanyMembership();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({ fetchCompanyMembership }),
        parseBody: parseBodyFor(
          buildValidBody({ companyId: "company-a", policyId: "policy-x", expenseTypeId: "taxi" }),
        ),
        createQuickExpense,
      });

      expect(status).toBe(200);
      // company-c固有の経費タイプコード（01063）がレスポンスに紛れ込んでいないこと。
      expect(JSON.stringify(body)).not.toContain("01063");
    });
  });

  // 経費タイプID（Concur EXP_KEY）の値はすべてテスト専用のダミー値であり、
  // 実際のConcur側のコードではない。
  describe("経費タイプ検証（verifyExpenseTypeForQuickExpense）", () => {
    it("正常な経費タイプが一致する場合はスタブ処理が実行され200を返す", async () => {
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

    it("policyIdが所属会社の経費タイプと一致しない場合はexpense_type_not_found（403）。スタブは呼ばれない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput(),
        parseBody: parseBodyFor(buildValidBody({ policyId: "does_not_exist" })),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("expense_type_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("expenseTypeIdが所属会社の経費タイプ一覧に存在しない場合はexpense_type_not_found（403）。スタブは呼ばれない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput(),
        parseBody: parseBodyFor(buildValidBody({ expenseTypeId: "does_not_exist" })),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("expense_type_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("所属会社の経費タイプが0件（未登録）の場合はexpense_type_not_found（403）。スタブは呼ばれない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({
          fetchCompanyMembership: async () => ({
            company_code: "company-a",
            role: "user",
            expenseTypes: [],
            expenseTypeIdMode: "concur_exp_key",
          }),
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("expense_type_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("expenseTypes自体が未定義（古いconfig_snapshot等）の場合もexpense_type_not_found（403）。例外にならない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({
          fetchCompanyMembership: async () => ({ company_code: "company-a", role: "user", expenseTypeIdMode: "concur_exp_key" }),
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("expense_type_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("expenseTypesが配列でない（型不正な設定データ）場合もexpense_type_not_found（403）。例外にならない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({
          fetchCompanyMembership: async () => ({
            company_code: "company-a",
            role: "user",
            expenseTypes: "not-an-array",
            expenseTypeIdMode: "concur_exp_key",
          }),
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("expense_type_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("使用停止（active: false）の経費タイプはexpense_type_not_found（403）。スタブは呼ばれない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({
          fetchCompanyMembership: async () => ({
            company_code: "company-a",
            role: "user",
            expenseTypes: [{ ...VALID_EXPENSE_TYPE, active: false }],
            expenseTypeIdMode: "concur_exp_key",
          }),
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("expense_type_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("他社の経費タイプ一覧しか無い場合はexpense_type_not_found（403）。他社設定の流用不可", async () => {
      const createQuickExpense = vi.fn();
      const otherCompanyExpenseType = { id: "taxi", policyId: "other-policy", name: "タクシー", active: true };

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({
          fetchCompanyMembership: async () => ({
            company_code: "company-a",
            role: "user",
            expenseTypes: [otherCompanyExpenseType],
            expenseTypeIdMode: "concur_exp_key",
          }),
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("expense_type_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("経費タイプ検証エラーの本文に経費タイプ一覧やconfig_snapshotが含まれない", async () => {
      const secretLikeId = "SHOULD_NOT_LEAK_EXPENSE_TYPE_CONTENTS";

      const { body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({
          fetchCompanyMembership: async () => ({
            company_code: "company-a",
            role: "user",
            expenseTypes: [{ id: secretLikeId, policyId: "policy-x", name: "秘密の経費タイプ", active: true }],
            expenseTypeIdMode: "concur_exp_key",
          }),
        }),
        parseBody: parseBodyFor(buildValidBody()),
      });

      expect(JSON.stringify(body)).not.toContain(secretLikeId);
    });

    it("旧フィールド名botExpenseTypeIdのみで送られたリクエストも受け付ける（デプロイ移行期間の後方互換）", async () => {
      const createQuickExpense = vi.fn().mockResolvedValue({
        result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" },
        error: null,
      });
      const legacyBody = buildValidBody();
      delete legacyBody.expenseTypeId;
      legacyBody.botExpenseTypeId = "taxi";
      // 旧方式ではconcurExpenseTypeIdも送られていたが、もう検証・利用しない。
      legacyBody.concurExpenseTypeId = "LEGACY_CONCUR_CODE";

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput(),
        parseBody: parseBodyFor(legacyBody),
        createQuickExpense,
      });

      expect(status).toBe(200);
      expect(body.error).toBeNull();
      expect(createQuickExpense).toHaveBeenCalledTimes(1);
    });
  });

  // 経費タイプID（Concur EXP_KEY）の値はすべてテスト専用のダミー値であり、
  // 実際のConcur側のコードではない。
  describe("経費タイプID移行フラグ（expenseTypeIdMode）", () => {
    it("公開済み設定にexpenseTypeIdModeが無い会社（未移行、現時点の全社の既定状態）は、expenseTypeId・policyIdが正しく一致していてもexpense_type_not_found（403）", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({
          fetchCompanyMembership: async () => ({
            company_code: "company-a",
            role: "user",
            expenseTypes: [VALID_EXPENSE_TYPE],
            // expenseTypeIdMode未設定＝未移行。
          }),
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("expense_type_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it.each(["", "legacy", "true"])(
      "expenseTypeIdModeが'concur_exp_key'以外の値(%s)の場合もexpense_type_not_found（403）",
      async (expenseTypeIdMode) => {
        const createQuickExpense = vi.fn();

        const { status, body } = await handleQuickExpenseRequest({
          method: "POST",
          ...buildAuthedInput({
            fetchCompanyMembership: async () => ({
              company_code: "company-a",
              role: "user",
              expenseTypes: [VALID_EXPENSE_TYPE],
              expenseTypeIdMode,
            }),
          }),
          parseBody: parseBodyFor(buildValidBody()),
          createQuickExpense,
        });

        expect(status).toBe(403);
        expect(body.error.code).toBe("expense_type_not_found");
        expect(createQuickExpense).not.toHaveBeenCalled();
      },
    );

    it("旧IDがそのまま残っている会社（train_local等）でも、経費タイプIDの見た目だけでは移行済み扱いにしない", async () => {
      // "01515"のような数字文字列のIDに見えても、expenseTypeIdModeが無ければ拒否する
      // （IDのフォーマットから移行済みかどうかを推測することは行わない）。
      const createQuickExpense = vi.fn();
      const numericLookingExpenseType = { id: "01515", policyId: "policy-x", name: "国内近距離バス", active: true };

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({
          fetchCompanyMembership: async () => ({
            company_code: "company-a",
            role: "user",
            expenseTypes: [numericLookingExpenseType],
          }),
        }),
        parseBody: parseBodyFor(buildValidBody({ expenseTypeId: "01515" })),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("expense_type_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("expenseTypeIdModeが'concur_exp_key'に完全一致する会社は、従来どおりスタブ処理まで進む", async () => {
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

    it("リクエスト本文に偽のmode/expenseTypeIdModeを含めても一切信用しない（公開済み設定側のmodeだけを正とする）", async () => {
      const createQuickExpense = vi.fn();
      const tamperedBody = buildValidBody();
      tamperedBody.mode = "concur_exp_key";
      tamperedBody.expenseTypeIdMode = "concur_exp_key";

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({
          fetchCompanyMembership: async () => ({
            company_code: "company-a",
            role: "user",
            expenseTypes: [VALID_EXPENSE_TYPE],
            // 公開済み設定側は未移行のまま。
          }),
        }),
        parseBody: parseBodyFor(tamperedBody),
        createQuickExpense,
      });

      expect(status).toBe(403);
      expect(body.error.code).toBe("expense_type_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });
  });

  // ConcurログインID→Identity v4でuserID解決→Quick Expenseクライアントへの
  // 受け渡し（今回追加分）。supabase/functions/lookup-concur-user/
  // handleLookupConcurUserRequest.test.jsと同じ観点のテストを、この
  // Edge Function向けに再構成している。
  describe("Identity解決とQuick Expense呼び出し（ゲートON時のパイプライン）", () => {
    it("1. 正常系：Identity検索で解決したuserIDがそのままcreateQuickExpenseへ渡る", async () => {
      const createQuickExpense = vi.fn().mockResolvedValue({
        result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" },
        error: null,
      });

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput(),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(200);
      expect(body.error).toBeNull();
      expect(createQuickExpense).toHaveBeenCalledTimes(1);
      const [, context] = createQuickExpense.mock.calls[0];
      expect(context).toEqual({
        accessToken: DUMMY_ACCESS_TOKEN,
        geolocation: DUMMY_GEOLOCATION,
        userId: DUMMY_CONCUR_USER_ID,
      });
    });

    it("2. Identity検索0件（concur_user_not_found）の場合、Quick Expense処理を呼ばない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({
          lookupUser: async () => ({ ok: false, error: { code: "concur_user_not_found", message: "指定された利用者情報が見つかりませんでした。" } }),
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(404);
      expect(body.error.code).toBe("concur_user_not_found");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("3. Identity検索複数件（concur_user_ambiguous）の場合、Quick Expense処理を呼ばない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({
          lookupUser: async () => ({ ok: false, error: { code: "concur_user_ambiguous", message: "指定された条件に一致する利用者が複数見つかりました。より詳細な条件を指定してください。" } }),
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(409);
      expect(body.error.code).toBe("concur_user_ambiguous");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("4. Identity APIが401/403（concur_identity_rejected）の場合、Quick Expense処理を呼ばない", async () => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({
          lookupUser: async () => ({ ok: false, error: { code: "concur_identity_rejected", message: "Concur利用者情報サーバーへのアクセスが拒否されました。" } }),
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(502);
      expect(body.error.code).toBe("concur_identity_rejected");
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it.each([
      ["concur_identity_timeout", 504],
      ["concur_identity_network_error", 502],
      ["concur_identity_service_error", 502],
      ["concur_identity_rate_limited", 429],
    ])("5. Identity APIの%sの場合、Quick Expense処理を呼ばない", async (code, expectedStatus) => {
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({ lookupUser: async () => ({ ok: false, error: { code, message: "固定メッセージ" } }) }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(expectedStatus);
      expect(body.error.code).toBe(code);
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("6. OAuth（Refresh Token Grant）失敗の場合、Identity API・Quick Expense処理のいずれも呼ばない", async () => {
      const createQuickExpense = vi.fn();
      const lookupUser = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({
          refreshAccessToken: async () => ({
            ok: false,
            error: { code: "concur_oauth_rejected", message: "Concurの認証情報が拒否されました。" },
            logSummary: { ok: false },
          }),
          completeOAuthRefresh: vi.fn().mockResolvedValue(true),
          lookupUser,
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(502);
      expect(body.error.code).toBe("concur_oauth_rejected");
      expect(lookupUser).not.toHaveBeenCalled();
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("6b. OAuth失敗時、リース解放のためcompleteOAuthRefresh({success:false})がベストエフォートで呼ばれる", async () => {
      const completeOAuthRefresh = vi.fn().mockResolvedValue(true);

      await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({
          refreshAccessToken: async () => ({ ok: false, error: { code: "concur_oauth_timeout", message: "m" }, logSummary: {} }),
          completeOAuthRefresh,
        }),
        parseBody: parseBodyFor(buildValidBody()),
      });

      expect(completeOAuthRefresh).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, errorCode: "concur_oauth_timeout" }),
      );
    });

    it("7. Vaultリースが取得できない場合（未接続・ロック中）、concur_oauth_not_connectedを返しOAuth token endpoint・Identity API・Quick Expense処理のいずれも呼ばない", async () => {
      const refreshAccessToken = vi.fn();
      const lookupUser = vi.fn();
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({ getRefreshTokenForEdge: async () => null, refreshAccessToken, lookupUser }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(503);
      expect(body.error.code).toBe("concur_oauth_not_connected");
      expect(refreshAccessToken).not.toHaveBeenCalled();
      expect(lookupUser).not.toHaveBeenCalled();
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("7b. Vault完了RPCがfalse（lease不一致）の場合、concur_oauth_completion_failedを返しIdentity API・Quick Expense処理を呼ばない", async () => {
      const lookupUser = vi.fn();
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({ completeOAuthRefresh: async () => false, lookupUser }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(500);
      expect(body.error.code).toBe("concur_oauth_completion_failed");
      expect(lookupUser).not.toHaveBeenCalled();
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("7c. Vault完了RPCが例外（Vault更新自体が失敗）の場合、concur_oauth_storage_failedを返しIdentity API・Quick Expense処理を呼ばない", async () => {
      const lookupUser = vi.fn();
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({
          completeOAuthRefresh: async () => {
            throw new Error("vault write failed");
          },
          lookupUser,
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(500);
      expect(body.error.code).toBe("concur_oauth_storage_failed");
      expect(lookupUser).not.toHaveBeenCalled();
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("8. concurLoginIdが空・不正な場合、Vaultリース取得すら行わずvalidation_errorを返す（Quick Expense処理も呼ばない）", async () => {
      const getRefreshTokenForEdge = vi.fn();
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({ getRefreshTokenForEdge }),
        parseBody: parseBodyFor(buildValidBody({ concurLoginId: "" })),
        createQuickExpense,
      });

      expect(status).toBe(400);
      expect(body.error.code).toBe("validation_error");
      expect(body.error.details).toContainEqual({ field: "concurLoginId", reason: "required" });
      expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("9. 解決したuserID（Concur内部UUID）がレスポンスへ一切含まれない", async () => {
      const { body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput(),
        parseBody: parseBodyFor(buildValidBody()),
      });

      expect(JSON.stringify(body)).not.toContain(DUMMY_CONCUR_USER_ID);
    });

    it("10. Access Token・Refresh Token・ConcurログインIDがレスポンス・ログへ一切含まれない（このモジュール自体はconsole.log/errorを一切呼ばない）", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput(),
        parseBody: parseBodyFor(buildValidBody({ concurLoginId: "secret.login.id@example.com" })),
      });

      const allLoggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ");
      expect(allLoggedText).toBe("");
      const serializedBody = JSON.stringify(body);
      expect(serializedBody).not.toContain(DUMMY_ACCESS_TOKEN);
      expect(serializedBody).not.toContain(DUMMY_REFRESH_TOKEN);
      expect(serializedBody).not.toContain("secret.login.id@example.com");

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("11. Identity検索・OAuth token更新のいずれも、実際の外部HTTP通信（グローバルfetch）を一度も発生させない", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      // getRefreshTokenForEdge・refreshAccessToken・lookupUserはいずれも
      // buildGateOnAuthedInput()の既定でfetchを使わないモックへ差し替え済み。
      // ここでは最終呼び出し（Quick Expense本体）も明示的にモックし、この
      // テストの検証対象（Identity・OAuth部分）以外の要因でfetchが呼ばれない
      // ようにする（createQuickExpenseViaConcur自体の実fetch検証は別テスト
      // 「ゲートON＋Identity成功の場合...」で行う）。
      await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput(),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense: vi.fn().mockResolvedValue({ result: { quickExpenseId: "x", status: "created" }, error: null }),
      });

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("Vaultリース取得自体が例外を投げた場合はinternal_error（機密情報を含まない）", async () => {
      const secretLike = "SECRET_VAULT_DETAIL_SHOULD_NOT_LEAK";
      const lookupUser = vi.fn();
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({
          getRefreshTokenForEdge: async () => {
            throw new Error(`boom: ${secretLike}`);
          },
          lookupUser,
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(500);
      expect(body.error.code).toBe("internal_error");
      expect(JSON.stringify(body)).not.toContain(secretLike);
      expect(lookupUser).not.toHaveBeenCalled();
      expect(createQuickExpense).not.toHaveBeenCalled();
    });

    it("Identity検索自体が例外を投げた場合もinternal_error（機密情報を含まない）", async () => {
      const secretLike = "SECRET_IDENTITY_DETAIL_SHOULD_NOT_LEAK";
      const createQuickExpense = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({
          lookupUser: async () => {
            throw new Error(`boom: ${secretLike}`);
          },
        }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense,
      });

      expect(status).toBe(500);
      expect(body.error.code).toBe("internal_error");
      expect(JSON.stringify(body)).not.toContain(secretLike);
      expect(createQuickExpense).not.toHaveBeenCalled();
    });
  });

  // 【重要・cross-company Token混在の防止・設計レビューにより最終決定】
  // 以前はgetRefreshTokenForEdgeへ常にcompanyId: null（既定の共有接続）を
  // 渡す実装になっており、複数社対応後は「A社のリクエストなのに別会社
  // （または共有の既定接続）のConcur OAuth接続を使ってしまう」リスクが
  // あった。設計レビューの結論により、company UUIDの解決はget_my_public_
  // config()（fetchCompanyMembership）ではなく、service_role専用の別RPC
  // resolveOAuthCompanyId({ userId, companyCode })（resolve_concur_oauth_
  // company_id相当。supabase/schema.sql参照）に分離した。membershipオブ
  // ジェクトはcompany UUIDを一切持たない（get_my_public_config()は所属確認・
  // 経費タイプ検証専用の責務のみ）。ここではresolveOAuthCompanyIdが解決した
  // 値だけがgetRefreshTokenForEdgeへ渡ることを確認する
  // （handleQuickExpenseRequest.js「会社境界（重要）」コメント参照）。
  describe("会社ごとのVault OAuth接続の境界（company-scoped resolveOAuthCompanyId→getRefreshTokenForEdge）", () => {
    const COMPANY_C_UUID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const MULTI_COMPANY_MEMBERSHIPS = {
      "company-a": {
        company_code: "company-a",
        role: "user",
        expenseTypes: [VALID_EXPENSE_TYPE],
        expenseTypeIdMode: "concur_exp_key",
      },
      "company-c": {
        company_code: "company-c",
        role: "user",
        expenseTypes: [{ id: "01063", policyId: "policy-y", name: "交通費", active: true }],
        expenseTypeIdMode: "concur_exp_key",
      },
    };

    function buildMultiCompanyFetchCompanyMembership() {
      return vi.fn(async (_user, companyCode) => MULTI_COMPANY_MEMBERSHIPS[companyCode] ?? null);
    }

    function buildMultiCompanyResolveOAuthCompanyId() {
      return vi.fn(async ({ companyCode }) => {
        if (companyCode === "company-a") return COMPANY_A_UUID;
        if (companyCode === "company-c") return COMPANY_C_UUID;
        return null;
      });
    }

    function buildStubCreateQuickExpense() {
      return vi.fn().mockResolvedValue({
        result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" },
        error: null,
      });
    }

    it("resolveOAuthCompanyIdへ、JWTで検証済みのuserIdと本文のcompanyCode（company_code）が渡る", async () => {
      const resolveOAuthCompanyId = vi.fn().mockResolvedValue(COMPANY_A_UUID);

      await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({ resolveOAuthCompanyId }),
        parseBody: parseBodyFor(buildValidBody({ companyId: "company-a" })),
        createQuickExpense: buildStubCreateQuickExpense(),
      });

      expect(resolveOAuthCompanyId).toHaveBeenCalledWith({ userId: VALID_USER.id, companyCode: "company-a" });
    });

    it("A社のリクエストは、resolveOAuthCompanyIdが返したA社UUIDだけをgetRefreshTokenForEdgeへ渡す", async () => {
      const getRefreshTokenForEdge = vi.fn().mockResolvedValue({
        connectionId: "conn-a",
        leaseId: "lease-a",
        refreshToken: DUMMY_REFRESH_TOKEN,
      });
      const fetchCompanyMembership = buildMultiCompanyFetchCompanyMembership();
      const resolveOAuthCompanyId = buildMultiCompanyResolveOAuthCompanyId();

      const { status } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({ fetchCompanyMembership, resolveOAuthCompanyId, getRefreshTokenForEdge }),
        parseBody: parseBodyFor(buildValidBody({ companyId: "company-a" })),
        createQuickExpense: buildStubCreateQuickExpense(),
      });

      expect(status).toBe(200);
      expect(getRefreshTokenForEdge).toHaveBeenCalledTimes(1);
      expect(getRefreshTokenForEdge).toHaveBeenCalledWith({ companyId: COMPANY_A_UUID });
    });

    it("C社のリクエストは、resolveOAuthCompanyIdが返したC社UUIDだけをgetRefreshTokenForEdgeへ渡す（A社のUUIDが混ざらない）", async () => {
      const getRefreshTokenForEdge = vi.fn().mockResolvedValue({
        connectionId: "conn-c",
        leaseId: "lease-c",
        refreshToken: DUMMY_REFRESH_TOKEN,
      });
      const fetchCompanyMembership = buildMultiCompanyFetchCompanyMembership();
      const resolveOAuthCompanyId = buildMultiCompanyResolveOAuthCompanyId();

      const { status } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({ fetchCompanyMembership, resolveOAuthCompanyId, getRefreshTokenForEdge }),
        parseBody: parseBodyFor(
          buildValidBody({ companyId: "company-c", policyId: "policy-y", expenseTypeId: "01063" }),
        ),
        createQuickExpense: buildStubCreateQuickExpense(),
      });

      expect(status).toBe(200);
      expect(getRefreshTokenForEdge).toHaveBeenCalledTimes(1);
      expect(getRefreshTokenForEdge).toHaveBeenCalledWith({ companyId: COMPANY_C_UUID });
      expect(getRefreshTokenForEdge).not.toHaveBeenCalledWith({ companyId: COMPANY_A_UUID });
    });

    it("複数社所属ユーザーでも、リクエストのcompanyCodeから一意にVault会社UUIDが解決される（先頭会社の自動選択にならない）", async () => {
      // COMPANY_A_MEMBERSHIP・COMPANY_C_MEMBERSHIPの両方に所属している
      // ユーザーを想定し、リクエストごとのcompanyCodeだけで解決先が変わる
      // ことを確認する（buildMultiCompanyResolveOAuthCompanyId自体が
      // companyCodeを見て分岐する実装であることが前提だが、ここでは
      // handleQuickExpenseRequest.js側が実際にそのcompanyCodeを毎回正しく
      // 転送していることを検証する）。
      const resolveOAuthCompanyId = buildMultiCompanyResolveOAuthCompanyId();
      const fetchCompanyMembership = buildMultiCompanyFetchCompanyMembership();
      const getRefreshTokenForEdgeForA = vi.fn().mockResolvedValue({
        connectionId: "conn-a",
        leaseId: "lease-a",
        refreshToken: DUMMY_REFRESH_TOKEN,
      });
      const getRefreshTokenForEdgeForC = vi.fn().mockResolvedValue({
        connectionId: "conn-c",
        leaseId: "lease-c",
        refreshToken: DUMMY_REFRESH_TOKEN,
      });

      await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({
          fetchCompanyMembership,
          resolveOAuthCompanyId,
          getRefreshTokenForEdge: getRefreshTokenForEdgeForA,
        }),
        parseBody: parseBodyFor(buildValidBody({ companyId: "company-a" })),
        createQuickExpense: buildStubCreateQuickExpense(),
      });
      await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({
          fetchCompanyMembership,
          resolveOAuthCompanyId,
          getRefreshTokenForEdge: getRefreshTokenForEdgeForC,
        }),
        parseBody: parseBodyFor(
          buildValidBody({ companyId: "company-c", policyId: "policy-y", expenseTypeId: "01063" }),
        ),
        createQuickExpense: buildStubCreateQuickExpense(),
      });

      expect(getRefreshTokenForEdgeForA).toHaveBeenCalledWith({ companyId: COMPANY_A_UUID });
      expect(getRefreshTokenForEdgeForC).toHaveBeenCalledWith({ companyId: COMPANY_C_UUID });
    });

    it("A社リクエストの結果、A社用のRefresh Token（Vaultリース）だけが使われる", async () => {
      const getRefreshTokenForEdge = vi.fn(async ({ companyId }) => {
        if (companyId === COMPANY_A_UUID) {
          return { connectionId: "conn-a", leaseId: "lease-a", refreshToken: "REFRESH_TOKEN_FOR_COMPANY_A" };
        }
        // A社以外（本来渡ってきてはいけない値）が渡された場合は、それを検出
        // できるよう別会社用のダミーTokenを返す（後続のrefreshAccessTokenが
        // このTokenを受け取ってしまわないことを確認する）。
        return { connectionId: "conn-other", leaseId: "lease-other", refreshToken: "REFRESH_TOKEN_FOR_OTHER_COMPANY" };
      });
      const refreshAccessToken = vi.fn().mockResolvedValue({
        ok: true,
        rotated: false,
        tokens: {
          accessToken: DUMMY_ACCESS_TOKEN,
          refreshToken: DUMMY_REFRESH_TOKEN,
          tokenType: "Bearer",
          expiresIn: 3600,
          scope: "quickexpense.writeonly user.read identity.user.ids.read",
          geolocation: DUMMY_GEOLOCATION,
        },
        logSummary: { ok: true },
      });

      await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({ getRefreshTokenForEdge, refreshAccessToken }),
        parseBody: parseBodyFor(buildValidBody({ companyId: "company-a" })),
        createQuickExpense: buildStubCreateQuickExpense(),
      });

      expect(refreshAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ refreshToken: "REFRESH_TOKEN_FOR_COMPANY_A" }),
      );
    });

    it("resolveOAuthCompanyIdがnullを返す（未所属・存在しない会社・本番未適用でRPC自体が無い場合を含む）場合、Vaultリース取得自体を行わずconcur_oauth_not_connectedを返す（既定接続へフォールバックしない）", async () => {
      const getRefreshTokenForEdge = vi.fn();
      const resolveOAuthCompanyId = vi.fn().mockResolvedValue(null);

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({ resolveOAuthCompanyId, getRefreshTokenForEdge }),
        parseBody: parseBodyFor(buildValidBody()),
      });

      expect(status).toBe(503);
      expect(body.error.code).toBe("concur_oauth_not_connected");
      expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
    });

    it("resolveOAuthCompanyIdが空文字を返した場合も未解決として扱いfail-closed（concur_oauth_not_connected）", async () => {
      const getRefreshTokenForEdge = vi.fn();
      const resolveOAuthCompanyId = vi.fn().mockResolvedValue("");

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({ resolveOAuthCompanyId, getRefreshTokenForEdge }),
        parseBody: parseBodyFor(buildValidBody()),
      });

      expect(status).toBe(503);
      expect(body.error.code).toBe("concur_oauth_not_connected");
      expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
    });

    it("resolveOAuthCompanyId自体が例外を投げた場合はinternal_error（Vaultリース取得へは進まない）", async () => {
      const getRefreshTokenForEdge = vi.fn();
      const resolveOAuthCompanyId = vi.fn().mockRejectedValue(new Error("boom"));

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({ resolveOAuthCompanyId, getRefreshTokenForEdge }),
        parseBody: parseBodyFor(buildValidBody()),
      });

      expect(status).toBe(500);
      expect(body.error.code).toBe("internal_error");
      expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
    });

    it("リクエスト本文のcompanyId（company_codeの文字列、例:'company-a'）がそのままgetRefreshTokenForEdgeへ渡ることはない（company_codeとcompany UUIDの取り違え防止）", async () => {
      const getRefreshTokenForEdge = vi.fn().mockResolvedValue({
        connectionId: "conn-a",
        leaseId: "lease-a",
        refreshToken: DUMMY_REFRESH_TOKEN,
      });

      await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({ getRefreshTokenForEdge }),
        parseBody: parseBodyFor(buildValidBody({ companyId: "company-a" })),
        createQuickExpense: buildStubCreateQuickExpense(),
      });

      expect(getRefreshTokenForEdge).not.toHaveBeenCalledWith({ companyId: "company-a" });
      expect(getRefreshTokenForEdge).toHaveBeenCalledWith({ companyId: COMPANY_A_UUID });
    });

    it("クライアントがcompany UUIDらしき値を何らかの形で本文に紛れ込ませても、それは使われない（常にresolveOAuthCompanyIdの戻り値だけを使う）", async () => {
      const getRefreshTokenForEdge = vi.fn().mockResolvedValue({
        connectionId: "conn-a",
        leaseId: "lease-a",
        refreshToken: DUMMY_REFRESH_TOKEN,
      });
      const attackerSuppliedUuid = "ffffffff-ffff-ffff-ffff-ffffffffffff";

      await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({ getRefreshTokenForEdge }),
        // companyIdフィールドはcompany_code（スラッグ）を指す契約であり、
        // このEdge Functionのリクエストスキーマにcompany UUID用の別フィールドは
        // 存在しない（validateQuickExpenseRequest.js参照）。ここではその上で、
        // 万一クライアントが無関係な値をどこかに含めても無視されることを示す
        // ため、スキーマ外のフィールドとして紛れ込ませる。
        parseBody: parseBodyFor(buildValidBody({ companyId: "company-a", companyDbId: attackerSuppliedUuid })),
        createQuickExpense: buildStubCreateQuickExpense(),
      });

      expect(getRefreshTokenForEdge).not.toHaveBeenCalledWith({ companyId: attackerSuppliedUuid });
      expect(getRefreshTokenForEdge).toHaveBeenCalledWith({ companyId: COMPANY_A_UUID });
    });

    it("ゲートOFFの場合、resolveOAuthCompanyIdも含めVault/OAuth/Identity/Quick Expenseのいずれも呼ばれない", async () => {
      const resolveOAuthCompanyId = vi.fn();
      const getRefreshTokenForEdge = vi.fn();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({ resolveOAuthCompanyId, getRefreshTokenForEdge }),
        parseBody: parseBodyFor(buildValidBody()),
      });

      expect(status).toBe(200);
      expect(body.error).toBeNull();
      expect(resolveOAuthCompanyId).not.toHaveBeenCalled();
      expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
    });

    it("応答・ログにcompany UUID（resolveOAuthCompanyIdの戻り値）が一切含まれない", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput(),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense: buildStubCreateQuickExpense(),
      });

      const allLoggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ");
      expect(allLoggedText).not.toContain(COMPANY_A_UUID);
      expect(JSON.stringify(body)).not.toContain(COMPANY_A_UUID);

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  // 安全ゲート（CONCUR_QUICK_EXPENSE_ENABLED）本体の振る舞い。
  describe("安全ゲート（CONCUR_QUICK_EXPENSE_ENABLED）", () => {
    it.each([
      [undefined, "未設定"],
      ["", "空文字"],
      ["false", "false"],
      ["False", "大文字小文字違い（False）"],
      ["TRUE", "大文字小文字違い（TRUE）"],
      [true, "真偽値true（文字列でない）"],
      ["yes", "その他の文字列"],
    ])(
      "ゲートOFF（CONCUR_QUICK_EXPENSE_ENABLED=%s・%s）の場合、Vault・OAuth・Identityのいずれも呼ばず既存のスタブ応答を返す",
      async (value) => {
        const getRefreshTokenForEdge = vi.fn();
        const refreshAccessToken = vi.fn();
        const completeOAuthRefresh = vi.fn();
        const lookupUser = vi.fn();

        const { status, body } = await handleQuickExpenseRequest({
          method: "POST",
          ...buildAuthedInput({
            env: { CONCUR_QUICK_EXPENSE_ENABLED: value },
            getRefreshTokenForEdge,
            refreshAccessToken,
            completeOAuthRefresh,
            lookupUser,
          }),
          parseBody: parseBodyFor(buildValidBody()),
        });

        expect(status).toBe(200);
        expect(body).toEqual({ result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" }, error: null });
        expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
        expect(refreshAccessToken).not.toHaveBeenCalled();
        expect(completeOAuthRefresh).not.toHaveBeenCalled();
        expect(lookupUser).not.toHaveBeenCalled();
      },
    );

    it('ゲートON（CONCUR_QUICK_EXPENSE_ENABLED==="true"）の場合のみVault→OAuth→Identityパイプラインへ進む', async () => {
      const getRefreshTokenForEdge = defaultGetRefreshTokenForEdge();

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput({ getRefreshTokenForEdge }),
        parseBody: parseBodyFor(buildValidBody()),
        // このテストの目的は「パイプライン（Vault→OAuth→Identity）へ進むこと」の
        // 確認であり、最終呼び出し（Quick Expense本体）の実装検証は別テスト
        // 「ゲートON＋Identity成功の場合...」の担当のため、ここでは明示的に
        // 差し替えて実fetchを避ける。
        createQuickExpense: vi.fn().mockResolvedValue({ result: { quickExpenseId: "x", status: "created" }, error: null }),
      });

      expect(status).toBe(200);
      expect(body.error).toBeNull();
    });

    it("ゲートOFF時も、入力検証・認可・companyId確認・経費タイプ検証は維持される（Vault呼び出し前に判定される）", async () => {
      const getRefreshTokenForEdge = vi.fn();

      const unauthorized = await handleQuickExpenseRequest({
        method: "POST",
        authHeader: null,
        fetchUser: vi.fn(),
        fetchCompanyMembership: vi.fn(),
        env: {},
        getRefreshTokenForEdge,
        parseBody: parseBodyFor(buildValidBody()),
      });
      expect(unauthorized.status).toBe(401);

      const validationError = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({ getRefreshTokenForEdge }),
        parseBody: parseBodyFor({}),
      });
      expect(validationError.status).toBe(400);
      expect(validationError.body.error.code).toBe("validation_error");

      const companyMismatch = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({
          fetchCompanyMembership: async (_user, companyCode) =>
            companyCode === "company-b" ? { company_code: "company-b", role: "user", expenseTypes: [] } : null,
          getRefreshTokenForEdge,
        }),
        parseBody: parseBodyFor(buildValidBody({ companyId: "company-a" })),
      });
      expect(companyMismatch.status).toBe(403);
      expect(companyMismatch.body.error.code).toBe("forbidden");

      const expenseTypeNotFound = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({ getRefreshTokenForEdge }),
        parseBody: parseBodyFor(buildValidBody({ expenseTypeId: "does_not_exist" })),
      });
      expect(expenseTypeNotFound.status).toBe(403);
      expect(expenseTypeNotFound.body.error.code).toBe("expense_type_not_found");

      // これらいずれの分岐でも、Vaultリース取得（実通信につながる最初の一歩）
      // には一切到達していない。
      expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
    });

    it("ゲートON＋Identity成功の場合、resolveされたcreateQuickExpenseViaConcur相当の実装へ解決したuserIDが渡る（明示DI無し）", async () => {
      let capturedInit;
      // createQuickExpenseViaConcur()は_shared/concur-quick-expense/createConcurQuickExpense.jsを
      // 経由して最終的にfetchImplを呼ぶ設計だが、handleQuickExpenseRequest.jsは
      // fetchImplを明示的に渡していないため、ここではグローバルfetch自体を
      // モックへ差し替えて実通信が発生しないことを保証する
      // （afterEachのvi.unstubAllGlobals()で自動的に復元される）。
      const fetchSpy = vi.fn(async (_url, init) => {
        capturedInit = init;
        return { status: 201, json: async () => ({ quickExpenseIdUri: "https://example-dummy.concursolutions.test/quickexpense/v4/users/x/context/TRAVELER/quickexpenses/dummy-id" }) };
      });
      vi.stubGlobal("fetch", fetchSpy);

      const { status, body } = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput(),
        parseBody: parseBodyFor(buildValidBody()),
      });

      expect(status).toBe(200);
      expect(body.error).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(capturedInit.headers.Authorization).toBe(`Bearer ${DUMMY_ACCESS_TOKEN}`);
    });

    it("明示的にcreateQuickExpenseを渡した場合、ゲートの状態に関わらずその実装が最優先される（既存テストとの互換性）", async () => {
      const explicitCreateQuickExpense = vi.fn().mockResolvedValue({ result: { quickExpenseId: "explicit", status: "explicit" }, error: null });
      const getRefreshTokenForEdge = vi.fn();

      const gateOff = await handleQuickExpenseRequest({
        method: "POST",
        ...buildAuthedInput({ env: {}, getRefreshTokenForEdge }),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense: explicitCreateQuickExpense,
      });
      expect(gateOff.status).toBe(200);
      expect(gateOff.body.result).toEqual({ quickExpenseId: "explicit", status: "explicit" });

      const gateOn = await handleQuickExpenseRequest({
        method: "POST",
        ...buildGateOnAuthedInput(),
        parseBody: parseBodyFor(buildValidBody()),
        createQuickExpense: explicitCreateQuickExpense,
      });
      expect(gateOn.status).toBe(200);
      expect(gateOn.body.result).toEqual({ quickExpenseId: "explicit", status: "explicit" });

      // ゲートOFFの場合、明示DIがあってもVault/OAuth/Identityパイプラインは動かない。
      expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
      expect(explicitCreateQuickExpense).toHaveBeenCalledTimes(2);
    });
  });
});
