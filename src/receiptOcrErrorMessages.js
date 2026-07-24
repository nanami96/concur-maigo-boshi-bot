// ocrReceiptRepository.js（supabase/functions/ocr-receipt呼び出し）が返す
// エラー種別を、利用者向けの日本語メッセージへ変換する。
//
// membershipErrorMessages.js等の既存パターン（種別キー→固定の日本語文言）とは
// 少し異なり、Edge Function（このプロジェクト自身が実装している）が返す
// エラーレスポンスには最初から安全な日本語メッセージが含まれているため
// （supabase/functions/ocr-receipt/index.ts参照。Postgresの生例外文言のような
// 内部情報ではなく、こちらが書いた文言そのもの）、まずそれをそのまま使い、
// サーバーからメッセージが取得できなかった場合（ネットワーク断・想定外の
// レスポンス形式等）だけ、種別キーに応じたこの固定メッセージへフォールバックする。
const OCR_ERROR_MESSAGES = {
  invalid_file: "画像を確認できませんでした。ファイル形式・サイズをご確認ください。",
  unauthorized: "ログインの有効期限が切れている可能性があります。再度ログインしてください。",
  forbidden: "この機能を利用するには、会社への参加（招待コードの入力）が必要です。",
  azure_error: "領収書の解析中にエラーが発生しました。しばらくしてから再度お試しください。",
  analysis_failed: "領収書を読み取れませんでした。画像の向き・明るさを確認し、もう一度お試しください。",
  timeout: "解析に時間がかかりすぎたため中断しました。もう一度お試しください。",
  bad_request: "リクエストの形式が不正です。",
  method_not_allowed: "この操作は現在利用できません。",
  network: "通信エラーが発生しました。通信状態を確認して再度お試しください。",
  unknown: "処理に失敗しました。しばらくしてから再度お試しください。",
};

export function resolveOcrErrorMessage(error) {
  if (!error) {
    return null;
  }
  if (error.message) {
    return error.message;
  }
  return OCR_ERROR_MESSAGES[error.type] || OCR_ERROR_MESSAGES.unknown;
}
