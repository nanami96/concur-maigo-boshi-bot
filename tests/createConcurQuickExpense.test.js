import { describe, it, expect } from "vitest";
import { createConcurQuickExpense } from "../supabase/functions/_shared/concur-quick-expense/createConcurQuickExpense.js";

// 以下の値はすべてテスト専用のダミー値であり、実際のConcur側の値ではない。
// 本物のQuick Expense APIへは一切通信しない（fetchImplを常にモックへ差し替える）。
const DUMMY_ACCESS_TOKEN = "DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK";
const DUMMY_GEOLOCATION = "https://example-dummy.concursolutions.test";
const DUMMY_USER_ID = "3df11695-e8bb-40ff-8e98-c85913ab2789";
const DUMMY_QUICK_EXPENSE_ID_URI = `${DUMMY_GEOLOCATION}/quickexpense/v4/users/${DUMMY_USER_ID}/context/TRAVELER/quickexpenses/dummy-id`;

function jsonFetch(status, body) {
  return async () => ({ status, json: async () => body });
}

function buildValidInput(overrides = {}) {
  return {
    geolocation: DUMMY_GEOLOCATION,
    accessToken: DUMMY_ACCESS_TOKEN,
    userId: DUMMY_USER_ID,
    expenseTypeId: "MEAL",
    transactionDate: "2026-07-28",
    amount: 1000,
    currencyCode: "JPY",
    ...overrides,
  };
}

describe("createConcurQuickExpense（成功系）", () => {
  it("201・quickExpenseIdUriありの場合、ok:trueで値を返す", async () => {
    const result = await createConcurQuickExpense(
      buildValidInput({ fetchImpl: jsonFetch(201, { quickExpenseIdUri: DUMMY_QUICK_EXPENSE_ID_URI }) }),
    );

    expect(result).toEqual({ ok: true, quickExpenseIdUri: DUMMY_QUICK_EXPENSE_ID_URI });
  });
});

describe("createConcurQuickExpense（concur-correlationidヘッダー）", () => {
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  it("correlationId未指定の場合、実際のfetch呼び出しヘッダーへ自動生成したUUIDが設定される", async () => {
    let capturedInit;
    const fetchImpl = async (_url, init) => {
      capturedInit = init;
      return { status: 201, json: async () => ({ quickExpenseIdUri: DUMMY_QUICK_EXPENSE_ID_URI }) };
    };

    await createConcurQuickExpense(buildValidInput({ fetchImpl }));

    expect(capturedInit.headers["concur-correlationid"]).toMatch(UUID_PATTERN);
  });

  it("correlationIdを明示的に指定した場合、そのままfetch呼び出しヘッダーへ渡される", async () => {
    let capturedInit;
    const dummyCorrelationId = "11111111-2222-3333-4444-555555555555";
    const fetchImpl = async (_url, init) => {
      capturedInit = init;
      return { status: 201, json: async () => ({ quickExpenseIdUri: DUMMY_QUICK_EXPENSE_ID_URI }) };
    };

    await createConcurQuickExpense(buildValidInput({ fetchImpl, correlationId: dummyCorrelationId }));

    expect(capturedInit.headers["concur-correlationid"]).toBe(dummyCorrelationId);
  });

  it("concur-correlationidの値にuserID・Access Token・経費内容が一切含まれない", async () => {
    let capturedInit;
    const fetchImpl = async (_url, init) => {
      capturedInit = init;
      return { status: 201, json: async () => ({ quickExpenseIdUri: DUMMY_QUICK_EXPENSE_ID_URI }) };
    };

    await createConcurQuickExpense(buildValidInput({ fetchImpl, vendorName: "Should Not Leak Vendor" }));

    const correlationId = capturedInit.headers["concur-correlationid"];
    expect(correlationId).not.toContain(DUMMY_ACCESS_TOKEN);
    expect(correlationId).not.toContain(DUMMY_USER_ID);
    expect(correlationId).not.toContain("Should Not Leak Vendor");
  });
});

