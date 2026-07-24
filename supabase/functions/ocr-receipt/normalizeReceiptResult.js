// Azure AI Document Intelligence（prebuilt-receipt、api-version=2024-11-30）が
// 返す生の analyzeResult から、フロントに返してよい最小限のフィールドだけを
// 抽出・正規化する。
//
// 重要（経費タイプ判定への不使用の徹底）：
// Azureのprebuilt-receiptは ReceiptType（例: "Transportation.Taxi"）という
// カテゴリ分類も返すが、この関数は意図的に一切参照・返却しない。
// 経費タイプの判定は既存のConcur迷子防止Botの質問フロー・判定ルール
// （src/engine/QuestionEngine.js）だけで行うものであり、OCRの役割は
// 「領収書に記載された客観的な情報の読み取り」に限定する。この関数が
// ReceiptTypeを扱わないことが、フロント側の経費タイプ判定ロジックへ
// OCR由来の分類が混入しないことの一次的な保証になっている。
//
// Deno固有のAPI（Deno.serve/Deno.env/fetch等）には一切依存しない純粋関数のため、
// index.ts（Edge Function本体）だけでなく、Node/vitestからも直接importして
// テストできる。
export function normalizeReceiptAnalyzeResult(analyzeResult) {
  const document = analyzeResult?.documents?.[0];
  const fields = document?.fields ?? {};

  const merchantField = fields.MerchantName;
  const dateField = fields.TransactionDate;
  const totalField = fields.Total;

  const merchantName = extractString(merchantField);
  const transactionDate = typeof dateField?.valueDate === "string" ? dateField.valueDate : null;
  const totalAmount = extractAmount(totalField);
  const currencyCode =
    typeof totalField?.valueCurrency?.currencyCode === "string"
      ? totalField.valueCurrency.currencyCode
      : null;

  return {
    transactionDate,
    merchantName,
    totalAmount,
    currencyCode,
    confidence: {
      transactionDate: extractConfidence(dateField),
      merchantName: extractConfidence(merchantField),
      totalAmount: extractConfidence(totalField),
    },
  };
}

function extractString(field) {
  if (typeof field?.valueString === "string") {
    return field.valueString;
  }
  // valueStringが無い場合の保険（実運用のAzureレスポンスでは基本的に
  // valueStringが埋まるが、モデルの挙動差に備えて生テキストにも フォールバックする）。
  if (typeof field?.content === "string") {
    return field.content;
  }
  return null;
}

function extractAmount(field) {
  if (typeof field?.valueCurrency?.amount === "number") {
    return field.valueCurrency.amount;
  }
  // Total が currency 型ではなく number 型で返るケースへの保険。
  if (typeof field?.valueNumber === "number") {
    return field.valueNumber;
  }
  return null;
}

function extractConfidence(field) {
  return typeof field?.confidence === "number" ? field.confidence : null;
}
