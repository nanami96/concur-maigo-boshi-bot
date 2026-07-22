// AuthEntryScreens.jsxの画面遷移ルールを、Reactから切り離した純粋関数として
// 切り出したもの。startWithInviteCode（一般利用者Bot向けの、招待コード優先の
// 新規登録導線かどうか）に応じて、初期表示画面と「アカウント作成」ボタンの
// 遷移先が変わる。
//
//   startWithInviteCode = true  （一般利用者Bot向け）
//     初期表示                    : "invite"（会社へ参加）
//     ログイン画面の「アカウントを作成」→ "invite"（招待コード入力からやり直す）
//   startWithInviteCode = false （管理画面向け、既存の導線を維持）
//     初期表示                    : "login"
//     ログイン画面の「アカウントを作成」→ "signup"（招待コードの概念を経由しない）
export function initialAuthEntryMode(startWithInviteCode) {
  return startWithInviteCode ? "invite" : "login";
}

export function modeAfterSignUpSwitch(startWithInviteCode) {
  return startWithInviteCode ? "invite" : "signup";
}
