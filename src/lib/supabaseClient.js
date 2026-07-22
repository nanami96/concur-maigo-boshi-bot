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
// - flowType: "pkce"        … Magic Linkのトークンをハッシュフラグメントではなく
//                              ?code= というクエリ文字列で受け渡す方式。このアプリは
//                              #admin という独自のハッシュルーティングを持っているため、
//                              ハッシュ側にトークンを載せるimplicit flowだと衝突しやすい。
//                              PKCEならクエリ文字列側で完結するため#adminと衝突しない。
// - detectSessionInUrl: true … ページ読み込み時にURL中の認証情報（上記のcode等）を
//                              自動検出してセッションを確立し、処理後はURLから
//                              該当パラメータを取り除く（history.replaceState）。
// - persistSession: true     … リロード後もログイン状態を維持する（localStorage）。
// - autoRefreshToken: true   … アクセストークンの自動更新。
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        flowType: "pkce",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;
