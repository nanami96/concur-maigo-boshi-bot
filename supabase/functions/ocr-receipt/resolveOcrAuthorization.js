// index.ts（Edge Function本体）から、Deno固有のAPI（Deno.serve/Deno.env/
// createClient等）を切り離した「認証・権限の判定ロジックだけ」の純粋関数。
// 実際のSupabase呼び出し（fetchUser/hasCompanyMembership）は呼び出し元が
// 注入する形にしているため、Node/vitestからモックで直接テストできる
// （このプロジェクトの既存パターン：resolveAuthGateView・resolvePendingAuthSession
// 等と同じ「I/Oから切り離した判定ロジックの分離」を踏襲）。
//
// 判定順序（このEdge Functionの認証境界の全体像）：
//   1. Authorizationヘッダーが無い → unauthorized
//      （Supabaseプラットフォームのverify_jwt有効時は、そもそもこれより前の
//      段階でAuthorizationヘッダーが無い/不正な形式のリクエストは拒否される。
//      ここでの判定はverify_jwtを無効化してデプロイされた場合や、ローカル
//      （supabase functions serve）実行時にも同じ結果になるようにするための、
//      関数自身による独立した二重チェック）。
//   2. fetchUser(authHeader) が呼び出し元ユーザーを解決できない
//      （JWTが不正・期限切れ・そもそもユーザーのセッションJWTではない
//      新形式のpublishable/secret key自体を渡された場合等） → unauthorized
//   3. ユーザーは解決できたが、company_membersに1件も所属が無い → forbidden
//      （一度も招待コードで会社に参加していないアカウント。コスト暴走対策）
//   4. 上記いずれもクリアした場合のみ authorized（Azureへの処理へ進んでよい）
export async function resolveOcrAuthorization({ authHeader, fetchUser, hasCompanyMembership }) {
  if (!authHeader) {
    return { outcome: "unauthorized", user: null };
  }

  let user;
  try {
    user = await fetchUser(authHeader);
  } catch {
    return { outcome: "unauthorized", user: null };
  }

  if (!user) {
    return { outcome: "unauthorized", user: null };
  }

  let isMember;
  try {
    isMember = await hasCompanyMembership(user);
  } catch {
    // 所属確認自体が失敗した場合（DB接続エラー等）は、安全側に倒して
    // 「所属なし」と同じforbidden扱いにする（許可すべきか不明な場合は
    // 許可しない、というfail-closedの原則）。
    isMember = false;
  }

  if (!isMember) {
    return { outcome: "forbidden", user };
  }

  return { outcome: "authorized", user };
}
