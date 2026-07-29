// Concur OAuth（Refresh Token Grant）の疎通確認だけを行う、platform_admin
// 専用のSupabase Edge Function。
//
// 【位置づけ・重要】
// 既存の「Concurに登録」ボタン・create-concur-quick-expense（Quick Expense
// スタブ）とは一切接続していない、完全に独立したFunctionである。
// 一般利用者・company_admin（会社の管理画面利用者）はこのFunctionを呼び
// 出せない（platform_adminだけに制限。resolveConcurOAuthCheckAuthorization.js
// 参照）。
//
// 通常は何もしない（安全ゲート）：
// CONCUR_OAUTH_CHECK_ENABLEDというSecretが厳密に文字列"true"でない限り、
// token endpointへの実通信（refreshConcurAccessToken()の呼び出し）は
// 一切発生せず、{ connected: false, status: "disabled" } を返すだけの
// 「呼び出しても安全な」状態になっている（isConcurOAuthCheckEnabled.js・
// handleConcurOAuthCheckRequest.js参照）。今回のコミット時点ではこの
// Secret自体を登録していないため、実際にはデプロイしても常にdisabled状態。
//
// 認証について（他のEdge Functionと同じ3段階の認証境界＋platform_admin確認）：
//   1. Supabaseプラットフォーム自体のverify_jwt（supabase/config.tomlで
//      この関数専用にtrueを明示）が、JWTとして解釈できないAuthorization
//      ヘッダーを持つリクエストを、このコードが実行される前に拒否する。
//   2. この関数自身（index.ts）もauth.getUser()を呼び、実際にログイン中
//      ユーザーが解決できるかを確認する（verify_jwtを無効化してデプロイ
//      された場合にも同じ認証境界が働くようにするための二重チェック）。
//   3. 既存のis_platform_admin()（supabase/schema.sql、Phase 8で追加された
//      SECURITY DEFINER関数。auth.uid()自身がplatform_adminかどうかだけを
//      判定する）をsupabase.rpc()経由で呼び出し、platform_adminでなければ
//      forbiddenとする。フロントから送られたrole相当の値は一切受け取らない・
//      信用しない（このFunctionはrequest bodyそのものを読み取らない設計。
//      handleConcurOAuthCheckRequest.js参照）。
//
// 【重要・クライアントの分離（Vault対応で追加）】
// このFunctionはSupabaseクライアントを用途ごとに2つ明確に分ける。
//   A. 呼び出し元JWTクライアント（buildAuthAdapters）：auth.getUser()・
//      is_platform_admin()の確認だけに使う。既存の全Edge Functionと同じ方針
//      （service_roleは使わず、呼び出し元のJWTをそのままAuthorizationへ
//      上書きしたクライアントを使う）。
//   B. service_role専用クライアント（buildVaultAdapters）：
//      get_concur_refresh_token_for_edge / complete_concur_oauth_refresh
//      というVault関連の2 RPCだけに使う。この2 RPCはSQL側でservice_role
//      以外へのEXECUTE権限を持たない（supabase/schema.sql Phase 12参照）ため、
//      呼び出し元JWTクライアント（A）から呼んでも失敗する。コード構造上も
//      Aのクライアントからこれらを呼び出す経路を作らない（二重の防御）。
//   service_role key（SUPABASE_SERVICE_ROLE_KEY）はEdge Functionへ自動注入
//   済みの環境変数であり、新たなSecret登録は不要。フロントへ返す・ログへ
//   出すことは一切行わない。
//
// ログについて：Authorizationヘッダー・JWT・リクエスト本文・Secrets
// （Client ID/Secret・Access/Refresh Token・token endpoint URL・service role
// key）・OAuthサーバーの生レスポンスは一切ログへ出さない。ヘッダーの有無・
// 形式・トークンの文字数、認証・認可の成否、OAuth checkが有効かどうか、
// 最終的な内部コードだけを記録する。
import { handleConcurOAuthCheckRequest } from "./handleConcurOAuthCheckRequest.js";
import { describeAuthHeaderForLogging } from "./describeAuthHeaderForLogging.js";
import { isConcurOAuthCheckEnabled } from "./isConcurOAuthCheckEnabled.js";

// ブラウザから直接このEdge Functionを叩けるオリジンの許可リスト
// （他のEdge Functionと同じ考え方・同じ既定値。専用のSecret名にしているのは
// 将来別々の許可設定を持てるようにするため。現時点ではこのFunctionを呼び出す
// フロントUI自体が存在しない）。
const DEFAULT_ALLOWED_ORIGINS = [
  "https://nanami96.github.io",
  "http://localhost:5173",
];

