import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AppAuthGate from './AppAuthGate.jsx';
import AdminRoot from './admin/AdminRoot.jsx';
import AuthGate from './admin/AuthGate.jsx';
import AdminViewportGate from './admin/AdminViewportGate.jsx';
import PasswordRecoveryGate from './PasswordRecoveryGate.jsx';
import { resolveRootTree } from './admin/authCallback.js';
import './styles.css';

// #admin のときだけ管理画面を表示する。既存の利用者向けBot画面（App）は無条件で従来どおり。
// hashchangeを監視して、管理画面からのリンク（#へ戻る等）でも再描画されるようにする。
// 管理画面はAdminViewportGate→AuthGateの順に経由させる。AdminViewportGateは
// 管理画面がPC操作前提であることに基づくviewport幅チェック（UI制御のみで
// セキュリティ境界ではない。詳細はadminViewportGate.js参照）、AuthGateは
// Supabase未設定時はローカル開発モード、設定済みの場合はログイン済み・
// admin権限を持つユーザーだけがAdminRootへ到達できるようにする本来の認証・
// 権限チェック。利用者向けBot画面（App）はどちらも経由しないため、
// 認証もviewport制限も一切要求されない。
//
// 実際の振り分けロジックはresolveRootTree（src/admin/authCallback.js）に切り出してある
// （window.locationから切り離した純粋関数としてテストできるようにするため）。
// 重要：認証コールバック（?code=...等）が来ているからといって、常に管理画面ツリーへ
// ルーティングしてはいけない。一般ユーザーのアカウント作成（確認メール）でも
// 全く同じ形の?code=...が付いて戻ってくるため、以前はこれを区別できず、
// 一般ユーザーが確認メールのリンクをクリックしただけで管理画面ツリー（AuthGate）が
// マウントされ、「管理者権限がありません」画面を経由してしまう不具合があった。
// resolveRootTreeはLoginScreen.jsxのMagic Linkだけに付与しているauthFlow=admin
// マーカーの有無で区別し、それが無い認証コールバック（＝一般ユーザーのsignUp確認メール）は
// 通常のAppAuthGateツリーへ進ませる（自動的な会社参加処理はAuthenticatedBotScreen側が担当する）。
//
// パスワード再設定リンク（authFlow=recoveryマーカー）は、admin・generalのどちらとも
// 別の第3のツリー（PasswordRecoveryGate）へルーティングする。パスワード再設定リンクの
// 交換も通常のサインインと同じ形でセッションを確立するため、もしAppAuthGateの通常ツリーで
// 処理すると、ログイン済み・未所属と誤認されてpending invite（招待コード）の自動redeemが
// 意図せず走ってしまう恐れがある。詳細はPasswordRecoveryGate.jsx参照。
function resolveTree() {
  return resolveRootTree({ hash: window.location.hash, search: window.location.search });
}

function RootSwitch() {
  const [tree, setTree] = useState(resolveTree);

  useEffect(() => {
    const handleHashChange = () => setTree(resolveTree());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (tree === 'admin') {
    return (
      <AdminViewportGate>
        <AuthGate>
          <AdminRoot />
        </AuthGate>
      </AdminViewportGate>
    );
  }

  if (tree === 'recovery') {
    return <PasswordRecoveryGate />;
  }

  return <AppAuthGate />;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootSwitch />
  </React.StrictMode>
);
