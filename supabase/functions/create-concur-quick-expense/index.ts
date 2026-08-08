// Concur「Quick Expense」作成の入口となるSupabase Edge Function。
//
// 【重要・安全ゲートによる一括停止（CONCUR_QUICK_EXPENSE_ENABLED）】
// Vaultリース取得〜OAuth Refresh Token Grant〜Identity v4検索〜Quick Expense
// API本体という一連の実通信は、Secret CONCUR_QUICK_EXPENSE_ENABLEDが厳密に
// 文字列"true"である場合だけ実行される。この判断・DI（createQuickExpenseStub.js
// とcreateQuickExpenseViaConcur.jsのどちらを使うか）はすべて
// handleQuickExpenseRequest.js側（isConcurQuickExpenseEnabled.js）で完結して
// おり、このファイル（index.ts）はCONCUR_QUICK_EXPENSE_ENABLEDの値を
// buildConcurEnv()経由でそのまま転記するだけで、判断ロジックを一切持たない
// （Secretが未設定の限り、このFunctionは今までどおりcreateQuickExpenseStub.js
// による固定のダミー応答のみを返し、Concur・OAuth・Identityのいずれにも
// 実通信しない）。
//
// 認証について：
//   ocr-receipt/index.tsと同じ「Authorizationヘッダー確認 → auth.getUser() →
//   所属会社確認」の認証境界を実装している（実際の判定ロジックは
//   resolveQuickExpenseAuthorization.js、Deno固有のI/OはこのファイルのbuildAuthAdapters()
//   が担当。ocr-receipt/index.tsのresolveAuthorization()と同じ役割分担）。
//   ただし複数社所属対応（Commit 1）により、「所属会社確認」自体は
//   resolveQuickExpenseAuthorization.jsではなくhandleQuickExpenseRequest.js側で、
//   本文検証（＝companyIdが判明した後）に行うよう変更した（詳細は下記
//   companyId解決の実装について、およびhandleQuickExpenseRequest.jsの
//   処理順序コメント参照）。
//
//   companyId解決の実装について（重要・複数社所属対応で変更）：
//   リクエスト本文のcompanyIdは、フロント（src/lib/concurRegistrationData.js）が
//   一貫してcompany_code（人が識別するためのスラッグ。例："sample-company"）を
//   指すものとして生成している。一方、company_membersテーブルが持つのは
//   company_id（companies.idへのSupabase内部UUID）であり、company_codeでは
//   ない。この2つを取り違えて比較すると、正規のリクエストであっても
//   常に不一致（forbidden）になってしまう。そのため、fetchCompanyMembership()は
//   company_membersを直接読むのではなく、既存のget_my_public_config(p_company_code)
//   RPC（Phase 7、一般利用者Bot画面が既に使っている、roleを問わず所属会社の
//   company_codeを解決するSECURITY DEFINER関数。複数社所属対応でp_company_code
//   引数を追加した）へ、本文のcompanyIdをそのままp_company_codeとして渡す。
//   これにより、「auth.uid()がこのcompanyCodeへ実際に所属しているか」を
//   RPC自身がサーバー側で検証したうえでの結果だけを受け取る（未所属・
//   存在しない会社なら0行＝forbidden。詳細はresolveMembershipFromPublicConfigRow.js
//   参照）。1ユーザーが複数の会社へ所属できるようになったため、以前のように
//   「無引数のget_my_public_config()を呼び、返ってきた配列の先頭を無条件に
//   採用する」実装は行わない（フロントとバックエンドが別々に非決定的な
//   先頭行を解決し、たまたま一致すれば通ってしまう設計を避けるため）。
//
//   get_my_public_config(p_company_code)が返すconfig_snapshotには、同じ会社の
//   公開済み経費タイプ一覧（config_snapshot.expenseTypes）も含まれているため、
//   company_codeと同時にこれも取り出し、handleQuickExpenseRequest.js側で
//   policyId・expenseTypeId（＝Concur EXP_KEY）の検証
//   （verifyExpenseTypeForQuickExpense.js）に使う（フロントから送られた
//   これらの値もそのまま信用しない）。company_codeで絞り込んだ行から
//   取り出すため、他社（本文のcompanyId以外）の経費タイプ一覧が混ざることは
//   構造上ない。経費タイプID＝Concur EXP_KEYという設計への正式リファクタリング
//   により、以前存在した独立したConcur Expense Type Mapping
//   （config_snapshot.concur.expenseTypeMappings）は廃止した。
//   get_my_public_config()はこの所属確認・経費タイプ検証専用の責務のみを持ち、
//   company UUID（companies.id）は一切返さない（下記のVault会社境界解決の
//   設計レビュー参照）。
//
//   【重要・Vault会社境界解決（設計レビューにより最終決定）】
//   getRefreshTokenForEdge()（Concur OAuth Vault接続、supabase/schema.sql
//   Phase 12参照）が必要とする会社の識別子はcompanies.id（Supabase内部UUID）
//   であり、company_codeとは別の値空間。当初はget_my_public_config()の
//   戻り値へcompany_id列を追加する案を検討したが、(a)get_my_public_config()は
//   一般利用者Bot画面が毎回呼ぶ利用者向けRPCであり、Edge Function内部専用の
//   値を持ち込むべきではない、(b)既存のlist_my_companies()がcompany UUIDを
//   意図的に含めない最小metadata設計を採っており矛盾する、という理由で
//   採用しなかった。代わりに、Edge Function専用（service_roleのみEXECUTE可）
//   の新しいRPC resolve_concur_oauth_company_id(p_user_id, p_company_code)
//   （supabase/schema.sql Phase 12参照）を新設し、buildVaultAdapters()の
//   service_roleクライアントから、authAdapters.fetchUser()で検証済みの
//   ユーザーIDと本文のcompanyCodeを渡して解決する。company UUIDはブラウザへ
//   一切返らない（authenticatedへのgrantも無い）。以前はこの解決手段が無く、
//   getRefreshTokenForEdgeへは常にcompanyId: null（既定の共有接続）を渡して
//   いたため、複数社対応後は「A社のリクエストなのに別会社（または共有の
//   既定接続）のConcur OAuth接続を使ってしまう」cross-company混在のリスクが
//   あった（handleQuickExpenseRequest.js冒頭コメント参照）。
//
//   このEdge Functionは現状スタブ応答のみを返し、実際のConcurへのアクセス・
//   実データの作成を一切行わないが、認証自体は「実データを扱うようになって
//   から追加する」のではなく最初から必須にする（後回しにするとデプロイ後に
//   認証なしで公開される期間が生まれるため）。
//
// ログについて：Authorizationヘッダー・JWT・リクエスト本文全体・個人情報・
// 領収書画像・OCR結果は一切ログへ出さない（ocr-receipt/index.tsと同じ方針。
// Authorizationヘッダーの有無・形式・トークンの文字数だけを記録する。
// describeAuthHeaderForLogging.js参照）。
import { handleQuickExpenseRequest } from "./handleQuickExpenseRequest.js";
import { describeAuthHeaderForLogging } from "./describeAuthHeaderForLogging.js";
import { resolveMembershipFromPublicConfigRow } from "./resolveMembershipFromPublicConfigRow.js";

