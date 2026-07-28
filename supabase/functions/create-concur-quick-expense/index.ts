// Concur「Quick Expense」作成の入口となるSupabase Edge Function。
//
// 現時点ではConcur APIへの実通信を一切行わない。実際に必要になるのは
// createQuickExpenseStub.js（handleQuickExpenseRequest.jsが呼び出す）の
// 中身だけであり、このファイル・入力検証（validateQuickExpenseRequest.js）・
// 処理の流れ（handleQuickExpenseRequest.js）・認証
// （resolveQuickExpenseAuthorization.js）は変更不要な設計にしている。
//
// 認証について：
//   ocr-receipt/index.tsと同じ「Authorizationヘッダー確認 → auth.getUser() →
//   company_members所属確認」の認証境界を実装している（実際の判定ロジックは
//   resolveQuickExpenseAuthorization.js、Deno固有のI/OはこのファイルのbuildAuthAdapters()
//   が担当。ocr-receipt/index.tsのresolveAuthorization()と同じ役割分担）。
//   さらに、認証済みユーザーが実際に所属する会社と、リクエスト本文の
//   companyIdが一致するかもhandleQuickExpenseRequest.js側で確認する
//   （フロントから渡された値を認証の根拠にしない）。
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

// handleQuickExpenseRequest.js（Deno非依存の純粋関数）へ渡す、Deno/Supabase
// 固有のI/O実装をまとめて用意する。ocr-receipt/index.tsのresolveAuthorization()
// と同じ役割（呼び出し元のAuthorizationヘッダーをそのまま上書きしたSupabase
// クライアントを作り、auth.getUser()・company_membersへのSELECTをRLS
// （company_members_select_own）任せで行う。service_roleは使わない）。
async function buildAuthAdapters(authHeader, log) {
  const { createClient } = await import("npm:@supabase/supabase-js@2");

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
    fetchCompanyMembership: async (user) => {
      // company_membersはuser_idにunique制約があるため（1ユーザー1社、
      // supabase/schema.sql参照）、該当行は最大1件。既存の
      // src/data/membershipRepository.jsのfetchMyRole()と同じ
      // .maybeSingle()を使う。
      const { data, error } = await supabase
        .from("company_members")
        .select("company_id, role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        throw error;
      }
      return data ?? null;
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
  try {
    authAdapters = await buildAuthAdapters(authHeader, log);
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
  });

  log(`終了 (status=${status}, errorCode=${body?.error?.code ?? "none"})`);

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
