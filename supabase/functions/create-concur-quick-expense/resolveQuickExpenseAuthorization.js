// create-concur-quick-expense（Edge Function本体はindex.ts）の認証（本人確認）
// だけを切り離した純粋関数。supabase/functions/ocr-receipt/
// resolveOcrAuthorization.jsと同じ「実際のI/O（fetchUser）を呼び出し元が
// 注入する」パターンを踏襲し、Deno固有のAPIには一切依存しないため、
// Node/vitestからモックで直接テストできる。
//
// 【重要・複数社所属対応（Commit 1）による責務変更】
// 以前はこの関数がfetchCompanyMembership(user)も呼び、「ユーザーがどこかの
// 会社に所属しているか」まで判定していたが、1ユーザーが複数の会社へ
// 所属できる設計になったため、「どの会社への所属を確認するか」はリクエスト
// 本文のcompanyId（company_code）が分からないと決められなくなった。本文は
// この関数より後（handleQuickExpenseRequest.js側、本文検証の完了後）でしか
// 読み取らないため、会社所属の確認はこの関数の責務から外し、
// handleQuickExpenseRequest.js側で本文検証後にfetchCompanyMembership
// (user, validated.companyId)を呼ぶ設計に変更した（詳細は
// handleQuickExpenseRequest.jsの処理順序コメント参照）。
// この関数はあくまで「Authorizationヘッダーから本人を解決できるか」
// （＝Supabase Authユーザーとして有効かどうか）だけを判定する。
//
// 判定順序（ocr-receipt/resolveOcrAuthorization.jsと同じ考え方）：
//   1. Authorizationヘッダーが無い → unauthorized
//      （Supabaseプラットフォーム自体のverify_jwt有効時は、そもそもこれより
//      前の段階でAuthorizationヘッダーが無い/不正な形式のリクエストは
//      拒否される。ここでの判定はverify_jwtを無効化してデプロイされた場合や
//      ローカル実行時にも同じ認証境界が働くようにするための、プラット
//      フォームに依存しない二重チェック）。
//   2. fetchUser(authHeader) が呼び出し元ユーザーを解決できない
//      （JWTが不正・期限切れ・そもそもユーザーのセッションJWTではない
//      新形式のpublishable/secret key自体を渡された場合等） → unauthorized
//   3. 上記をクリアした場合はauthorized。解決したuserをそのまま返す
//      （所属会社の確認はここでは行わない）。
export async function resolveQuickExpenseAuthorization({ authHeader, fetchUser }) {
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

  return { outcome: "authorized", user, reason: null };
}