describe("createConcurQuickExpense（入力検証・userId必須の確認）", () => {
  it("userIdが無い場合、Identity APIやfetchを一切呼ばずconcur_quick_expense_invalid_requestを返す", async () => {
    let fetchCalled = false;
    const { userId, ...rest } = buildValidInput();
    const fetchImpl = async () => {
      fetchCalled = true;
      return { status: 201, json: async () => ({ quickExpenseIdUri: DUMMY_QUICK_EXPENSE_ID_URI }) };
    };

    const result = await createConcurQuickExpense({ ...rest, fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_quick_expense_invalid_request");
    expect(fetchCalled).toBe(false);
  });

  it("userIdが空文字・null・数値等、未取得/推測/固定値相当の値では成功しない", async () => {
    for (const invalidUserId of ["", "   ", null, undefined, 12345]) {
      const result = await createConcurQuickExpense(
        buildValidInput({ userId: invalidUserId, fetchImpl: jsonFetch(201, { quickExpenseIdUri: DUMMY_QUICK_EXPENSE_ID_URI }) }),
      );
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("concur_quick_expense_invalid_request");
    }
  });

  it("expenseTypeId・transactionDate・amount・currencyCodeが無い場合はconcur_quick_expense_invalid_request", async () => {
    const requiredFields = ["expenseTypeId", "transactionDate", "amount", "currencyCode"];
    for (const field of requiredFields) {
      const input = buildValidInput({ fetchImpl: jsonFetch(201, { quickExpenseIdUri: DUMMY_QUICK_EXPENSE_ID_URI }) });
      delete input[field];
      const result = await createConcurQuickExpense(input);
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("concur_quick_expense_invalid_request");
    }
  });
});

describe("createConcurQuickExpense（geolocation欠落）", () => {
  it("geolocationが無い場合はfetchを一切呼ばずconcur_quick_expense_geolocation_missing", async () => {
    let fetchCalled = false;
    const fetchImpl = async () => {
      fetchCalled = true;
      return { status: 201, json: async () => ({ quickExpenseIdUri: DUMMY_QUICK_EXPENSE_ID_URI }) };
    };

    const result = await createConcurQuickExpense(buildValidInput({ geolocation: null, fetchImpl }));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_quick_expense_geolocation_missing");
    expect(fetchCalled).toBe(false);
  });

  it("geolocationが空白のみの場合も同様に通信しない", async () => {
    let fetchCalled = false;
    const fetchImpl = async () => {
      fetchCalled = true;
      return { status: 201, json: async () => ({ quickExpenseIdUri: DUMMY_QUICK_EXPENSE_ID_URI }) };
    };

    const result = await createConcurQuickExpense(buildValidInput({ geolocation: "   ", fetchImpl }));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_quick_expense_geolocation_missing");
    expect(fetchCalled).toBe(false);
  });
});

describe("createConcurQuickExpense（HTTP異常系）", () => {
  it("タイムアウトした場合はconcur_quick_expense_timeout", async () => {
    const fetchImpl = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });

    const result = await createConcurQuickExpense(buildValidInput({ fetchImpl, timeoutMs: 20 }));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_quick_expense_timeout");
  });

  it("通常のネットワークエラーはconcur_quick_expense_network_error", async () => {
    const fetchImpl = async () => {
      throw new Error("dummy connection refused");
    };

    const result = await createConcurQuickExpense(buildValidInput({ fetchImpl }));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_quick_expense_network_error");
  });

  it("400はconcur_quick_expense_invalid_request", async () => {
    const result = await createConcurQuickExpense(buildValidInput({ fetchImpl: jsonFetch(400, {}) }));
    expect(result.error.code).toBe("concur_quick_expense_invalid_request");
  });

  it("403はconcur_quick_expense_rejected", async () => {
    const result = await createConcurQuickExpense(buildValidInput({ fetchImpl: jsonFetch(403, {}) }));
    expect(result.error.code).toBe("concur_quick_expense_rejected");
  });

  it("429はconcur_quick_expense_rate_limited", async () => {
    const result = await createConcurQuickExpense(buildValidInput({ fetchImpl: jsonFetch(429, {}) }));
    expect(result.error.code).toBe("concur_quick_expense_rate_limited");
  });

  it("500はconcur_quick_expense_service_error", async () => {
    const result = await createConcurQuickExpense(buildValidInput({ fetchImpl: jsonFetch(500, {}) }));
    expect(result.error.code).toBe("concur_quick_expense_service_error");
  });

  it("201だがquickExpenseIdUriが無い場合はconcur_quick_expense_invalid_response", async () => {
    const result = await createConcurQuickExpense(buildValidInput({ fetchImpl: jsonFetch(201, {}) }));
    expect(result.error.code).toBe("concur_quick_expense_invalid_response");
  });

  it("JSON不正（response.json()が例外）はconcur_quick_expense_invalid_response", async () => {
    const fetchImpl = async () => ({
      status: 201,
      json: async () => {
        throw new SyntaxError("Unexpected token in JSON");
      },
    });

    const result = await createConcurQuickExpense(buildValidInput({ fetchImpl }));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_quick_expense_invalid_response");
  });
});

