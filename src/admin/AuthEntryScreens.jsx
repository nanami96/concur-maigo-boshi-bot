import { useState } from "react";
import LoginScreen from "./LoginScreen";
import SignUpScreen from "./SignUpScreen";
import InviteCodeEntryScreen from "./InviteCodeEntryScreen";
import { initialAuthEntryMode, modeAfterSignUpSwitch } from "./authEntryFlow";

// 未ログイン時に表示する「ログイン」⇔「アカウントを作成」（⇔「会社へ参加」）の
// 切り替えをまとめた共通コンポーネント。管理画面（AuthGate）・一般利用者Bot
// （AppAuthGate）のどちらも同じSupabase Authユーザーを使うため、この切り替え
// ロジックを共有する。
//
// startWithInviteCode=trueの場合（一般利用者Bot側からの利用を想定）だけ、
// 新規登録の導線を「招待コード入力→アカウント作成」の順にする
// （招待コード→アカウント作成→メール確認→自動会社参加、という一本の導線にするため。
// 詳細はInviteCodeEntryScreen.jsx・AuthenticatedBotScreen.jsx参照）。
// falseの場合（管理画面側からの利用）は、既存の「ログイン⇔アカウント作成」の
// 2画面構成のまま変更しない（Platform Admin/adminの既存ログイン動線を維持するため）。
export default function AuthEntryScreens({
  loginTitle,
  signUpTitle,
  onSignedUp,
  allowMagicLink = true,
  startWithInviteCode = false,
  signUpSwitchLabel,
  loginBannerMessage = null,
}) {
  const [mode, setMode] = useState(() => initialAuthEntryMode(startWithInviteCode));

  if (mode === "invite") {
    return (
      <InviteCodeEntryScreen
        onNext={() => setMode("signup")}
        onSwitchToLogin={() => setMode("login")}
      />
    );
  }

  if (mode === "signup") {
    return (
      <SignUpScreen
        title={signUpTitle}
        onSwitchToLogin={() => setMode("login")}
        onSignedUp={onSignedUp}
      />
    );
  }

  return (
    <LoginScreen
      title={loginTitle}
      onSwitchToSignUp={() => setMode(modeAfterSignUpSwitch(startWithInviteCode))}
      allowMagicLink={allowMagicLink}
      {...(signUpSwitchLabel ? { signUpSwitchLabel } : {})}
      bannerMessage={loginBannerMessage}
    />
  );
}
