// Concurログイン ID を、Identity APIで実在確認したうえで
// user_id × company_id単位で保存する（Phase 13）Supabase Edge Function。
//
// 【重要・安全ゲートによる一括停止（CONCUR_USER_LINK_ENABLED）】
// Vaultリース取得〜OAuth Refresh Token Grant〜Identity v4検索〜DB保存という
// 一連の実通信は、Secret CONCUR_USER_LINK_ENABLEDが厳密に文字列"true"である
// 場合だけ実行される。この判断はhandleLinkConcurUserRequest.js側
// （isConcurUserLinkEnabled.js）で完結しており、このファイル（index.ts）は
// CONCUR_USER_LINK_ENABLEDの値をbuildConcurEnv()経由でそのまま転記するだけで、
// 判断ロジックを一切持たない（Secretが未設定の限り、{ linked: false, status:
// "disabled" } を返すだけで、Concur・OAuth・Identity・DBのいずれにも実通信・
// 実書き込みしない）。
//
// 認証について：
//   他のConcur関連Edge Function（create-concur-quick-expense等）と同じ
//   「Authorizationヘッダー確認 → auth.getUser()」の認証境界を実装している
//   （実際の判定ロジックはresolveLinkConcurUserAuthorization.js）。所属会社の
//   確認はplatform_admin専用のlookup-concur-userとは異なり、is_platform_admin()
//   ではなくresolveOAuthCompanyId（resolve_concur_oauth_company_id RPC、
//   company_membersへの実際の所属を検証する）だけで行う。一般利用者
//   （company_membersのrole問わず）が呼び出せるFunctionである。
//
// 【重要・既存lookup-concur-userとの関係】
// このFunctionはlookup-concur-user（platform_admin専用の診断ツール）を
// 一切呼び出さない・変更しない。責務が異なるため（診断 vs 一般ユーザーの
// 恒久的な保存）、共有するのはOAuth/Identity連携の下位モジュール
// （_shared/concur-oauth・_shared/concur-identity）と、会社境界解決RPC
// （resolve_concur_oauth_company_id）だけである。
//
// 【重要・クライアントの分離（既存のConcur関連Edge Functionと同じ設計）】
// このFunctionはSupabaseクライアントを用途ごとに2つ明確に分ける。
//   A. 呼び出し元JWTクライアント（buildAuthAdapters）：auth.getUser()の
//      確認だけに使う。
//   B. service_role専用クライアント（buildVaultAdapters）：
//      resolve_concur_oauth_company_id / get_concur_refresh_token_for_edge /
//      complete_concur_oauth_refresh / save_concur_user_link という
//      4 RPCだけに使う。save_concur_user_link以外の3つは既存のRPCをそのまま
//      再利用する。
//   service_role key（SUPABASE_SERVICE_ROLE_KEY）はEdge Functionへ自動注入
//   済みの環境変数であり、新たなSecret登録は不要。フロントへ返す・ログへ
//   出すことは一切行わない。
//
// ログについて：Authorizationヘッダー・JWT・リクエスト本文（companyCode・
// concurLoginIdを含む）・Secrets（Client ID/Secret・Access/Refresh Token・
// token endpoint URL・service role key）・Concur Identity APIの生レスポンス・
// 利用者プロフィール（氏名・メールアドレス等）は一切ログへ出さない。
// ヘッダーの有無・形式、認証の成否、安全ゲートが有効かどうか、最終的な
// 内部コードだけを記録する。
import { handleLinkConcurUserRequest } from "./handleLinkConcurUserRequest.js";
import { describeAuthHeaderForLogging } from "./describeAuthHeaderForLogging.js";
import { isConcurUserLinkEnabled } from "./isConcurUserLinkEnabled.js";

// ブラウザから直接このEdge Functionを叩けるオリジンの許可リスト
// （他のConcur関連Edge Functionと同じ考え方・同じ既定値）。
const DEFAULT_ALLOWED_ORIGINS = [
  "https://nanami96.github.io",
  "http://localhost:5173",
];

