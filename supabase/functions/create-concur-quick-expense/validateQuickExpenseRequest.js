// create-concur-quick-expense（Edge Function本体はindex.ts）の入力検証だけを
// 切り離した純粋関数。Deno固有のAPIには一切依存しないため、
// supabase/functions/ocr-receipt/normalizeReceiptResult.jsと同じ方針で
// Node/vitestから直接importしてテストできる。
//
// このリクエストの項目は、src/lib/concurExpenseData.js（共通経費データ）が
// 生成する値を組み合わせたものを想定しているが、フィールド名はそれぞれの
// 既存実装に合わせて決めている：
//   - transactionDate / amount / receiptRequired
//       … src/lib/concurExpenseData.js とまったく同じ名前。
//   - currencyCode
//       … src/lib/concurExpenseData.js に合わせた名前
//         （このEdge Function向けの当初案では "currency" だったが、
//         既存実装のフィールド名を優先して改名した）。
//   - expenseTypeId
//       … 経費タイプID＝Concur EXP_KEYという設計（正式リファクタリング）
//         により、src/lib/concurExpenseData.jsのbuildConcurExpenseData()が
//         生成するexpenseTypeIdをそのまま使う。以前あった、Bot内部の
//         意味的IDとConcur側識別子を別々に送るbotExpenseTypeId /
//         concurExpenseTypeIdという2フィールド構成は廃止した。
//   - vendorName
//       … src/lib/concurExpenseData.js に存在するが、送信必須の項目とまでは
//         言えない（OCRが読み取れなかった場合はnullになりうる値のため）。
//         このリクエストでは任意項目として扱う。
//   - memo
//       … concurExpenseData.jsには存在しない、利用者が自由入力する想定の
//         任意項目。
//
// 後方互換（旧request body）について：
//   デプロイ順序（Edge Functionを新旧両方のrequest bodyを受けられる状態に
//   してから先にdeployし、そのあとフロントを新方式へ切り替える）を安全にする
//   ため、フロントがまだ旧フィールド名botExpenseTypeIdで送ってくる場合も
//   受け付ける。expenseTypeIdが無ければbotExpenseTypeIdの値をそのまま
//   expenseTypeIdとして扱う（新方式では両者が同じ値に収束するため、
//   フィールド名が違うだけで値の意味は変わらない）。旧フィールド
//   concurExpenseTypeIdは受け取っても無視する（もう検証・利用しない）。
//   フロントの切り替えが完了したら、この後方互換コード（resolveExpenseTypeId
//   のbotExpenseTypeIdフォールバック部分）は削除してよい。
//
// receiptFile・領収書画像は意図的にこのリクエストに含めない
// （Base64化した画像や大きなデータを載せない、レシート添付は別責務という
// 今回の前提のため）。
//
// concurLoginId（Phase 13で削除）について：
//   以前はクライアントがConcurログインIDを毎回この本文へ含めて送っていたが、
//   Phase 13（concur_user_links・link-concur-user Edge Function）により、
//   Identity APIで実在確認済みのConcurログインIDをuser_id×company_id単位で
//   サーバー側に保存できるようになったため、このリクエストからは
//   concurLoginIdフィールドを完全に削除した。handleQuickExpenseRequest.jsは
//   代わりにgetConcurUserLink({ userId, companyId })（service_role専用RPC
//   get_concur_user_link_for_edge）で保存済みの値を取得する。クライアントが
//   concurLoginId（またはそれに類する値）をこの本文に含めて送ってきても、
//   このバリデータは一切読み取らない・使わない（余分なフィールドとして
//   無視されるだけで、エラーにもならない）。
//
// バリデーション方針：
//   src/lib/concurExpenseData.jsのvalidateConcurExpenseData()は「最初に
//   見つかった1件のエラーだけを返す」設計だが、このEdge Functionのエラー
//   形式はdetails配列を持つ（{ code: "validation_error", message, details }）。
//   detailsが配列であることを活かし、こちらは見つかった問題をすべて集めて
//   一度に返す（フォームの複数項目を一度に直せるようにするため）。
const REQUIRED_STRING_FIELDS = ["companyId", "policyId"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

function isBlankString(value) {
  return typeof value !== "string" || value.trim() === "";
}

// "YYYY-MM-DD" 形式であること、かつ実在するカレンダー上の日付であること
// （例："2026-13-40" のような形式は合っていても存在しない日付）の両方を
// 確認する。外部ライブラリを使わず、Dateへ変換してISO文字列を往復させる
// ことで判定する。
function isValidCalendarDate(value) {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// expenseTypeId（新方式）が無ければbotExpenseTypeId（旧方式）へフォールバック
// する（ファイル冒頭コメント「後方互換」参照）。
function resolveExpenseTypeId(data) {
  if (!isBlankString(data.expenseTypeId)) {
    return data.expenseTypeId;
  }
  if (!isBlankString(data.botExpenseTypeId)) {
    return data.botExpenseTypeId;
  }
  return null;
}

/**
 * リクエストボディ（JSON.parse済みの値）を検証し、問題が無ければ
 * 認識しているフィールドだけへ正規化したオブジェクトを返す。
 *
 * @param {unknown} body
 * @returns {{
 *   result: {
 *     companyId: string,
 *     policyId: string,
 *     expenseTypeId: string,
 *     transactionDate: string,
 *     amount: number,
 *     currencyCode: string,
 *     receiptRequired: boolean,
 *     vendorName: string|null,
 *     memo: string|null,
 *   } | null,
 *   error: { code: "validation_error", message: string, details: Array<{ field: string, reason: string }> } | null,
 * }}
 */
export function validateQuickExpenseRequest(body) {
  const data = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const details = [];

  for (const field of REQUIRED_STRING_FIELDS) {
    if (isBlankString(data[field])) {
      details.push({ field, reason: "required" });
    }
  }

  const expenseTypeId = resolveExpenseTypeId(data);
  if (isBlankString(expenseTypeId)) {
    details.push({ field: "expenseTypeId", reason: "required" });
  }

  if (isBlankString(data.transactionDate)) {
    details.push({ field: "transactionDate", reason: "required" });
  } else if (!isValidCalendarDate(data.transactionDate)) {
    details.push({ field: "transactionDate", reason: "invalid_format" });
  }

  if (data.amount === null || data.amount === undefined) {
    details.push({ field: "amount", reason: "required" });
  } else if (typeof data.amount !== "number" || Number.isNaN(data.amount)) {
    details.push({ field: "amount", reason: "invalid_type" });
  } else if (data.amount <= 0) {
    details.push({ field: "amount", reason: "invalid_range" });
  }

  if (isBlankString(data.currencyCode)) {
    details.push({ field: "currencyCode", reason: "required" });
  } else if (!CURRENCY_CODE_PATTERN.test(data.currencyCode)) {
    details.push({ field: "currencyCode", reason: "invalid_format" });
  }

  if (typeof data.receiptRequired !== "boolean") {
    details.push({ field: "receiptRequired", reason: "required" });
  }

  if (data.vendorName !== undefined && data.vendorName !== null && typeof data.vendorName !== "string") {
    details.push({ field: "vendorName", reason: "invalid_type" });
  }

  if (data.memo !== undefined && data.memo !== null && typeof data.memo !== "string") {
    details.push({ field: "memo", reason: "invalid_type" });
  }

  if (details.length > 0) {
    return {
      result: null,
      error: { code: "validation_error", message: "入力内容を確認してください。", details },
    };
  }

  return {
    result: {
      companyId: data.companyId,
      policyId: data.policyId,
      expenseTypeId,
      transactionDate: data.transactionDate,
      amount: data.amount,
      currencyCode: data.currencyCode,
      receiptRequired: data.receiptRequired,
      vendorName: typeof data.vendorName === "string" ? data.vendorName : null,
      memo: typeof data.memo === "string" ? data.memo : null,
    },
    error: null,
  };
}
