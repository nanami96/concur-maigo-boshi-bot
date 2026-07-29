// create-concur-quick-expense（Edge Function本体はindex.ts）の認証・権限判定
// だけを切り離した純粋関数。supabase/functions/ocr-receipt/
// resolveOcrAuthorization.jsと同じ「実際のI/O（fetchUser・
// fetchCompanyMembership）を呼び出し元が注入する」パターンを踏襲し、
// Deno固有のAPIには一切依存しないため、Node/vitestからモックで直接
// テストできる。
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
//   3. ユーザーは解決できたが、所属会社が無い → forbidden
//      （ocr-receiptと同じ、コスト濫用対策の最終防御。Quick Expense作成も
//      どこかの会社に所属していないユーザーが使う理由が無い）。
//   4. 上記いずれもクリアした場合はauthorized。呼び出し元が確認した
//      所属情報（membership: { company_code, role }）をそのまま返す。
//      company_codeは company_members.company_id（Supabase内部UUID）では
//      なく companies.company_code（スラッグ）であることに注意
//      （index.ts・resolveMembershipFromPublicConfigRow.js参照）。
//      これを使って、リクエスト本文のcompanyIdが実際の所属と一致するかを、
//      呼び出し元（handleQuickExpenseRequest.js）が本文解析後に追加で
//      チェックする（company_codeは会社を横断して使い回される識別子のため、
//      認証済みユーザーの実際の所属と、本文中で申告されたcompanyIdが一致
//      することを別途確認する必要がある。フロントから渡された値を認証の
//      根拠にはしない）。
//
// membershipは1件のみを想定する（supabase/schema.sqlのcompany_membersは
// user_idにunique制約があり、「1ユーザーは必ず1社にしか所属できない」ため。
// src/data/membershipRepository.jsのfetchMyRole()が.maybeSingle()を使って
// いるのと同じ前提）。
//
// roleによる絞り込み（admin限定等）はここでは行わない。Quick Expenseの
// 作成は一般利用者（role='user'）が使う機能であり、いずれかの会社に
// 所属していること自体が唯一の権限根拠となる（admin限定にする理由が無い）。
export async function resolveQuickExpenseAuthorization({ authHeader, fetchUser, fetchCompanyMembership }) {
  if (!authHeader) {
    return { outcome: "unauthorized", user: null, membership: null, reason: "no_auth_header" };
  }

  let user;
  try {
    user = await fetchUser(authHeader);
  } catch {
    return { outcome: "unauthorized", user: null, membership: null, reason: "fetch_user_exception" };
  }

  if (!user) {
    return { outcome: "unauthorized", user: null, membership: null, reason: "fetch_user_null" };
  }

  let membership;
  try {
    membership = await fetchCompanyMembership(user);
  } catch {
    // 所属確認自体が失敗した場合（DB接続エラー等）は、安全側に倒して
    // 「所属なし」と同じforbidden扱いにする（fail-closed。
    // resolveOcrAuthorization.jsと同じ方針）。
    return { outcome: "forbidden", user, membership: null, reason: "fetch_membership_exception" };
  }

  if (!membership) {
    return { outcome: "forbidden", user, membership: null, reason: "no_company_membership" };
  }

  return { outcome: "authorized", user, membership, reason: null };
}
