// Concur Identity API（GET /profile/identity/v4/Users）で、指定された
// ConcurログインID（userName）に対応する利用者を検索する、platform_admin
// 専用のSupabase Edge Function。
//
// 【位置づけ・重要】
// 既存の「Concurに登録」ボタン・create-concur-quick-expense（Quick Expense
// スタブ）・check-concur-oauth（OAuth疎通確認）とは一切接続していない、
// 完全に独立したFunctionである。一般利用者・company_admin（会社の管理画面
// 利用者）はこのFunctionを呼び出せない（platform_adminだけに制限。
// resolveLookupConcurUserAuthorization.js参照）。
//
// 【今回のスコープ（重要）】
// 迷子ボット利用者とConcur利用者を恒久的に対応付けるDB設計はまだ行っていない
// （company_members・concur_oauth_connections等、既存スキーマにその
// ような列は存在しない。docs/supabase-setup.md参照）。今回は検証用として、
// platform_adminが検索対象のConcurログインIDを直接入力する一時的な
// 検索ツールとして実装する。入力値をDBへ保存する処理は一切行わない。
//
// 通常は何もしない（安全ゲート）：
// CONCUR_IDENTITY_LOOKUP_ENABLEDというSecretが厳密に文字列"true"でない限り、
// Vault RPC・token endpoint・Identity APIへの実通信は一切発生せず、
// { found: false, status: "disabled" } を返すだけの「呼び出しても安全な」
// 状態になっている（isConcurIdentityLookupEnabled.js・
// handleLookupConcurUserRequest.js参照）。今回のコミット時点ではこの
// Secret自体を登録していないため、実際にはデプロイしても常にdisabled状態。
//
// 認証について（check-concur-oauthと同じ3段階の認証境界＋platform_admin確認）：
//   1. Supabaseプラットフォーム自体のverify_jwt（supabase/config.tomlで
//      この関数専用にtrueを明示）が、JWTとして解釈できないAuthorization
//      ヘッダーを持つリクエストを、このコードが実行される前に拒否する。
//   2. この関数自身（index.ts）もauth.getUser()を呼び、実際にログイン中
//      ユーザーが解決できるかを確認する。
//   3. 既存のis_platform_admin()（supabase/schema.sql、Phase 8）を
//      supabase.rpc()経由で呼び出し、platform_adminでなければforbiddenとする。
//      フロントから送られたrole相当の値・request bodyの内容は一切受け取らない・
//      信用しない。
//
// 【重要・クライアントの分離（check-concur-oauthと同じ設計）】
// このFunctionはSupabaseクライアントを用途ごとに2つ明確に分ける。
//   A. 呼び出し元JWTクライアント（buildAuthAdapters）：auth.getUser()・
//      is_platform_admin()の確認だけに使う。
//   B. service_role専用クライアント（buildVaultAdapters）：
//      get_concur_refresh_token_for_edge / complete_concur_oauth_refresh
//      というVault関連の2 RPCだけに使う（既存のRPCをそのまま再利用し、
//      新しいRPC・DB migrationは一切行っていない）。この2 RPCはSQL側で
//      service_role以外へのEXECUTE権限を持たないため、呼び出し元JWT
//      クライアント（A）から呼んでも失敗する。
//   service_role key（SUPABASE_SERVICE_ROLE_KEY）はEdge Functionへ自動注入
//   済みの環境変数であり、新たなSecret登録は不要。フロントへ返す・ログへ
//   出すことは一切行わない。
//
// ログについて：Authorizationヘッダー・JWT・リクエスト本文（userNameを含む）・
// Secrets（Client ID/Secret・Access/Refresh Token・token endpoint URL・
// service role key）・Concur Identity APIの生レスポンス・利用者プロフィール
// （氏名・メールアドレス等）は一切ログへ出さない。ヘッダーの有無・形式、
// 認証・認可の成否、安全ゲートが有効かどうか、最終的な内部コードだけを
// 記録する。
import { handleLookupConcurUserRequest } from "./handleLookupConcurUserRequest.js";
import { describeAuthHeaderForLogging } from "./describeAuthHeaderForLogging.js";
import { isConcurIdentityLookupEnabled } from "./isConcurIdentityLookupEnabled.js";

