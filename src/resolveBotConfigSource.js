// 利用者Bot画面が「今回どの設定を使うか」を決める純粋関数。
// 実際のSupabase呼び出し・Reactの状態管理から切り離してあるので、
// Vitestで全分岐を直接検証できる。
//
// 優先順位：
//   1. Supabaseに公開済み設定がある                     → それを使う（source: "remote"）
//   2. Supabase未設定（ローカル開発・またはSupabase       → 静的configがあればそれを使う
//      未接続のデモビルド）                                (source: "static")
//   3. Supabaseには繋がったが、この会社はまだ一度も        → 静的configがあればそれを使う
//      公開されていない（エラーではない）                  (source: "static-unpublished")
//      静的configも無ければ「未公開」扱い
//   4. Supabaseへの問い合わせ自体が失敗した（ネットワーク/
//      サーバーエラー）
//        ・ローカル開発（isPublicDemo=false）    → 静的configへフォールバック
//          （開発中の一時的な接続不調で作業が止まらないようにする）
//        ・本番相当のビルド（isPublicDemo=true） → 静的configへは黙って戻さない。
//          「取得できない」ことを利用者へ明示する（古い設定を正として
//          誤案内してしまうリスクを避けるため）。
export function resolveBotConfigSource({
  isSupabaseConfigured,
  isPublicDemo,
  staticConfig,
  remoteConfig,
  remoteError,
}) {
  if (!isSupabaseConfigured) {
    return staticConfig
      ? { status: "ready", config: staticConfig, source: "static" }
      : { status: "unavailable", config: null, source: null };
  }

  if (remoteConfig) {
    return { status: "ready", config: remoteConfig, source: "remote" };
  }

  if (!remoteError) {
    return staticConfig
      ? { status: "ready", config: staticConfig, source: "static-unpublished" }
      : { status: "unavailable", config: null, source: null };
  }

  if (!isPublicDemo && staticConfig) {
    return { status: "ready", config: staticConfig, source: "static-fallback" };
  }

  return { status: "error", config: null, source: null };
}
