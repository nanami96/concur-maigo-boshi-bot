import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

// 領収書読み取りPoC専用のRepository。supabase.functions.invoke()経由で
// Supabase Edge Function（supabase/functions/ocr-receipt）を呼び出す。
//
// Azure Document IntelligenceのAPIキーはこのファイル・フロントのどこにも
// 一切登場しない（Edge Function側のSecretとしてのみ存在する。詳細は
// supabase/functions/ocr-receipt/index.ts冒頭のコメント参照）。
//
// supabase.functions.invoke()は、現在ログイン中セッションのアクセストークンを
// 自動的にAuthorizationヘッダーへ付与する（membershipRepository.jsの各RPC
// 呼び出しと同じ、既存のsupabaseクライアント経由の認証方式）。呼び出し側
// （ReceiptOcrPanel.jsx）が明示的にトークンを扱う必要は無い。
export async function classifyOcrFunctionError(error) {
  if (!error) {
    return { type: null, message: null };
  }

  if (error instanceof FunctionsFetchError) {
    return { type: "network", message: null };
  }

  if (error instanceof FunctionsRelayError) {
    return { type: "unknown", message: null };
  }

  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error?.code) {
        return { type: body.error.code, message: body.error.message || null };
      }
    } catch {
      // Edge Functionが想定外の形（JSON以外）を返した場合はunknownへ落とす。
    }
    return { type: "unknown", message: null };
  }

  return { type: "unknown", message: null };
}

// 領収書画像（File）をEdge Functionへ送り、正規化済みのOCR結果を受け取る。
// 戻り値のresultは { transactionDate, merchantName, totalAmount, currencyCode,
// confidence: { transactionDate, merchantName, totalAmount } } の形
// （supabase/functions/ocr-receipt/normalizeReceiptResult.js参照）。
// ReceiptType（経費タイプの手がかりになりうる分類）はこの戻り値に一切含まれない。
export async function analyzeReceiptImage(file) {
  if (!isSupabaseConfigured) {
    return { result: null, error: { type: "unknown", message: "Supabaseが設定されていません。" } };
  }

  const formData = new FormData();
  formData.append("file", file);

  try {
    const { data, error } = await supabase.functions.invoke("ocr-receipt", {
      body: formData,
    });

    if (error) {
      const classified = await classifyOcrFunctionError(error);
      return {
        result: null,
        error: { type: classified.type, message: classified.message },
      };
    }

    return { result: data, error: null };
  } catch (caughtError) {
    return { result: null, error: { type: "network", message: caughtError.message } };
  }
}
