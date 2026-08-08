// link-concur-user（Edge Function本体はindex.ts）の認証（本人確認）だけを
// 切り離した純粋関数。create-concur-quick-expense/resolveQuickExpenseAuthorization.js
// と全く同じ設計（実際のI/O・fetchUserを呼び出し元が注入するパターン）。
//
// 所属会社の確認はこの関数の責務にしない（本文のcompanyCodeが分かってから
// でないと判定できないため）。handleLinkConcurUserRequest.js側で、本文検証後に
// resolveOAuthCompanyId({ userId, companyCode })（resolve_concur_oauth_company_id
// RPC。会社所属自体もこのRPCが検証する）を呼ぶ。
export async function resolveLinkConcurUserAuthorization({ authHeader, fetchUser }) {
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
