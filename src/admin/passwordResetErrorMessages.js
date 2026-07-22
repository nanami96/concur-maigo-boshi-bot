// パスワード再設定フロー専用のSupabase Authエラー翻訳。
// 対象範囲：resetPasswordForEmail()（再設定メール送信）・パスワード再設定リンクの
// 交換（exchangeAuthCallback→exchangeCodeForSession/setSession）・
// updateUser({ password })（新しいパスワードの確定）。
//
// authErrorMessages.js（ログイン・Magic Link専用）とは対象とするAPI呼び出しが
// 異なるため、判定ロジックをあえて別モジュールに分離している
// （membershipErrorMessages.jsが自社ユーザー管理専用の翻訳を持つのと同じ方針）。
//
// セキュリティ上の重要な前提：resetPasswordForEmail()は、指定したメールアドレスが
// 実際に登録されているかどうかに関わらず同じ成功レスポンスを返す
// （Supabase Auth標準の仕様。第三者がメールアドレスの登録有無を推測できないための
// 設計）。そのため呼び出し側（LoginScreen.jsx）は、エラーが無い限り常に同一の
// 成功メッセージを表示し、「このメールアドレスは登録されていません」等、
// アカウントの存在有無を示唆するメッセージは一切表示しない。

function isRateLimited(error) {
  const message = String(error.message || error.name || "").toLowerCase();
  return error.status === 429 || message.includes("rate limit");
}

function isNetworkError(error) {
  const message = String(error.message || error.name || "").toLowerCase();
  return (
    error.name === "AuthRetryableFetchError" ||
    message.includes("failed to fetch") ||
    message.includes("network")
  );
}

// resetPasswordForEmail()自体の呼び出しが失敗した場合（メールアドレスが存在しない
// ことによる失敗ではない。上記の通りその場合はerror無しで成功扱いになる）。
export function translateResetRequestError(error) {
  if (!error) {
    return null;
  }

  if (isRateLimited(error)) {
    return "メールの送信回数が上限に達しています。しばらく時間をおいてから再度お試しください。";
  }

  if (isNetworkError(error)) {
    return "ネットワークエラーが発生しました。通信状態を確認してから再度お試しください。";
  }

  return "パスワード再設定メールの送信に失敗しました。しばらくしてから再度お試しください。";
}

// パスワード再設定リンクのcode交換（exchangeAuthCallback）が失敗した場合。
// 期限切れ・既に使用済み・改ざん等、リンク自体が無効なケースをまとめて
// 「リンクが無効／期限切れ」という1つの分かりやすいメッセージにする
// （Supabase側の詳細なエラー文言はconsole.errorにのみ残し、ユーザーには見せない）。
export function translateRecoveryCallbackError(error) {
  if (!error) {
    return null;
  }

  if (isNetworkError(error)) {
    return "ネットワークエラーが発生しました。通信状態を確認してから再度お試しください。";
  }

  return "パスワード再設定リンクの有効期限が切れているか、無効です。もう一度パスワード再設定をお試しください。";
}

// updateUser({ password })が失敗した場合。
export function translateUpdatePasswordError(error) {
  if (!error) {
    return null;
  }

  const message = String(error.message || error.name || "").toLowerCase();

  if (isNetworkError(error)) {
    return "ネットワークエラーが発生しました。通信状態を確認してから再度お試しください。";
  }

  if (
    message.includes("password") &&
    (message.includes("character") ||
      message.includes("short") ||
      message.includes("weak") ||
      message.includes("least"))
  ) {
    return "パスワードの要件を満たしていません（文字数が不足している可能性があります）。別のパスワードをお試しください。";
  }

  if (message.includes("session") || message.includes("jwt") || message.includes("token")) {
    return "パスワード再設定の有効期限が切れています。もう一度パスワード再設定をお試しください。";
  }

  return "パスワードの変更に失敗しました。しばらくしてから再度お試しください。";
}
