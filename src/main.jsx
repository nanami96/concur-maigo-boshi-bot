import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AppAuthGate from './AppAuthGate.jsx';
import AdminRoot from './admin/AdminRoot.jsx';
import AuthGate from './admin/AuthGate.jsx';
import { resolveRootTree } from './admin/authCallback.js';
import './styles.css';

// #admin のときだけ管理画面を表示する。既存の利用者向けBot画面（App）は無条件で従来どおり。
// hashchangeを監視して、管理画面からのリンク（#へ戻る等）でも再描画されるようにする。
// 管理画面はAuthGateを経由させ、Supabase未設定時はローカル開発モード、
// 設定済みの場合はログイン済みユーザーだけがAdminRootへ到達できるようにする。
// 利用者向けBot画面（App）はAuthGateを経由しないため、認証は一切要求されない。
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
function shouldShowAdminTree() {
  return (
    resolveRootTree({ hash: window.location.hash, search: window.location.search }) === 'admin'
  );
}

function RootSwitch() {
  const [isAdmin, setIsAdmin] = useState(shouldShowAdminTree);

  useEffect(() => {
    const handleHashChange = () => setIsAdmin(shouldShowAdminTree());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return isAdmin ? (
    <AuthGate>
      <AdminRoot />
    </AuthGate>
  ) : (
    <AppAuthGate />
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootSwitch />
  </React.StrictMode>
);
