// check-concur-oauth（Edge Function本体はindex.ts）の認証・権限判定だけを
// 切り離した純粋関数。supabase/functions/create-concur-quick-expense/
// resolveQuickExpenseAuthorization.js・supabase/functions/ocr-receipt/
// resolveOcrAuthorization.jsと同じ「実際のI/O（fetchUser・isPlatformAdmin）を
// 呼び出し元が注入する」パターンを踏襲し、Deno固有のAPIには一切依存しない
// ため、Node/vitestからモックで直接テストできる。
//
// このFunctionはplatform_adminだけが実行できる（一般利用者・company_admin
// は不可）。Concur側の認証情報の疎通確認という、通常の会社運用の範囲を
// 超えたサービス運営者向けの操作であるため。
//
// 判定順序：
//   1. Authorizationヘッダーが無い → unauthorized
//      （Supabaseプラットフォーム自体のverify_jwt有効時は、そもそもこれより
//      前の段階でAuthorizationヘッダーが無い/不正な形式のリクエストは
//      拒否される。ここでの判定はverify_jwtを無効化してデプロイされた場合や
//      ローカル実行時にも同じ認証境界が働くようにするための、プラット
//      フォームに依存しない二重チェック）。
//   2. fetchUser(authHeader) が呼び出し元ユーザーを解決できない
//      （JWTが不正・期限切れ・そもそもユーザーのセッションJWTではない
//      新形式のpublishable/secret key自体を渡された場合等） → unauthorized
//   3. ユーザーは解決できたが、platform_adminではない → forbidden
//      （isPlatformAdmin()はsupabase.rpc("is_platform_admin")、既存の
//      SECURITY DEFINER関数を呼び出し元のJWTで呼ぶ想定。フロントから
//      送られたrole相当の値は一切受け取らない・信用しない。判定は必ず
//      サーバー側でauth.uid()を根拠に行う）。
//   4. 上記いずれもクリアした場合のみauthorized。
//
// isPlatformAdmin(user)自体が例外を投げた場合（DB接続エラー等）も、安全側に
// 倒してforbidden扱いにする（fail-closed。許可すべきか不明な場合は許可しない）。
export async function resolveConcurOAuthCheckAuthorization({ authHeader, fetchUser, isPlatformAdmin }) {
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

  // 真偽値trueとの厳密一致だけを許可扱いにする（!isAdminのような truthy
  // 判定にしない）。isPlatformAdmin()の実装が万一null・文字列・オブジェクト
  // 等の型不正な値を返しても、それを「許可」とは解釈しない安全側の設計。
  if (isAdmin !== true) {
    return { outcome: "forbidden", user, reason: "not_platform_admin" };
  }

  return { outcome: "authorized", user, reason: null };
}
