// Supabase Auth（@supabase/supabase-js）が返すエラーは英語の技術的な文言のため、
// そのまま利用者へ見せず、ここで日本語の定型メッセージへ変換する。
// Reactやsupabaseクライアントに依存しない純粋関数にしてあるので、
// 実際のSupabaseを呼ばずにVitestで様々なエラー形状を検証できる。
//
// 判定の優先順位（上から順にチェックする）：
//   1. レート制限（メール送信・ログイン試行とも429で返ってくることが多い）
//   2. メールアドレス／パスワードの組み合わせが正しくない
//      （Supabaseは「メールが存在しない」「パスワード未設定」「パスワード誤り」を
//      すべて同じ "Invalid login credentials" として返す。これはユーザー存在を
//      推測されないための意図的な仕様であり、フロント側で区別することはできない）
//   3. メール未確認
//   4. ネットワークエラー（fetch自体が失敗した場合。supabase-jsは
//      AuthRetryableFetchError として返すか、状況により例外を投げる）
//   5. その他（不明なエラー）
export function translateAuthError(error) {
  if (!error) {
    return null;
  }

  const status = error.status;
  const message = String(error.message || error.name || "");
  const lower = message.toLowerCase();

  if (status === 429 || lower.includes("rate limit")) {
    return "メールの送信回数が上限に達しています。しばらく時間をおくか、パスワードでログインしてください。";
  }

  if (lower.includes("invalid login credentials")) {
    return "メールアドレスまたはパスワードが違います。";
  }

  if (lower.includes("email not confirmed")) {
    return "メールアドレスの確認が完了していません。届いている確認メールをご確認ください。";
  }

  if (
    error.name === "AuthRetryableFetchError" ||
    lower.includes("failed to fetch") ||
    lower.includes("network")
  ) {
    return "ネットワークエラーが発生しました。通信状態を確認してから再度お試しください。";
  }

  return "ログインに失敗しました。しばらくしてから再度お試しください。";
}

// セッション切れ（保存されていたリフレッシュトークンが無効になった等）の場合に
// AuthGate側から使う共通メッセージ。
export const SESSION_EXPIRED_MESSAGE =
  "ログインの有効期限が切れました。お手数ですが、もう一度ログインしてください。";
