// このアプリは #admin という独自のハッシュルーティングを持っている一方、
// Supabase AuthのMagic Link・メール確認リンクも、完了後にURLへ認証情報を埋め込んで
// 戻ってくる（PKCE flowなら ?code=... というクエリ文字列、implicit flowなら
// #access_token=... というハッシュフラグメント）。
//
// window.location に依存させず、テストしやすいようにプレーンなオブジェクトを受け取る。
export function hasPendingAuthCallback({ search = "", hash = "" } = {}) {
  const hasCode = new URLSearchParams(search).has("code");
  const hasHashToken = /(^|[#&])access_token=/.test(hash);
  return hasCode || hasHashToken;
}

// 認証コールバックが「管理画面(#admin)へのMagic Linkログイン」由来かどうかを判定する。
//
// 一般ユーザーのアカウント作成（確認メール）とadminのMagic Linkログインは、
// どちらも「認証完了後にURLへ ?code=... を付けて戻ってくる」という同じ形になるため、
// hasPendingAuthCallback()だけではこの2つを区別できない
// （以前はこれを区別せず、確認メール経由の一般ユーザーまで誤って管理画面ツリーへ
// ルーティングし、「管理者権限がありません」画面を経由してしまう不具合があった）。
//
// 区別のため、LoginScreen.jsxのMagic Link送信時だけ emailRedirectTo に
// ?authFlow=admin という自前のマーカーを付けて送る（一般ユーザーのsignUp確認メールには
// 付けない）。Supabaseは指定したredirectTo URLへ ?code=... を追記して戻すだけなので、
// 既存のクエリパラメータ（authFlow=admin）はそのまま保持される。
export function isAdminAuthCallback({ search = "" } = {}) {
  return new URLSearchParams(search).get("authFlow") === "admin";
}

// 認証コールバックが「パスワード再設定（resetPasswordForEmail経由）」由来かどうかを
// 判定する。isAdminAuthCallback()と全く同じ考え方：LoginScreen.jsxの
// buildRecoveryRedirectUrlがresetPasswordForEmail()のredirectToへ付与する
// ?authFlow=recovery マーカーの有無だけで判定する。
//
// なぜSupabaseの"type=recovery"パラメータやonAuthStateChangeの"PASSWORD_RECOVERY"
// イベントに頼らないか：このプロジェクトはdetectSessionInUrl:falseにしており、
// 認証コールバックの処理は常にexchangeAuthCallback()（exchangeCodeForSession/
// setSessionの明示呼び出し）で行っている。この明示呼び出しは、リンクの種類
// （signup確認・Magic Link・パスワード再設定のどれか）に関わらず常に"SIGNED_IN"
// イベントを発火する（"PASSWORD_RECOVERY"イベントはsupabase-js内部のURL自動検出
// パス経由でしか発火しないため、detectSessionInUrl:falseの構成では届かない）。
// そのため「これがrecoveryかどうか」はイベント種別ではなく、authFlow=admin方式と
// 全く同じ自前マーカーで判定する。
export function isRecoveryAuthCallback({ search = "" } = {}) {
  return new URLSearchParams(search).get("authFlow") === "recovery";
}

// main.jsxの「#adminツリー（AuthGate+AdminRoot）・パスワード再設定ツリー
// （PasswordRecoveryGate）・一般利用者ツリー（AppAuthGate）のどれを表示すべきか」
// という起動時の振り分け判断を、window.location等のブラウザAPIから切り離した
// 純粋関数として切り出したもの（authGateStatus.jsのresolveAuthGateViewと
// 同じ狙い：ロジックだけをテストしやすくする）。
//
//   ・#adminが既にURLに付いている                         → "admin"
//   ・#adminは無いが、管理画面Magic Linkの認証コールバック  → "admin"
//     （authFlow=adminマーカー付きの?code=...等。ログイン処理完了後、
//     AuthGate.jsxのredirectToAdminAfterSignInが#adminへ書き換える）
//   ・#adminは無いが、パスワード再設定の認証コールバック    → "recovery"
//     （authFlow=recoveryマーカー付きの?code=...等）
//   ・それ以外（#adminも無く、上記マーカーも無い）          → "general"
//     （一般ユーザーのsignUp確認メール由来の?code=...を含む）
export function resolveRootTree({ hash = "", search = "" } = {}) {
  if (hash.startsWith("#admin")) {
    return "admin";
  }

  const location = { hash, search };

  if (!hasPendingAuthCallback(location)) {
    return "general";
  }

  if (isAdminAuthCallback(location)) {
    return "admin";
  }

  if (isRecoveryAuthCallback(location)) {
    return "recovery";
  }

  return "general";
}

// URLに含まれる認証コールバック情報（PKCEの?code=、またはimplicit flowの
// #access_token=/#refresh_token=）を使って、明示的にSupabaseセッションを確立する。
//
// 重要な経緯：以前はsupabase-jsクライアントのdetectSessionInUrl（ページ読み込み時に
// URLを自動スキャンしてセッションを確立する機能）に処理を任せていたが、実Supabase環境
// での一般ユーザー新規登録フローの検証で、確認メールのリンクをクリックしてもセッションが
// 確立されず、「会社へ参加」画面へ差し戻される不具合が見つかった。detectSessionInUrlは
// 内部で失敗してもこの関数の呼び出し元（getSession等）へエラーを伝播しないため、
// 何が起きているかを呼び出し側から一切観測・制御できない「ブラックボックスな自動処理」に
// なっていたことが根本原因の一つ。そのため、supabaseClient.js側でdetectSessionInUrlを
// falseにし、認証コールバックの処理はこの関数を介して明示的に行う設計へ変更した。
//
// exchangeCodeForSession()・setSession()のどちらで確立した場合も、成功すれば
// onAuthStateChangeへSIGNED_INが通知される（detectSessionInUrlはURLの自動スキャンだけを
// 制御するフラグであり、明示的なメソッド呼び出しによるセッション確立自体には影響しない）。
//
// 呼び出し側は、この関数の完了（成功・失敗いずれか）を待ってからURLをクリーンアップする
// こと。exchange前にcode/tokenをURLから消してしまうと、二度と交換できなくなる
// （PKCEのcodeは一度きりしか使えない使い捨てトークンのため）。
export async function exchangeAuthCallback(supabaseClient, { search = "", hash = "" } = {}) {
  const code = new URLSearchParams(search).get("code");

  if (code) {
    const { error } = await supabaseClient.auth.exchangeCodeForSession(code);
    return { error: error || null };
  }

  const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");

  if (accessToken && refreshToken) {
    const { error } = await supabaseClient.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    return { error: error || null };
  }

  // codeもaccess_tokenも無い＝そもそも処理すべきコールバックが無かった
  // （呼び出し側はhasPendingAuthCallback()がtrueの場合のみこの関数を呼ぶ想定のため、
  // 通常はここに到達しないが、念のため安全側（エラー無し）で返す）。
  return { error: null };
}

// AppAuthGate.jsx（一般ユーザー）・AuthGate.jsx（管理画面）の両方が行う
// 「認証コールバックがあれば明示的に交換し、その後で初期セッション状態
// （getSession）を確定する」という一連の処理の“順序”だけを、Reactやwindow等の
// ブラウザAPIから切り離して保証・テストできるようにしたもの。
//
// 保証する順序（重要。この順序を壊すと今回の不具合が再発する）：
//   1. hasPendingAuthCallback(location)がtrueの場合に限り、exchangeAuthCallback()を呼ぶ
//   2. 交換が完了する（成功・失敗いずれか確定する）まで、onExchangeSettledもgetSessionも呼ばない
//      （＝交換前にURLを掃除したり、未ログイン画面を確定表示したりしない）
//   3. 交換結果（成功/失敗）に応じてonExchangeSettled({success, error})を呼ぶ。
//      URLの掃除・エラー表示等、呼び出し側固有の後処理はここに渡す関数が担当する
//      （一般ユーザー側は成功時のみURLを掃除、管理画面側は成功・失敗どちらでも
//      #adminへURLを正規化、という違いがあるため、後処理自体は呼び出し側に委ねる）
//   4. 最後にgetSession()を呼び、その結果（session）を返す
//
// hasPendingAuthCallbackがfalseの場合（#admin直打ち・通常のトップページ訪問等）は、
// exchangeAuthCallback・onExchangeSettledのどちらも一切呼ばれず、getSession()だけが
// 実行される（＝既存の「認証コールバックが無い通常の画面遷移」の挙動に一切影響しない）。
export async function resolvePendingAuthSession({
  location,
  hasPendingAuthCallback: hasPendingAuthCallbackFn,
  exchangeAuthCallback: exchangeAuthCallbackFn,
  onExchangeSettled,
  getSession,
}) {
  if (hasPendingAuthCallbackFn(location)) {
    const { error } = await exchangeAuthCallbackFn(location);
    await onExchangeSettled?.({ success: !error, error });
  }

  const { data } = await getSession();
  return { session: data.session };
}

// PasswordRecoveryGate.jsx向け：パスワード再設定リンクの認証コールバックを
// 明示的に交換するだけの、resolvePendingAuthSessionより単純な専用フロー。
//
// パスワード再設定は「セッションが確立できたかどうか」だけを見ればよく、
// 一般ユーザー/管理画面のように「交換失敗時に別のURLへ正規化する」といった
// 後処理の分岐が無いため、resolvePendingAuthSessionを流用せずこの専用関数に
// している。また、URLにcode自体が無い（＝そもそも有効なリンクではない）場合を
// 「invalidLink」として明確に区別し、exchangeAuthCallbackを呼ばずに即座に
// エラー扱いにする（hasPendingAuthCallbackがfalseのままexchangeAuthCallbackを
// 呼んでも、内部でcode/tokenが見つからずerror:nullを返すだけなので、呼び出し側が
// 誤って「成功した」と扱ってしまう危険があるため、ここで明示的に弾く）。
export async function resolveRecoverySession({
  location,
  hasPendingAuthCallback: hasPendingAuthCallbackFn,
  exchangeAuthCallback: exchangeAuthCallbackFn,
}) {
  if (!hasPendingAuthCallbackFn(location)) {
    return { success: false, invalidLink: true, error: null };
  }

  const { error } = await exchangeAuthCallbackFn(location);

  if (error) {
    return { success: false, invalidLink: false, error };
  }

  return { success: true, invalidLink: false, error: null };
}

// 一般ユーザー側(AppAuthGate)・パスワード再設定側(PasswordRecoveryGate)向け：
// 認証コールバックの痕跡（?code=・?authFlow=・#access_token=等）をURLから取り除く。
// 管理画面側のredirectToAdminAfterSignIn（AuthGate.jsx）とは異なり、ハッシュを
// #adminへ書き換えることはしない（どちらも常にルート(/)に留まる）。
// 何も取り除くものが無ければ履歴を一切操作しない（無駄なreplaceStateを避ける）。
export function cleanGeneralAuthCallbackUrl() {
  const url = new URL(window.location.href);
  const hadCode = url.searchParams.has("code");
  const hadAuthFlow = url.searchParams.has("authFlow");
  const hadHashToken = /(^|[#&])access_token=/.test(url.hash);

  if (!hadCode && !hadAuthFlow && !hadHashToken) {
    return;
  }

  url.searchParams.delete("code");
  url.searchParams.delete("authFlow");
  if (hadHashToken) {
    url.hash = "";
  }

  window.history.replaceState(null, "", url.toString());
}
