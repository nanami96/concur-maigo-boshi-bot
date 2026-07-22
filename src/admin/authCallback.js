// このアプリは #admin という独自のハッシュルーティングを持っている一方、
// Supabase AuthのMagic Linkもログイン完了後にURLへ認証情報を埋め込んで戻ってくる
// （PKCE flowなら ?code=... というクエリ文字列、implicit flowなら
// #access_token=... というハッシュフラグメント）。
//
// emailRedirectToをbuildRedirectUrl()（LoginScreen.jsx）で#adminを含まない
// クリーンなURLにしているため、通常の#admin遷移ではこの関数はfalseを返す。
// trueになるのは「メールのMagic Linkをクリックして今まさに戻ってきた直後」だけであり、
// main.jsxはこれを「まだ#adminにはいないが、AuthGateを経由させてログイン処理を
// 完了させ、完了後に#adminへ移動させるべき状態」として扱う。
//
// window.location に依存させず、テストしやすいようにプレーンなオブジェクトを受け取る。
export function hasPendingAuthCallback({ search = "", hash = "" } = {}) {
  const hasCode = new URLSearchParams(search).has("code");
  const hasHashToken = /(^|[#&])access_token=/.test(hash);
  return hasCode || hasHashToken;
}
