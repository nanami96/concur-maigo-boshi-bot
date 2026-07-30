// 迷子防止Bot内部の共通経費データ（src/lib/concurExpenseData.js・
// supabase/functions/create-concur-quick-expense/validateQuickExpenseRequest.js
// が扱う中間データと同じフィールド名）を、SAP Concur Quick Expense v4 API
// （POST /quickexpense/v4/users/{userID}/context/{contextType}/quickexpenses）
// の正式なRequest Body形式へ変換する純粋関数。Deno固有のAPIには一切依存
// しないため、Node/vitestから直接importしてテストできる。
//
// 【重要・このモジュールの位置づけ】
// userIdは呼び出し元が解決済みの値をそのまま受け取るだけで、Identity API
// 呼び出し・userId解決処理との接続は一切行わない（未取得・null・推測・
// 固定値は許容せず、必須の外部入力として扱う）。
//
// 【根拠（公式ドキュメントのみ）】
// SAP-docs/preview.developer.concur.com
// api-reference/expense/quick-expense/v4.quick-expense.md：
//   - userID（パスパラメータ）："**Required** The unique identifier of the
//     SAP Concur user. Use Identity v4.0 to retrieve the userID."
//     （型はstringとだけ記載され、UUID形式である旨はQuick Expense自身の
//     ドキュメントには明記されていないため、ここでは非空文字列であることだけ
//     を検証する）。
//   - contextType（パスパラメータ）："**Required** ... Supported value:
//     TRAVELER."（ドキュメント上、確認できた値は"TRAVELER"のみ）。
//   - Request Body（"Quick Expense Request"スキーマ）：
//       expenseTypeId  string  Required
//       transactionDate string YYYY-MM-DD  Required
//       transactionAmount (Amount) Required
//         currencyCode string（3-letter ISO 4217） Required
//         value number Required
//       vendor string  Optional
//       comment string Optional
//       entryDetails string Optional
//       paymentTypeId string（Supported values: CASHX, CPAID, PENDC） Optional
//       location (Location) Optional
//         city / countryCode / countrySubDivisionCode / id / name（すべてstring・Optional）
//   公式仕様に存在しないフィールド（Bot内部専用のcompanyId・policyId・
//   receiptRequired・receiptFile等）はこの変換結果に一切含めない。
//
// 【フィールド名のマッピングについて】
// userId/contextType以外の入力フィールド名は、既存の
// create-concur-quick-expense/validateQuickExpenseRequest.jsが既に採用している
// Bot内部の名前（amount・currencyCode・transactionDate・expenseTypeId・
// vendorName・memo）をそのまま踏襲する（Bot独自の別名を新設しない）。
// vendorName→vendor、memo→commentへのマッピングは、公式スキーマに
// 「vendorName」「memo」というフィールドが存在しないための対応付けであり、
// 値の意味自体は変えていない。entryDetails・paymentTypeId・locationは
// 現時点でBot側にまだ収集する仕組みが無いため、いずれも任意項目として
// 追加で受け付ける（無くてもvalidationを通す）。

const DEFAULT_CONTEXT_TYPE = "TRAVELER";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
const PAYMENT_TYPE_IDS = ["CASHX", "CPAID", "PENDC"];
const LOCATION_STRING_FIELDS = ["city", "countryCode", "countrySubDivisionCode", "id", "name"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isOptionalString(value) {
  return value === undefined || value === null || typeof value === "string";
}

// "YYYY-MM-DD" 形式であること、かつ実在するカレンダー上の日付であることの
// 両方を確認する（create-concur-quick-expense/validateQuickExpenseRequest.js
// のisValidCalendarDate()と同じ考え方）。
function isValidCalendarDate(value) {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function buildLocation(rawLocation) {
  if (rawLocation === undefined || rawLocation === null) {
    return { ok: true, location: undefined };
  }
  if (typeof rawLocation !== "object" || Array.isArray(rawLocation)) {
    return { ok: false };
  }
  for (const field of LOCATION_STRING_FIELDS) {
    if (!isOptionalString(rawLocation[field])) {
      return { ok: false };
    }
  }

  const location = {};
  for (const field of LOCATION_STRING_FIELDS) {
    if (isNonEmptyString(rawLocation[field])) {
      location[field] = rawLocation[field];
    }
  }
  return { ok: true, location: Object.keys(location).length > 0 ? location : undefined };
}

/**
 * @param {object} input
 * @param {string} input.userId 呼び出し元が解決済みのConcur userID（このモジュールは取得・推測を行わない）。
 * @param {string} [input.contextType] 省略時は既定値"TRAVELER"（公式ドキュメント上、現時点で唯一の値）。
 * @param {string} input.expenseTypeId
 * @param {string} input.transactionDate "YYYY-MM-DD"形式。
 * @param {number} input.amount
 * @param {string} input.currencyCode 3文字のISO 4217コード（大文字）。
 * @param {string|null} [input.vendorName]
 * @param {string|null} [input.memo]
 * @param {string|null} [input.entryDetails]
 * @param {string|null} [input.paymentTypeId] "CASHX" | "CPAID" | "PENDC"
 * @param {object|null} [input.location]
 * @returns {{
 *   ok: true,
 *   userId: string,
 *   contextType: string,
 *   quickExpenseBody: object,
 * } | { ok: false }}
 */
export function validateConcurQuickExpenseRequest(input) {
  const data = input && typeof input === "object" && !Array.isArray(input) ? input : {};

  if (!isNonEmptyString(data.userId)) {
    return { ok: false };
  }
  const userId = data.userId.trim();

  const contextType = data.contextType === undefined || data.contextType === null ? DEFAULT_CONTEXT_TYPE : data.contextType;
  if (contextType !== DEFAULT_CONTEXT_TYPE) {
    return { ok: false };
  }

  if (!isNonEmptyString(data.expenseTypeId)) {
    return { ok: false };
  }

  if (typeof data.transactionDate !== "string" || !isValidCalendarDate(data.transactionDate)) {
    return { ok: false };
  }

  if (typeof data.amount !== "number" || !Number.isFinite(data.amount) || data.amount <= 0) {
    return { ok: false };
  }

  if (typeof data.currencyCode !== "string" || !CURRENCY_CODE_PATTERN.test(data.currencyCode)) {
    return { ok: false };
  }

  if (!isOptionalString(data.vendorName) || !isOptionalString(data.memo) || !isOptionalString(data.entryDetails)) {
    return { ok: false };
  }

  if (data.paymentTypeId !== undefined && data.paymentTypeId !== null && !PAYMENT_TYPE_IDS.includes(data.paymentTypeId)) {
    return { ok: false };
  }

  const locationResult = buildLocation(data.location);
  if (!locationResult.ok) {
    return { ok: false };
  }

  const quickExpenseBody = {
    expenseTypeId: data.expenseTypeId.trim(),
    transactionDate: data.transactionDate,
    transactionAmount: {
      currencyCode: data.currencyCode,
      value: data.amount,
    },
    ...(isNonEmptyString(data.vendorName) ? { vendor: data.vendorName } : {}),
    ...(isNonEmptyString(data.memo) ? { comment: data.memo } : {}),
    ...(isNonEmptyString(data.entryDetails) ? { entryDetails: data.entryDetails } : {}),
    ...(data.paymentTypeId ? { paymentTypeId: data.paymentTypeId } : {}),
    ...(locationResult.location ? { location: locationResult.location } : {}),
  };

  return { ok: true, userId, contextType, quickExpenseBody };
}
