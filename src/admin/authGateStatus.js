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