function resolveAllowedOrigins() {
  const raw = Deno.env.get("CONCUR_OAUTH_CHECK_ALLOWED_ORIGINS");
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

// handleConcurOAuthCheckRequest.js（Deno非依存の純粋関数）へ渡す、Deno/Supabase
// 固有のI/O実装をまとめて用意する。他のEdge Functionのbuild*Adapters()と
// 同じ役割（呼び出し元のAuthorizationヘッダーをそのまま上書きしたSupabase
// クライアントを作り、auth.getUser()・rpc("is_platform_admin")をRLS/
// SECURITY DEFINER任せで行う。service_roleは使わない）。
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
        // トークン本体・メールアドレス・ユーザーIDは出さない。
        log(`認証詳細 (getUserエラー: status=${error.status ?? "?"}, code=${error.code ?? "?"})`);
        return null;
      }
      if (!data?.user) {
        log("認証詳細 (getUserは成功したがuserが空)");
        return null;
      }
      return data.user;
    },
    // 引数のuserは使わない：is_platform_admin()はauth.uid()（＝呼び出し元の
    // JWTから解決される、fetchUser()が返したのと同じユーザー）を内部で
    // 参照するSECURITY DEFINER関数のため、ここで改めてuser.idを渡す必要が
    // 無い（resolveConcurOAuthCheckAuthorization.jsとの互換性のため引数自体は残す）。
    isPlatformAdmin: async () => {
      const { data, error } = await supabase.rpc("is_platform_admin");
      if (error) {
        log(`platform_admin判定エラー (code=${error.code ?? "?"})`);
        return false;
      }
      return data === true;
    },
  };
}

function buildConcurEnv() {
  return {
    // CONCUR_REFRESH_TOKENはここに含めない。Refresh TokenはSupabase Vaultに
    // 保存されており、buildVaultAdapters()経由のRPC呼び出しでのみ取得する
    // （resolveConcurOAuthConfig.js・refreshConcurAccessToken.js冒頭コメント参照）。
    CONCUR_CLIENT_ID: Deno.env.get("CONCUR_CLIENT_ID"),
    CONCUR_CLIENT_SECRET: Deno.env.get("CONCUR_CLIENT_SECRET"),
    CONCUR_TOKEN_URL: Deno.env.get("CONCUR_TOKEN_URL"),
    CONCUR_SCOPE: Deno.env.get("CONCUR_SCOPE"),
    CONCUR_OAUTH_CHECK_ENABLED: Deno.env.get("CONCUR_OAUTH_CHECK_ENABLED"),
  };
}

// service_role専用クライアント（クライアント分離のB。ファイル冒頭コメント
// 参照）。Vault関連の2 RPCだけに使う。呼び出し元のAuthorizationヘッダーは
// 一切使わない・上書きしない（service role keyそのものが権限の根拠となる）。
function buildServiceRoleClient(createClient) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

// get_concur_refresh_token_for_edge / complete_concur_oauth_refresh
// （supabase/schema.sql Phase 12）を、handleConcurOAuthCheckRequest.jsが
// 期待するDeno非依存のインターフェースへ変換するアダプタ。
function buildVaultAdapters(serviceClient, log) {
  return {
    getRefreshTokenForEdge: async ({ companyId }) => {
      const { data, error } = await serviceClient.rpc("get_concur_refresh_token_for_edge", {
        p_company_id: companyId ?? null,
      });

      if (error) {
        // RPCのエラーコード（例："42501" 権限不足等）だけを記録し、詳細な
        // メッセージ・値は出さない。
        log(`Vault Token取得エラー (code=${error.code ?? "?"})`);
        throw error;
      }

      // returns table(...) の関数はsupabase-jsから配列で返る（0行の場合は
      // 空配列。get_my_public_config()等、既存の他RPCと同じ扱い）。
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
  };
}

Deno.serve(async (req) => {
  // 他のEdge Functionと同じ最小限のログ方針：requestIdで1リクエスト分を
  // まとめて追え、elapsedで経過時間(ms)が分かる。Secrets・トークン本体・
  // リクエスト本文は一切出さない。
  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const log = (stage) => {
    console.log(`[check-concur-oauth:${requestId}] ${stage} (+${Date.now() - startedAt}ms)`);
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
    // service_role専用クライアントはplatform_admin確認の成否に関わらずここで
    // 用意するが（既存の他Edge Functionのbuild*Adapters()と同じ「アダプタは
    // 常に用意し、実際に使うかどうかはハンドラー内部のロジックに委ねる」構成）、
    // 実際にVault RPCが呼ばれるのは、handleConcurOAuthCheckRequest.js内部で
    // platform_admin確認・安全ゲート確認の両方を通過した場合だけである。
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
  log(`OAuth check enabled=${isConcurOAuthCheckEnabled(env)}`);

  const { status, body } = await handleConcurOAuthCheckRequest({
    method: req.method,
    authHeader,
    fetchUser: authAdapters.fetchUser,
    isPlatformAdmin: authAdapters.isPlatformAdmin,
    env,
    companyId: null, // 現時点では単一の既定接続のみ（複数会社対応は将来の拡張）。
    getRefreshTokenForEdge: vaultAdapters.getRefreshTokenForEdge,
    completeOAuthRefresh: vaultAdapters.completeOAuthRefresh,
  });

  log(`終了 (status=${status}, errorCode=${body?.error?.code ?? "none"})`);

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