// ブラウザから直接このEdge Functionを叩けるオリジンの許可リスト
// （他のEdge Functionと同じ考え方・同じ既定値。専用のSecret名にしているのは
// 将来別々の許可設定を持てるようにするため）。
const DEFAULT_ALLOWED_ORIGINS = [
  "https://nanami96.github.io",
  "http://localhost:5173",
];

function resolveAllowedOrigins() {
  const raw = Deno.env.get("CONCUR_IDENTITY_LOOKUP_ALLOWED_ORIGINS");
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

// handleLookupConcurUserRequest.js（Deno非依存の純粋関数）へ渡す、Deno/Supabase
// 固有のI/O実装をまとめて用意する（check-concur-oauth/index.tsのbuildAuthAdapters
// と同じ役割・同じ実装）。
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
    CONCUR_CLIENT_ID: Deno.env.get("CONCUR_CLIENT_ID"),
    CONCUR_CLIENT_SECRET: Deno.env.get("CONCUR_CLIENT_SECRET"),
    CONCUR_TOKEN_URL: Deno.env.get("CONCUR_TOKEN_URL"),
    CONCUR_SCOPE: Deno.env.get("CONCUR_SCOPE"),
    CONCUR_IDENTITY_LOOKUP_ENABLED: Deno.env.get("CONCUR_IDENTITY_LOOKUP_ENABLED"),
  };
}

// service_role専用クライアント（クライアント分離のB）。Vault関連の2 RPCだけに
// 使う。呼び出し元のAuthorizationヘッダーは一切使わない・上書きしない。
function buildServiceRoleClient(createClient) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

// get_concur_refresh_token_for_edge / complete_concur_oauth_refresh
// （supabase/schema.sql Phase 12、check-concur-oauthと共有する既存RPC）を、
// handleLookupConcurUserRequest.jsが期待するDeno非依存のインターフェースへ
// 変換するアダプタ。
function buildVaultAdapters(serviceClient, log) {
  return {
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
  };
}

// request bodyをJSONとして読み取る。空・不正なJSONの場合は例外にせず空
// オブジェクトへフォールバックし、後段のvalidateConcurIdentityLookupRequest.js側で
// 「userNameが無い」として一律concur_identity_invalid_requestになるようにする
// （パースエラーの詳細を外部へ出さない）。
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
    console.log(`[lookup-concur-user:${requestId}] ${stage} (+${Date.now() - startedAt}ms)`);
  };

  const origin = req.headers.get("origin") ?? "";
  const corsHeaders = buildCorsHeaders(origin);

  log("Function開始");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const authHeader = req.headers.get("authorization");
  log(`認証情報 (${describeAuthHeaderForLogging(authHeader)})`);

  // request bodyはPOSTの場合だけ読む（OPTIONSは上で既に処理済み。
  // メソッド自体の妥当性はhandleLookupConcurUserRequest.js側でも
  // 再確認するため、ここでは単に「POSTなら読む」だけでよい）。
  const body = req.method === "POST" ? await parseRequestBody(req) : null;

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
  log(`Identity lookup enabled=${isConcurIdentityLookupEnabled(env)}`);

  const { status, body: responseBody } = await handleLookupConcurUserRequest({
    method: req.method,
    authHeader,
    body,
    fetchUser: authAdapters.fetchUser,
    isPlatformAdmin: authAdapters.isPlatformAdmin,
    env,
    companyId: null, // 現時点では単一の既定接続のみ（複数会社対応は将来の拡張）。
    getRefreshTokenForEdge: vaultAdapters.getRefreshTokenForEdge,
    completeOAuthRefresh: vaultAdapters.completeOAuthRefresh,
  });

  log(`終了 (status=${status}, errorCode=${responseBody?.error?.code ?? "none"})`);

  return new Response(JSON.stringify(responseBody), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
