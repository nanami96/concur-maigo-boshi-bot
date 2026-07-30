// Concur Quick Expense API（POST /quickexpense/v4/users/{userID}/context/
// {contextType}/quickexpenses、画像無し版）でクイックエクスペンスを作成する
// 処理を1本化する呼び出し口。
// validateConcurQuickExpenseRequest.js（内部データ→公式Request Body変換・
// 検証）→ buildConcurQuickExpenseRequest.js（リクエスト組み立て）→
// fetchConcurQuickExpenseResponse.js（タイムアウト付きfetch）→
// classifyConcurQuickExpenseHttpStatus.js（HTTPレスポンス分類）→
// validateConcurQuickExpenseResponse.js（レスポンス本文の検証）
// の順で処理する（supabase/functions/_shared/concur-identity/
// lookupConcurUser.jsと同じ構成）。
//
// 【重要・このモジュールの位置づけ（今回のスコープ）】
// このモジュールはIdentity API・userId解決処理と一切接続しない。userIdは
// 呼び出し元（将来、実際にこのモジュールを呼び出すEdge Function側の実装）が
// 解決済みの値を明示的な必須引数として渡す（未取得・null・推測・固定値は
// 許容しない）。また、実際のEdge Function（create-concur-quick-expense/
// handleQuickExpenseRequest.js・createQuickExpenseStub.js）・フロントの
// Repository/UIとは今回一切接続していない（ライブラリ部分のみの実装）。
//
// 【重要・Access Tokenの扱い】この関数はaccessTokenを引数として受け取るだけで、
// 保存・ログ出力は一切行わない。呼び出し元がConcur OAuthのRefresh Token
// Grantで取得した一時的な値を渡し、この関数の呼び出しが終わればスコープを
// 抜けて破棄される（DB・Vault・Secretsのいずれにも保存しない）。
//
// 【重要・geolocationの扱い】Quick Expense APIのベースURLは、OAuth token
// レスポンスのgeolocation値をそのまま使う（Identity APIと同じ方針）。
// geolocationは任意項目のため、値が無い場合はConcur側と一切通信せず、
// 安全に失敗させる（concur_quick_expense_geolocation_missing）。
import { validateConcurQuickExpenseRequest } from "./validateConcurQuickExpenseRequest.js";
import { buildConcurQuickExpenseRequest } from "./buildConcurQuickExpenseRequest.js";
import { fetchConcurQuickExpenseResponse } from "./fetchConcurQuickExpenseResponse.js";
import { classifyConcurQuickExpenseHttpStatus } from "./classifyConcurQuickExpenseHttpStatus.js";
import { validateConcurQuickExpenseResponse } from "./validateConcurQuickExpenseResponse.js";
import { buildConcurQuickExpenseError } from "./classifyConcurQuickExpenseError.js";

function failure(code) {
  return { ok: false, error: buildConcurQuickExpenseError(code) };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * @param {object} input
 * @param {string} input.geolocation OAuth token応答のgeolocation値（Quick Expense APIのベースURL）。
 * @param {string} input.accessToken 取得済みのAccess Token。
 * @param {string} input.userId 呼び出し元が解決済みのConcur userID（このモジュールは取得・推測を行わない。必須）。
 * @param {string} [input.contextType] 省略時は既定値"TRAVELER"（validateConcurQuickExpenseRequest.js参照）。
 * @param {string} input.expenseTypeId
 * @param {string} input.transactionDate "YYYY-MM-DD"形式。
 * @param {number} input.amount
 * @param {string} input.currencyCode 3文字のISO 4217コード（大文字）。
 * @param {string|null} [input.vendorName]
 * @param {string|null} [input.memo]
 * @param {string|null} [input.entryDetails]
 * @param {string|null} [input.paymentTypeId]
 * @param {object|null} [input.location]
 * @param {typeof fetch} [input.fetchImpl] テスト用の差し替え。既定はグローバルfetch。
 * @param {number} [input.timeoutMs] fetchのタイムアウト（ミリ秒）。
 * @returns {Promise<
 *   | { ok: true, quickExpenseIdUri: string }
 *   | { ok: false, error: { code: string, message: string } }
 * >}
 */
export async function createConcurQuickExpense({ geolocation, accessToken, fetchImpl, timeoutMs, ...quickExpenseInput }) {
  const inputValidation = validateConcurQuickExpenseRequest(quickExpenseInput);
  if (!inputValidation.ok) {
    return failure("concur_quick_expense_invalid_request");
  }
  const { userId, contextType, quickExpenseBody } = inputValidation;

  if (!isNonEmptyString(geolocation)) {
    return failure("concur_quick_expense_geolocation_missing");
  }

  const request = buildConcurQuickExpenseRequest({ geolocation, accessToken, userId, contextType, quickExpenseBody });

  const fetchResult = await fetchConcurQuickExpenseResponse({
    request,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  });

  if (fetchResult.outcome === "timeout") {
    return failure("concur_quick_expense_timeout");
  }

  if (fetchResult.outcome === "network_error") {
    return failure("concur_quick_expense_network_error");
  }

  const httpErrorCode = classifyConcurQuickExpenseHttpStatus(fetchResult.response.status);
  if (httpErrorCode) {
    return failure(httpErrorCode);
  }

  let rawBody;
  try {
    rawBody = await fetchResult.response.json();
  } catch {
    // レスポンス本文がJSONとして解析できない場合。生の本文はログへ出さない。
    return failure("concur_quick_expense_invalid_response");
  }

  const validation = validateConcurQuickExpenseResponse(rawBody);
  if (!validation.ok) {
    return failure(validation.code);
  }

  return { ok: true, quickExpenseIdUri: validation.quickExpenseIdUri };
}
