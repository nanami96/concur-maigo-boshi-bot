// src/data/concurApi.js（createQuickExpense呼び出し）が返すerror.typeを、
// 利用者向けの固定日本語メッセージへ変換する。
//
// src/receiptOcrErrorMessages.jsのresolveOcrErrorMessage()とは異なり、
// error.messageは一切使わない（画面には表示しない）。理由：
//   - createQuickExpense()の一部の失敗経路（例：supabase.functions.invoke()
//     自体が例外を投げた場合）は、Supabaseクライアントの生の例外メッセージを
//     そのままerror.messageに積む実装になっており（src/data/concurApi.js
//     createQuickExpense()のcatch節参照）、内部的な詳細を含みうる。
//   - Edge Function自身が返すメッセージ（例：handleQuickExpenseRequest.jsの
//     FORBIDDEN_MESSAGE等）は元々安全な文言だが、経路によって安全性の前提が
//     異なる値を同じフィールドで受け取る設計にはせず、常にこのファイルの
//     固定メッセージだけを表示することで、Secrets・トークン・レスポンス
//     本文・config_snapshot・mapping内容が画面に出ることを構造的に防ぐ。
//
// error.typeとして実際に流れうる値（src/data/concurApi.jsのcreateQuickExpense・
// classifyQuickExpenseFunctionError、supabase/functions/create-concur-quick-expense/
// handleQuickExpenseRequest.jsのエラーコード一覧を参照）を、要件で指定された
// 8種のユーザー向けカテゴリへ分類する。
//   - mapping_not_found・multiple_mappings_found（Commit H）は、フロントから
//     送った内容が所属会社の正規のConcur Expense Type Mappingと一致しな
//     かったことを示すが、利用者からは「forbidden」と区別する意味が無い
//     （どちらも同じFORBIDDEN_MESSAGEを土台にしたサーバー側判断であり、
//     利用者が取れる対処も同じ「サポート・管理者に問い合わせる」であるため）。
//   - invalid_json・internal_error・method_not_allowed は、利用者の入力に
//     起因しない、このEdge Function自身の想定外の失敗として function_error に
//     まとめる。
//   - auth_error は現時点のcreateQuickExpense()からは発生しないが、将来
//     Concur側のOAuth・アクセストークン関連のエラー（getAccessToken()等）を
//     このコンポーネントで扱うようになった際の受け皿として、要件通りの
//     カテゴリ名で先に用意しておく。
//   - user_not_found・user_ambiguous（Phase 13で追加）は、linkConcurUser()
//     （src/data/concurUserLinkRepository.js、link-concur-user Edge Function）が
//     返しうるconcur_user_not_found・concur_user_ambiguousを、利用者が
//     入力したConcurログインIDを直接修正できる具体的なメッセージへ変換する
//     （既存のQuick Expense作成時にも同じコードが理論上返りうるが、Phase 13
//     以降は紐付け未完了時にlinkConcurUser()側で先に検知されるため、実際には
//     ほぼこの入口でしか発生しない）。
const ERROR_TYPE_TO_CATEGORY = {
  unauthorized: "unauthorized",
  auth_error: "auth_error",
  forbidden: "forbidden",
  mapping_not_found: "forbidden",
  multiple_mappings_found: "forbidden",
  validation_error: "validation_error",
  invalid_json: "validation_error",
  concur_user_not_found: "user_not_found",
  concur_user_ambiguous: "user_ambiguous",
  timeout: "timeout",
  network: "network_error",
  internal_error: "function_error",
  method_not_allowed: "function_error",
  unknown: "unknown_error",
};

const CATEGORY_MESSAGES = {
  unauthorized: "ログインの有効期限が切れている可能性があります。再度ログインしてください。",
  auth_error: "ログインの有効期限が切れている可能性があります。再度ログインしてください。",
  forbidden: "この操作を行う権限がありません。管理者にお問い合わせください。",
  validation_error: "登録内容に不備があるため、Concurへ登録できませんでした。内容をご確認のうえ、もう一度お試しください。",
  user_not_found: "入力されたConcurログインIDが見つかりませんでした。入力内容をご確認ください。",
  user_ambiguous: "入力されたConcurログインIDに複数の利用者が該当しました。管理者にお問い合わせください。",
  timeout: "Concurへの登録に時間がかかりすぎたため中断しました。もう一度お試しください。",
  network_error: "通信エラーが発生しました。通信状態を確認して再度お試しください。",
  function_error: "処理中にエラーが発生しました。しばらくしてから再度お試しください。",
  unknown_error: "処理中にエラーが発生しました。しばらくしてから再度お試しください。",
};

export function classifyConcurRegistrationErrorCategory(type) {
  return ERROR_TYPE_TO_CATEGORY[type] || "unknown_error";
}

export function resolveConcurRegistrationErrorMessage(error) {
  const category = classifyConcurRegistrationErrorCategory(error?.type);
  return CATEGORY_MESSAGES[category];
}
