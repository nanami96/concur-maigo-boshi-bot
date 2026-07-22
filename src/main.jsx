import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AdminRoot from './admin/AdminRoot.jsx';
import AuthGate from './admin/AuthGate.jsx';
import { hasPendingAuthCallback } from './admin/authCallback.js';
import './styles.css';

// #admin のときだけ管理画面を表示する。既存の利用者向けBot画面（App）は無条件で従来どおり。
// hashchangeを監視して、管理画面からのリンク（#へ戻る等）でも再描画されるようにする。
// 管理画面はAuthGateを経由させ、Supabase未設定時はローカル開発モード、
// 設定済みの場合はログイン済みユーザーだけがAdminRootへ到達できるようにする。
// 利用者向けBot画面（App）はAuthGateを経由しないため、認証は一切要求されない。
//
// Magic Linkをクリックして戻ってきた直後は、URLに#adminが付いていない
// （LoginScreen.jsxのbuildRedirectUrlが#adminを含まないクリーンなURLへ
// 戻す設計にしているため）。そのままだと通常のBot画面が表示されてしまうため、
// hasPendingAuthCallbackでURL中にSupabaseの認証コールバック情報
// （?code=... や #access_token=...）が無いかも合わせて確認し、あれば
// 管理画面ツリー（AuthGate）を先に表示してログイン処理を完了させる。
// 完了後の#adminへの遷移はAuthGate側が担当する。
function shouldShowAdminTree() {
  return (
    window.location.hash.startsWith('#admin') ||
    hasPendingAuthCallback({ search: window.location.search, hash: window.location.hash })
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
    <App />
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootSwitch />
  </React.StrictMode>
);