describe("createConcurQuickExpense（セキュリティ・非露出）", () => {
  it("Access Token・userIdの値がエラー結果へ一切含まれない", async () => {
    const fetchImpl = jsonFetch(500, { debug: "RAW_RESPONSE_BODY_SHOULD_NOT_LEAK" });

    const result = await createConcurQuickExpense(buildValidInput({ fetchImpl }));

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(DUMMY_ACCESS_TOKEN);
    expect(serialized).not.toContain(DUMMY_USER_ID);
    expect(serialized).not.toContain("RAW_RESPONSE_BODY_SHOULD_NOT_LEAK");
  });

  it("fetch例外の詳細（メッセージ）を外部へ一切漏らさない", async () => {
    const secretLikeMessage = "SHOULD_NOT_LEAK_EXCEPTION_DETAIL";
    const fetchImpl = async () => {
      throw new Error(secretLikeMessage);
    };

    const result = await createConcurQuickExpense(buildValidInput({ fetchImpl }));

    expect(JSON.stringify(result)).not.toContain(secretLikeMessage);
  });

  it("成功結果にAccess Token・userId・経費内容が含まれない（quickExpenseIdUriのみ）", async () => {
    const result = await createConcurQuickExpense(
      buildValidInput({
        vendorName: "Should Not Leak Vendor",
        memo: "Should Not Leak Memo",
        fetchImpl: jsonFetch(201, { quickExpenseIdUri: DUMMY_QUICK_EXPENSE_ID_URI, extraField: "Should Not Leak Extra" }),
      }),
    );

    expect(Object.keys(result).sort()).toEqual(["ok", "quickExpenseIdUri"].sort());
    expect(JSON.stringify(result)).not.toContain(DUMMY_ACCESS_TOKEN);
    expect(JSON.stringify(result)).not.toContain("Should Not Leak Vendor");
    expect(JSON.stringify(result)).not.toContain("Should Not Leak Memo");
    expect(JSON.stringify(result)).not.toContain("Should Not Leak Extra");
  });

  it("エラーメッセージは固定文言のみで、Concur側の生レスポンス・validationErrorsを含まない", async () => {
    const fetchImpl = jsonFetch(400, {
      errorMessage: "SECRET_ERROR_MESSAGE_SHOULD_NOT_LEAK",
      validationErrors: [{ message: "SECRET_VALIDATION_DETAIL_SHOULD_NOT_LEAK", source: "transactionAmount" }],
    });

    const result = await createConcurQuickExpense(buildValidInput({ fetchImpl }));

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SECRET_ERROR_MESSAGE_SHOULD_NOT_LEAK");
    expect(serialized).not.toContain("SECRET_VALIDATION_DETAIL_SHOULD_NOT_LEAK");
  });
});