// ブラウザから直接このEdge Functionを叩けるオリジンの許可リスト
// （supabase/functions/ocr-receipt/index.tsと同じ考え方・同じ既定値。
// 専用のSecret名にしているのは、OCRとQuick Expenseで将来別々の許可設定を
// 持てるようにするため）。
const DEFAULT_ALLOWED_ORIGINS = [
  "https://nanami96.github.io",
  "http://localhost:5173",
];

function resolveAllowedOrigins() {
  const raw = Deno.env.get("CONCUR_QUICK_EXPENSE_ALLOWED_ORIGINS");
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
// ocr-receipt/index.tsのresolveProjectApiKey()と同じ理由・同じ実装
// （SUPABASE_PUBLISHABLE_KEYを優先し、無ければ従来名のSUPABASE_ANON_KEYへ
// フォールバック。どちらもEdge Functionへ毎回Supabase側が自動的に注入する
// 環境変数であり、Secretとして手動登録する必要は無い）。
function resolveProjectApiKey() {
  return Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
}

// Concur OAuth（_shared/concur-oauth/resolveConcurOAuthConfig.js）が読む
// Secret名の集合。supabase/functions/lookup-concur-user/index.tsの
// buildConcurEnv()と同様の実装。CONCUR_QUICK_EXPENSE_ENABLEDはこの
// Function専用の安全ゲート（isConcurQuickExpenseEnabled.js参照）で、値の
// 転記だけをここで行う。実際に「有効かどうか」を判断するロジックは
// handleQuickExpenseRequest.js側だけに置き、このファイル（index.ts）は
// 判断ロジックを一切持たない（ファイル冒頭コメント参照）。
function buildConcurEnv() {
  return {
    CONCUR_CLIENT_ID: Deno.env.get("CONCUR_CLIENT_ID"),
    CONCUR_CLIENT_SECRET: Deno.env.get("CONCUR_CLIENT_SECRET"),
    CONCUR_TOKEN_URL: Deno.env.get("CONCUR_TOKEN_URL"),
    CONCUR_SCOPE: Deno.env.get("CONCUR_SCOPE"),
    CONCUR_QUICK_EXPENSE_ENABLED: Deno.env.get("CONCUR_QUICK_EXPENSE_ENABLED"),
  };
}

// service_role専用クライアント（呼び出し元のAuthorizationヘッダーは一切
// 使わない・上書きしない）。get_concur_refresh_token_for_edge /
// complete_concur_oauth_refresh / resolve_concur_oauth_company_idという
// Vault関連の3 RPCだけに使う。supabase/functions/lookup-concur-user/
// index.tsのbuildServiceRoleClient()と同じ実装（これらのRPCはSQL側で
// service_role以外へのEXECUTE権限を持たない）。
function buildServiceRoleClient(createClient) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

// get_concur_refresh_token_for_edge / complete_concur_oauth_refresh
// （supabase/schema.sql Phase 12、check-concur-oauth・lookup-concur-userと
// 共有する既存RPC）と、resolve_concur_oauth_company_id（同じくPhase 12、
// このEdge Function専用の新設RPC。会社別Vault接続の会社境界解決だけに使う）を、
// handleQuickExpenseRequest.jsが期待するDeno非依存のインターフェースへ
// 変換するアダプタ。get_concur_refresh_token_for_edge・complete_concur_oauth_
// refreshの2つはsupabase/functions/lookup-concur-user/index.tsの
// buildVaultAdapters()と同じ実装（check-concur-oauth・lookup-concur-userは
// 引き続き会社非依存の既定接続company_id: nullを使い続けるため、この2つの
// RPC自体・呼び出し方は変更していない）。
function buildVaultAdapters(serviceClient, log) {
  return {
    // resolve_concur_oauth_company_id(p_user_id, p_company_code)は
    // service_roleのみEXECUTE可（supabase/schema.sql参照）。呼び出し元の
    // JWTコンテキストが無いservice_roleクライアントではauth.uid()が使えない
    // ため、userId（authAdapters.fetchUser()が既に検証済みの値）を明示的に
    // 渡す。戻り値は該当行が無ければNULL（Postgresの単一SELECT関数の標準的な
    // 挙動）で、supabase-jsからはスカラー値としてそのまま返る
    // （is_platform_admin()等と同じ扱い。returns tableではないため配列では
    // 返らない）。
    resolveOAuthCompanyId: async ({ userId, companyCode }) => {
      const { data, error } = await serviceClient.rpc("resolve_concur_oauth_company_id", {
        p_user_id: userId,
        p_company_code: companyCode,
      });

      if (error) {
        log(`Vault会社UUID解決エラー (code=${error.code ?? "?"})`);
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
  };
}

// handleQuickExpenseRequest.js（Deno非依存の純粋関数）へ渡す、Deno/Supabase
// 固有のI/O実装をまとめて用意する。ocr-receipt/index.tsのresolveAuthorization()
// と同じ役割（呼び出し元のAuthorizationヘッダーをそのまま上書きしたSupabase
// クライアントを作り、auth.getUser()・company_membersへのSELECTをRLS
// （company_members_select_own）任せで行う。service_roleは使わない）。
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
    // 【複数社所属対応・Commit 1で変更】引数のuserは使わない：
    // get_my_public_config(p_company_code)はauth.uid()（＝呼び出し元のJWTから
    // 解決される、fetchUser()が返したのと同じユーザー）を内部で参照する
    // SECURITY DEFINER関数のため、ここで改めてuser.idを渡す必要が無い
    // （呼び出しインターフェースはresolveQuickExpenseAuthorization.jsとの
    // 互換性のためそのまま残す）。
    //
    // companyCode（本文で申告されたcompanyId）は必須の第2引数として受け取り、
    // 必ずp_company_codeへそのまま渡す。以前はget_my_public_config()を無引数で
    // 呼び、返ってきた配列の先頭（data[0]）を無条件に採用していたが、これは
    // 「1ユーザー1社」だった時代の設計であり、1ユーザーが複数社へ所属できる
    // ようになった今、無引数のまま先頭行を採用する実装は「フロントとバック
    // エンドが別々に非決定的な先頭行を解決し、たまたま一致すれば通る」という
    // 危険な設計になる。p_company_codeを明示的に渡すことで、RPC自身が
    // 「auth.uid()がこのcompanyCodeへ実際に所属しているか」をサーバー側で
    // 検証したうえでの結果だけを返すようになる（未所属・存在しない会社なら
    // 0行）。
    fetchCompanyMembership: async (_user, companyCode) => {
      const { data, error } = await supabase.rpc("get_my_public_config", { p_company_code: companyCode });

      if (error) {
        throw error;
      }

      // get_my_public_config(p_company_code)はreturns tableのため、
      // supabase-jsからは常に配列で返る。company_codeを明示指定しているため、
      // company_members側のunique(company_id, user_id)制約により、
      // 該当行は0件または1件のいずれかにしかならない（複数社所属時でも
      // 「この特定の会社」への所属は高々1行）。
      const row = Array.isArray(data) ? data[0] : data;
      return resolveMembershipFromPublicConfigRow(row);
    },
  };
}

Deno.serve(async (req) => {
  // OCR（ocr-receipt/index.ts）と同じ最小限のログ方針：requestIdで1リクエスト
  // 分をまとめて追え、elapsedで経過時間(ms)が分かる。エラーコード以外の
  // 詳細（本文・ヘッダー値・トークン本体等）は出さない。
  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const log = (stage) => {
    console.log(`[create-concur-quick-expense:${requestId}] ${stage} (+${Date.now() - startedAt}ms)`);
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
    // Supabaseクライアントの生成自体が失敗するのは通常あり得ないが、
    // 万一の場合も例外の詳細はログへ出さない。
    console.error("auth client setup failed", caughtError?.message);
    log("失敗 (internal_error: auth setup)");
    return new Response(
      JSON.stringify({ result: null, error: { code: "internal_error", message: "処理中にエラーが発生しました。", details: [] } }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { status, body } = await handleQuickExpenseRequest({
    method: req.method,
    authHeader,
    parseBody: () => req.json(),
    fetchUser: authAdapters.fetchUser,
    fetchCompanyMembership: authAdapters.fetchCompanyMembership,
    env: buildConcurEnv(),
    resolveOAuthCompanyId: vaultAdapters.resolveOAuthCompanyId,
    getRefreshTokenForEdge: vaultAdapters.getRefreshTokenForEdge,
    completeOAuthRefresh: vaultAdapters.completeOAuthRefresh,
  });

  log(`終了 (status=${status}, errorCode=${body?.error?.code ?? "none"})`);

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
