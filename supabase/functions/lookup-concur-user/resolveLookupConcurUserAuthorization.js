// lookup-concur-user（Edge Function本体はindex.ts）の認証・権限判定だけを
// 切り離した純粋関数。supabase/functions/check-concur-oauth/
// resolveConcurOAuthCheckAuthorization.jsと全く同じ判定ロジックだが、
// 既存のcheck-concur-oauthへ影響を与えないよう複製している
// （このプロジェクトの既存方針：ocr-receipt/create-concur-quick-expense間の
// classify*Error関数の複製、concurApi.js/ocrReceiptRepository.js間の
// ensureValidSession()の複製と同じ考え方）。
//
// このFunctionはplatform_adminだけが実行できる（一般利用者・company_admin
// は不可）。Concur Identity APIによる利用者検索という、通常の会社運用の
// 範囲を超えたサービス運営者向けの診断操作であるため。
//
// 判定順序：
//   1. Authorizationヘッダーが無い → unauthorized
//   2. fetchUser(authHeader) が呼び出し元ユーザーを解決できない → unauthorized
//   3. ユーザーは解決できたが、platform_adminではない → forbidden
//      （isPlatformAdmin()はsupabase.rpc("is_platform_admin")、既存の
//      SECURITY DEFINER関数を呼び出し元のJWTで呼ぶ想定。フロントから
//      送られたrole相当の値・request bodyの内容は一切受け取らない・
//      信用しない。判定は必ずサーバー側でauth.uid()を根拠に行う）。
//   4. 上記いずれもクリアした場合のみauthorized。
//
// isPlatformAdmin(user)自体が例外を投げた場合（DB接続エラー等）も、安全側に
// 倒してforbidden扱いにする（fail-closed）。
export async function resolveLookupConcurUserAuthorization({ authHeader, fetchUser, isPlatformAdmin }) {
  if (!authHeader) {
    return { outcome: "unauthorized", user: null, reason: "no_auth_header" };
  }

  let user;
  try {
    user = await fetchUser(authHeader);
  } catch {
    return { outcome: "unauthorized", user: null, reason: "fetch_user_exception" };
  }

  if (!user) {
    return { outcome: "unauthorized", user: null, reason: "fetch_user_null" };
  }

  let isAdmin;
  try {
    isAdmin = await isPlatformAdmin(user);
  } catch {
    isAdmin = false;
  }

  if (isAdmin !== true) {
    return { outcome: "forbidden", user, reason: "not_platform_admin" };
  }

  return { outcome: "authorized", user, reason: null };
}
