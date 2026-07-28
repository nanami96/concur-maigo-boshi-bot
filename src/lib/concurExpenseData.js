// SAP Concur「Quick Expense」連携（設計段階、src/data/concurApi.js参照）へ
// 渡す前段階の、迷子防止Bot内部での共通経費データの生成・バリデーション。
//
// このファイルはConcur側の実際のAPIリクエスト形式を一切知らない・作り込まない。
// Concurの正式なリクエストフィールドはまだ確定していないため（concurApi.jsの
// コメント参照）、ここで生成する共通経費データはあくまで「迷子防止Bot内部の
// 中間データ」であり、Concur APIのフィールド名・形式にそのまま対応するとは
// 限らない。将来Concur側の仕様が確定した時点で、この中間データからConcurの
// 実際のリクエストボディへ変換する層を別途追加する想定（このファイルの
// 変更・拡張、または新しいファイルとして）。
//
// 通信・認証情報は一切扱わない（DenoやSupabaseクライアントへの依存も無い）
// 純粋関数のみで構成する。そのためNode/vitestから直接importしてテストできる
// （supabase/functions/ocr-receipt/normalizeReceiptResult.jsと同じ方針）。

// expenseTypeIdは、Concur側の経費タイプコードではなく、迷子防止Bot自身の
// 設定（config.expenseTypes[].id、src/engine/QuestionEngine.jsのgetResult()が
// 返すexpenseType.id）をそのまま指す。Concur側のコードへのマッピングは
// Concur APIの仕様確定後の別の関心事とする。

/**
 * OCR結果（src/data/ocrReceiptRepository.js analyzeReceiptImageの結果、
 * または supabase/functions/ocr-receipt/normalizeReceiptResult.js の戻り値と
 * 同じ形：{ transactionDate, merchantName, totalAmount, currencyCode, confidence }）と、
 * 迷子防止Botの判定結果（src/engine/QuestionEngine.jsのgetResult()が返す
 * { rule, expenseType } の形。expenseType.id/receiptRequiredを使う）から、
 * Concur連携前の共通経費データを組み立てる。
 *
 * 値の変換・欠落フィールドの補完のみを行う純粋関数で、妥当性チェック（必須
 * 項目が揃っているか等）は行わない（バリデーションはvalidateConcurExpenseData
 * 側の責務として分離する）。
 *
 * ocrResult・judgmentResultはいずれも省略・nullを許容する（例：OCRをまだ
 * 実行していない、判定結果がまだ複数候補で1つに絞られていない等）。その場合、
 * 対応するフィールドはnullになる。
 *
 * @param {object} [input]
 * @param {{ transactionDate?: string|null, totalAmount?: number|null, currencyCode?: string|null, merchantName?: string|null }|null} [input.ocrResult]
 * @param {{ expenseType?: { id?: string, receiptRequired?: boolean|null } }|null} [input.judgmentResult]
 * @param {File|null} [input.receiptFile] 領収書として選択中の画像ファイル（未選択ならnull）。
 * @returns {{
 *   transactionDate: string|null,
 *   amount: number|null,
 *   currencyCode: string|null,
 *   vendorName: string|null,
 *   expenseTypeId: string|null,
 *   receiptRequired: boolean|null,
 *   receiptFile: File|null,
 * }}
 */
export function buildConcurExpenseData({ ocrResult, judgmentResult, receiptFile } = {}) {
  const expenseType = judgmentResult?.expenseType;

  return {
    transactionDate: ocrResult?.transactionDate ?? null,
    amount: ocrResult?.totalAmount ?? null,
    currencyCode: ocrResult?.currencyCode ?? null,
    vendorName: ocrResult?.merchantName ?? null,
    expenseTypeId: expenseType?.id ?? null,
    receiptRequired: expenseType?.receiptRequired ?? null,
    receiptFile: receiptFile ?? null,
  };
}

// amountの妥当性チェックだけを切り出す（「なし」「0以下」「数値ではない」の
// 3ケースをまとめて1種類のエラー種別 "invalid_amount" として扱うが、
// メッセージだけはケースごとに変える）。
//
// 数値文字列（例："1000"）は意図的に許容しない（型を厳密にnumberへ限定する）。
// buildConcurExpenseData()が渡すamountはOCR結果由来（normalizeReceiptResult.js
// のtotalAmountは常にnumberかnull）であり、number以外の値が来る状況は
// 想定外の呼び出し方をされた場合に限られるため、暗黙の型変換はせず
// 「数値ではない」エラーとして明示的に弾く。
function validateAmount(amount) {
  if (amount === null || amount === undefined) {
    return { type: "invalid_amount", message: "金額が入力されていません。" };
  }
  if (typeof amount !== "number" || Number.isNaN(amount)) {
    return { type: "invalid_amount", message: "金額が数値ではありません。" };
  }
  if (amount <= 0) {
    return { type: "invalid_amount", message: "金額は0より大きい値を入力してください。" };
  }
  return null;
}

/**
 * Concurへの送信前バリデーション。buildConcurExpenseData()が返す形の
 * 共通経費データを受け取り、エラーが1件も無ければ { result: expenseData, error: null }、
 * エラーがあれば最初に見つかった1件を { result: null, error: { type, message } } で返す
 * （既存のsrc/data/ocrReceiptRepository.js・src/data/concurApi.jsと同じ
 * { result, error } の形に統一）。
 *
 * チェック順序（同時に複数の問題がある場合、この順で最初の1件だけを返す）：
 *   1. 利用日なし (missing_transaction_date)
 *   2. 金額なし・0以下・数値ではない (invalid_amount)
 *   3. 通貨コードなし (missing_currency_code)
 *   4. 経費タイプ未判定 (missing_expense_type)
 *   5. 領収書必須だが画像なし (receipt_required_but_missing)
 *
 * receiptRequiredがnull/undefined（未設定）の場合は、まだ「必須」と確定して
 * いないためエラーにしない（receiptRequiredが明示的にtrueのときだけ
 * receiptFileの有無を見る）。
 *
 * @param {ReturnType<typeof buildConcurExpenseData>} expenseData
 * @returns {{ result: object|null, error: { type: string, message: string }|null }}
 */
export function validateConcurExpenseData(expenseData) {
  const data = expenseData ?? {};

  if (!data.transactionDate) {
    return {
      result: null,
      error: { type: "missing_transaction_date", message: "利用日が入力されていません。" },
    };
  }

  const amountError = validateAmount(data.amount);
  if (amountError) {
    return { result: null, error: amountError };
  }

  if (!data.currencyCode) {
    return {
      result: null,
      error: { type: "missing_currency_code", message: "通貨コードが入力されていません。" },
    };
  }

  if (!data.expenseTypeId) {
    return {
      result: null,
      error: { type: "missing_expense_type", message: "経費タイプが判定されていません。" },
    };
  }

  if (data.receiptRequired === true && !data.receiptFile) {
    return {
      result: null,
      error: {
        type: "receipt_required_but_missing",
        message: "領収書が必須ですが、画像が添付されていません。",
      },
    };
  }

  return { result: data, error: null };
}
