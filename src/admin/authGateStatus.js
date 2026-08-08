// AuthGateがどの画面を表示すべきかを決めるだけの純粋関数。
// Supabase呼び出しやReactの状態管理から切り離してテストできるようにしている。
//
// 戻り値：
//   "local"     Supabase未設定（ローカル開発モード。認証なしでAdminRootを表示）
//   "loading"   Supabase設定済みだが、まだセッション確認が終わっていない
//   "signedOut" Supabase設定済み・未ログイン（ログイン画面を出す）
//   "signedIn"  Supabase設定済み・ログイン済み（AdminRootを表示）
export function resolveAuthGateView({ isSupabaseConfigured, authStatus }) {
  if (!isSupabaseConfigured) {
    return "local";
  }

  if (authStatus === "signedIn") {
    return "signedIn";
  }

  if (authStatus === "signedOut") {
    return "signedOut";
  }

  return "loading";
}

// AuthGateの権限判定（fetchMyRole()・fetchIsPlatformAdmin()の結果から
// roleStatusを決める）だけを行う純粋関数（Commit 6）。Supabase呼び出し自体は
// AuthGate.jsx側（Promise.all）が行い、ここではその結果だけを受け取る。
//
// 【複数社所属対応】role（company_members.role）はfetchMyRole()の引数無し
// 呼び出しの結果、すなわち「どこか1社でもrole='admin'の行を持っているか」
// という粗い存在確認である。「具体的にどの会社を管理できるか」（role='user'
// としてしか所属していない会社を除外する等）はここでは判断せず、AdminRoot側の
// 会社一覧（RLSでadmin所属会社だけに絞り込み済み）に委ねる。
//
// 戻り値：
//   "error"           roleまたはplatform_adminの取得自体に失敗した
//   "platform_admin"  is_platform_admin()がtrue（会社ごとのroleより優先）
//   "company_admin"   is_platform_admin()はfalseだが、どこか1社でrole==='admin'
//   "forbidden"       上記いずれでもない（一般利用者・未所属等）
export function resolveAdminRoleStatus({ role, roleError, isPlatformAdmin, platformError }) {
  if (roleError || platformError) {
    return "error";
  }

  if (isPlatformAdmin) {
    return "platform_admin";
  }

  if (role === "admin") {
    return "company_admin";
  }

  return "forbidden";
}