function resolveAllowedOrigins() {
  const raw = Deno.env.get("CONCUR_USER_LINK_ALLOWED_ORIGINS");
  if (!raw) {
    return DEFAULT_ALLOWED_ORIGINS;
  }
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function buildCorsHeaders(origin) {
  const allowedOrigins = resolveAllowedOrigins();
  const allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

// Supabaseへ渡すプロジェクトキー（createClientの第2引数、apikey識別用）。
// 他のEdge FunctionのresolveProjectApiKey()と同じ理由・同じ実装。
function resolveProjectApiKey() {
  return Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
}

function buildConcurEnv() {
  return {
    CONCUR_CLIENT_ID: Deno.env.get("CONCUR_CLIENT_ID"),
    CONCUR_CLIENT_SECRET: Deno.env.get("CONCUR_CLIENT_SECRET"),
    CONCUR_TOKEN_URL: Deno.env.get("CONCUR_TOKEN_URL"),
    CONCUR_SCOPE: Deno.env.get("CONCUR_SCOPE"),
    CONCUR_USER_LINK_ENABLED: Deno.env.get("CONCUR_USER_LINK_ENABLED"),
  };
}

// service_role専用クライアント（クライアント分離のB）。呼び出し元の
// Authorizationヘッダーは一切使わない・上書きしない。
function buildServiceRoleClient(createClient) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

// handleLinkConcurUserRequest.jsが期待するDeno非依存のインターフェースへ
// 変換するアダプタ。resolveOAuthCompanyId/getRefreshTokenForEdge/
// completeOAuthRefreshは既存のcheck-concur-oauth・lookup-concur-user・
// create-concur-quick-expenseと全く同じ実装（同じ3 RPCをそのまま再利用）。
// saveConcurUserLinkだけがこのFunction専用の新しいRPC呼び出し。
function buildVaultAdapters(serviceClient, log) {
  return {
    resolveOAuthCompanyId: async ({ userId, companyCode }) => {
      const { data, error } = await serviceClient.rpc("resolve_concur_oauth_company_id", {
        p_user_id: userId,
        p_company_code: companyCode,
      });

      if (error) {
        log(`会社UUID解決エラー (code=${error.code ?? "?"})`);
        throw error;
      }

      return typeof data === "string" && data.trim() !== "" ? data : null;
    },
    getRefreshTokenForEdge: async ({ companyId }) => {
      const { data, error } = await serviceClient.rpc("get_concur_refresh_token_for_edge", {
        p_company_id: companyId ?? null,
      });

      if (error) {
        log(`Vault Token取得エラー (code=${error.code ?? "?"})`);
        throw error;
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        return null;
      }

      return {
        connectionId: row.connection_id,
        leaseId: row.lease_id,
        refreshToken: row.refresh_token,
      };
    },
    completeOAuthRefresh: async ({ connectionId, leaseId, success, newRefreshToken, errorCode }) => {
      const { data, error } = await serviceClient.rpc("complete_concur_oauth_refresh", {
        p_connection_id: connectionId,
        p_lease_id: leaseId,
        p_success: success,
        p_new_refresh_token: newRefreshToken ?? null,
        p_error_code: errorCode ?? null,
      });

      if (error) {
        log(`Vault Token完了処理エラー (code=${error.code ?? "?"})`);
        throw error;
      }

      return data === true;
    },
    // save_concur_user_link(p_user_id, p_company_id, p_concur_login_id)は
    // service_roleのみEXECUTE可（supabase/schema.sql Phase 13参照）。
    // Identity API確認成功後にのみhandleLinkConcurUserRequest.jsから呼ばれる。
    saveConcurUserLink: async ({ userId, companyId, concurLoginId }) => {
      const { error } = await serviceClient.rpc("save_concur_user_link", {
        p_user_id: userId,
        p_company_id: companyId,
        p_concur_login_id: concurLoginId,
      });

      if (error) {
        log(`Concurログイン紐付け保存エラー (code=${error.code ?? "?"})`);
        throw error;
      }
    },
  };
}

// handleLinkConcurUserRequest.js（Deno非依存の純粋関数）へ渡す、Deno/Supabase
// 固有のI/O実装をまとめて用意する。
function buildAuthAdapters(createClient, authHeader, log) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const projectApiKey = resolveProjectApiKey();

  const supabase = createClient(supabaseUrl, projectApiKey, {
    global: { headers: { Authorization: authHeader ?? "" } },
    auth: { persistSession: false },
  });

  return {
    fetchUser: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        log(`認証詳細 (getUserエラー: status=${error.status ?? "?"}, code=${error.code ?? "?"})`);
        return null;
      }
      if (!data?.user) {
        log("認証詳細 (getUserは成功したがuserが空)");
        return null;
      }
      return data.user;
    },
  };
}

async function parseRequestBody(req) {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const log = (stage) => {
    console.log(`[link-concur-user:${requestId}] ${stage} (+${Date.now() - startedAt}ms)`);
  };

  const origin = req.headers.get("origin") ?? "";
  const corsHeaders = buildCorsHeaders(origin);

  log("Function開始");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const authHeader = req.headers.get("authorization");
  log(`認証情報 (${describeAuthHeaderForLogging(authHeader)})`);

  let authAdapters;
  let vaultAdapters;
  try {
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    authAdapters = buildAuthAdapters(createClient, authHeader, log);
    vaultAdapters = buildVaultAdapters(buildServiceRoleClient(createClient), log);
  } catch (caughtError) {
    console.error("auth client setup failed", caughtError?.message);
    log("失敗 (internal_error: auth setup)");
    return new Response(
      JSON.stringify({ result: null, error: { code: "internal_error", message: "処理中にエラーが発生しました。" } }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const env = buildConcurEnv();
  log(`User link enabled=${isConcurUserLinkEnabled(env)}`);

  const { status, body } = await handleLinkConcurUserRequest({
    method: req.method,
    authHeader,
    parseBody: () => req.json(),
    fetchUser: authAdapters.fetchUser,
    env,
    resolveOAuthCompanyId: vaultAdapters.resolveOAuthCompanyId,
    getRefreshTokenForEdge: vaultAdapters.getRefreshTokenForEdge,
    completeOAuthRefresh: vaultAdapters.completeOAuthRefresh,
    saveConcurUserLink: vaultAdapters.saveConcurUserLink,
  });

  log(`終了 (status=${status}, errorCode=${body?.error?.code ?? "none"})`);

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
