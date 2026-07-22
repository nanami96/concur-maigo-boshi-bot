import { createClient } from "@supabase/supabase-js";

// Supabaseの接続情報が未設定でもアプリ全体（利用者向けBot・ローカル管理画面）が
// クラッシュしないようにするための唯一の入り口。
//
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が無い環境（今までの開発環境や、
// Supabaseをまだ用意していない人の手元）では isSupabaseConfigured が false になり、
// supabase は null のままになる。呼び出し側は必ず isSupabaseConfigured を
// 先に確認してから supabase を使うこと。
//
// ここに置いてよいのは anon（公開用）キーだけ。service_role キー（RLSを無視できる
// 強力な鍵）は絶対にフロントエンドのコードや環境変数に置かないこと。
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// authオプションはデフォルト任せにせず明示する（@supabase/supabase-js v2の
// ブラウザSPA向け推奨設定）。
// - flowType: "pkce"         … Magic Link・確認メールのトークンをハッシュフラグメントでは
//                              なく ?code= というクエリ文字列で受け渡す方式。このアプリは
//                              #admin という独自のハッシュルーティングを持っているため、
//                              ハッシュ側にトークンを載せるimplicit flowだと衝突しやすい。
//                              PKCEならクエリ文字列側で完結するため#adminと衝突しない。
// - detectSessionInUrl: false … あえて自動検出には任せず、認証コールバック（?code=等）の
//                              処理はAuthGate.jsx/AppAuthGate.jsxがexchangeAuthCallback()
//                              （src/admin/authCallback.js）を介して明示的に行う。
//                              理由：detectSessionInUrl:trueの自動処理は失敗しても
//                              呼び出し元へエラーを一切伝播しないため、実Supabase環境で
//                              「確認メールのリンクをクリックしてもセッションが確立され
//                              ない」不具合が起きた際に原因を特定・制御できなかった。
//                              明示的に呼ぶことで、成功/失敗を確実に検知し、失敗時は
//                              適切なフォールバックUI（再ログイン導線）を出せるようにする。
// - persistSession: true      … リロード後もログイン状態を維持する（localStorage）。
// - autoRefreshToken: true    … アクセストークンの自動更新。
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        flowType: "pkce",
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;
