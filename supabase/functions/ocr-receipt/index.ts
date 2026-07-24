// 「領収書読み取りPoC」用のSupabase Edge Function。
//
// 役割：React（ブラウザ）から受け取った領収書画像を、Azure AI Document
// Intelligence（prebuilt-receipt）へこのサーバー側からだけ送信し、日付・
// 支払先・金額など必要最小限のフィールドだけに正規化してフロントへ返す。
//
// なぜこの構成にしたか（セキュリティ最重要）：
//   このプロジェクトのフロントはReact/Vite + GitHub Pages（静的ホスティング、
//   サーバーサイドコード無し）で、フロントのVITE_環境変数はビルド後のJSに
//   そのまま埋め込まれ誰でも読める（既存のsrc/lib/supabaseClient.jsのコメント
//   にも明記の通り、フロントに置けるのは「anon/publishable key」だけという
//   既存方針がある）。Azure Document IntelligenceのAPIキーは強力な秘密鍵
//   であり、これをVITE_AZURE_*として埋め込む・ブラウザから直接Azureへ
//   リクエストすることは、キーが世界中に露出することを意味するため絶対に
//   行わない。
//   このプロジェクトは既にSupabaseを認証・DB基盤として全面的に使っており
//   （company_members・draft_configs等、既存のsupabase/schema.sql参照）、
//   Supabase Edge Functionsという「サーバー側で秘密鍵を安全に保持できる
//   実行環境」が既に自然に使える構成になっている。そのため
//     React → Supabase Edge Function（このファイル） → Azure
//   というサーバー側プロキシ構成を採用した。Azureの認証情報は
//   このEdge Function専用のSecret（AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT /
//   AZURE_DOCUMENT_INTELLIGENCE_KEY）としてSupabase側に保存し、
//   ブラウザには一切渡さない。
//
// 認証・権限（2026年時点のSupabaseキー体系を踏まえた設計）：
//   このプロジェクトのフロント（src/lib/supabaseClient.js）は、レガシーな
//   JWT形式のanon key（"eyJ..."）ではなく、新しいpublishable key
//   （"sb_publishable_..."）を使っている。publishable/secret keyはJWTでは
//   ない不透明なトークンであり、これ単体をAuthorizationヘッダーへ
//   Bearerとして渡しても、有効なJWTとして検証されることはない
//   （supabase-jsのFunctionsClientも、ログイン中セッションが無い場合は
//   新形式のキーをAuthorizationとして送らない設計になっている）。
//   一方、ログイン中ユーザーのアクセストークン（session.access_token）は
//   従来通り実体を持つJWTであり、supabase.functions.invoke()はセッションが
//   ある限りこれを自動的にAuthorizationヘッダーへ付与する
//   （src/data/ocrReceiptRepository.js参照。呼び出し側で明示的に扱う必要は無い）。
//
//   認証境界は3段階（判定ロジック本体はresolveOcrAuthorization.js、
//   Deno/Supabase固有のI/OはこのファイルのresolveAuthorization()が担当）：
//     1. Supabaseプラットフォーム自体のverify_jwt（supabase/config.tomlで
//        この関数専用にtrueを明示。config.toml冒頭のコメント参照）が、JWTとして
//        解釈できないAuthorizationヘッダー（publishable/secret keyそのもの・
//        出鱈目な文字列等）を持つリクエストを、この関数のコードが実行される
//        前に拒否する。
//     2. その上でこの関数自身（index.ts）も明示的に auth.getUser() を呼び、
//        実際にログイン中ユーザーが解決できるかを確認する（verify_jwtを
//        無効化してデプロイされた場合やローカル実行時にも同じ認証境界が
//        働くようにするための、プラットフォームに依存しない二重チェック）。
//     3. さらに、company_membersに1件も所属が無いユーザー（＝一度も招待コードで
//        会社に参加していないアカウント）は将来のコスト暴走・乱用を避けるため
//        拒否する。所属先の会社が具体的にどこかは問わない（OCR結果自体は
//        どの会社のデータにも紐付けず保存しないため、特定の1社に限定する必要が
//        無い）。
//   2・3のいずれもservice_role キーは一切使わない。既存のmembershipRepository.js
//   と同じ「プロジェクトキー + 呼び出し元のJWTをAuthorizationヘッダーへ上書き」
//   方式でSupabaseクライアントを作り、RLS（company_members_select_own）に
//   判定をそのまま委ねる（createClientへ渡す2引数目のキーはSupabase Auth
//   APIの`apikey`識別にのみ使われ、実際に`auth.uid()`を決めるのは明示的に
//   上書きしたAuthorizationヘッダー側であるため、渡すキーの新旧いずれの形式でも
//   この認証境界の安全性そのものは変わらない）。
//
// 画像・OCR結果の保存：
//   このEdge Functionは領収書画像を一切保存しない（Supabase Storage・DBの
//   どちらにも書き込まない）。Azureへ送るのは受け取ったリクエストボディの
//   バイト列そのものであり、レスポンスを正規化した後は画像・Azureの生JSONは
//   すべて破棄される（このリクエストのメモリ上にのみ一時的に存在する）。
//
// ポーリング設計：
//   Document Intelligenceの解析は非同期API（202 Accepted + Operation-Location
//   ヘッダーを返し、そのURLをポーリングする）のため、正式なAPI仕様に沿って
//   ポーリングする。無限ポーリングを避けるため、最大試行回数・ポーリング間隔・
//   全体のタイムアウト相当（試行回数×間隔）を固定値で設けている。
import { resolveOcrAuthorization } from "./resolveOcrAuthorization.js";

const AZURE_API_VERSION = "2024-11-30";
const AZURE_ANALYZE_PATH = `documentintelligence/documentModels/prebuilt-receipt:analyze?api-version=${AZURE_API_VERSION}`;

// Azure Document Intelligence Free(F0)tier・一般的なモバイル写真のサイズを
// 踏まえた、恣意的すぎない範囲の上限。大きすぎる画像はAzure側の処理時間・
// 失敗率を悪化させるため、Edge Function側で早期に弾く。
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_CONTENT_TYPE_PREFIX = "image/";

// ポーリング設定：無限ポーリング禁止のため、最大試行回数×間隔で
// 全体のタイムアウト相当（約24秒）を明示的に設ける。
const POLL_MAX_ATTEMPTS = 16;
const POLL_INTERVAL_MS = 1500;

// ブラウザから直接このEdge Functionを叩けるオリジンの許可リスト。
// ワイルドカードにしない理由：Authorizationヘッダー（ユーザーのJWT）を
// 送るリクエストのため、想定していない第三者サイトからの呼び出しを
// 積極的に許可する理由が無い。Secret（OCR_ALLOWED_ORIGINS、カンマ区切り）で
// 上書きできるようにし、既定値はこのプロジェクトの本番URL
// （docs/supabase-setup.mdに記載の実際のGitHub Pages URL）とローカル開発
// （Vite既定ポート）にしている。
const DEFAULT_ALLOWED_ORIGINS = [
  "https://nanami96.github.io",
  "http://localhost:5173",
];

function resolveAllowedOrigins() {
  const raw = Deno.env.get("OCR_ALLOWED_ORIGINS");
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

function jsonResponse(status, body, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(status, code, message, corsHeaders) {
  return jsonResponse(status, { error: { code, message } }, corsHeaders);
}

// Supabaseへ渡すプロジェクトキー（createClientの第2引数、apikey識別用）。
// SUPABASE_PUBLISHABLE_KEYを優先し、無ければ従来名のSUPABASE_ANON_KEYへ
// フォールバックする。どちらもEdge Functionへは毎回Supabase側が自動的に
// 注入する環境変数であり、Secretとして手動登録する必要は無い（26節参照）。
// このコードはどちらの名前で来ても・どちらの形式（レガシーJWT/新publishable
// key）でも同じように動く（上のコメント参照：apikeyはAuthorizationとは
// 別役割のため）。
function resolveProjectApiKey() {
  return Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
}

async function resolveAuthorization(authHeader) {
  const { createClient } = await import("npm:@supabase/supabase-js@2");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const projectApiKey = resolveProjectApiKey();

  // 呼び出し元のAuthorizationヘッダーをそのまま上書きする。company_members
  // 等へのアクセスは、このヘッダーから解決されるauth.uid()に対する既存RLS
  // （company_members_select_own）でのみ許可される。service_roleは使わない。
  const supabase = createClient(supabaseUrl, projectApiKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  return resolveOcrAuthorization({
    authHeader,
    fetchUser: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data?.user) {
        return null;
      }
      return data.user;
    },
    hasCompanyMembership: async (user) => {
      // company_membersに1件も所属が無い（＝招待コードで一度も会社に参加して
      // いない）アカウントは、将来の乱用・コスト暴走を避けるため対象外とする。
      // どの会社に所属しているかは問わない（OCR結果は会社データに紐付けて
      // 保存しないため、特定の1社に限定する必要が無い）。
      const { data, error } = await supabase
        .from("company_members")
        .select("id")
        .eq("user_id", user.id)
        .limit(1);
      return !error && Array.isArray(data) && data.length > 0;
    },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function analyzeReceipt(imageBytes, contentType) {
  const endpoint = Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");
  const apiKey = Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_KEY");

  if (!endpoint || !apiKey) {
    return { outcome: "misconfigured" };
  }

  const analyzeUrl = new URL(AZURE_ANALYZE_PATH, endpoint.endsWith("/") ? endpoint : `${endpoint}/`);

  const analyzeResponse = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": contentType,
    },
    body: imageBytes,
  });

  if (analyzeResponse.status !== 202) {
    // Azure側のエラー本文には診断コード等が含まれるため、原因調査用に
    // ステータスコードだけをログへ残し、画像やAzureの生レスポンス本文は
    // ログへ出さない（本番ログへ機密情報・個人情報を出さないため）。
    console.error("azure analyze request failed", analyzeResponse.status);
    return { outcome: "azure_error" };
  }

  const operationLocation = analyzeResponse.headers.get("operation-location");
  if (!operationLocation) {
    console.error("azure analyze response missing operation-location header");
    return { outcome: "azure_error" };
  }

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);

    const pollResponse = await fetch(operationLocation, {
      headers: { "Ocp-Apim-Subscription-Key": apiKey },
    });

    if (!pollResponse.ok) {
      console.error("azure poll request failed", pollResponse.status);
      return { outcome: "azure_error" };
    }

    const pollBody = await pollResponse.json();

    if (pollBody.status === "succeeded") {
      return { outcome: "succeeded", analyzeResult: pollBody.analyzeResult };
    }

    if (pollBody.status === "failed") {
      console.error("azure analysis failed", pollBody?.error?.code);
      return { outcome: "analysis_failed" };
    }
    // "notStarted" | "running" はそのままポーリング継続。
  }

  return { outcome: "timeout" };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const corsHeaders = buildCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "許可されていないメソッドです。", corsHeaders);
  }

  const authHeader = req.headers.get("authorization");

  let authResult;
  try {
    authResult = await resolveAuthorization(authHeader);
  } catch (caughtError) {
    console.error("auth resolution failed", caughtError?.message);
    return errorResponse(500, "unknown", "認証の確認中にエラーが発生しました。", corsHeaders);
  }

  if (authResult.outcome === "unauthorized") {
    return errorResponse(
      401,
      "unauthorized",
      "ログインの有効期限が切れている可能性があります。再度ログインしてください。",
      corsHeaders,
    );
  }

  if (authResult.outcome === "forbidden") {
    return errorResponse(
      403,
      "forbidden",
      "この機能を利用するには、会社への参加（招待コードの入力）が必要です。",
      corsHeaders,
    );
  }

  let formData;
  try {
    formData = await req.formData();
  } catch (caughtError) {
    return errorResponse(400, "bad_request", "リクエストの形式が不正です。", corsHeaders);
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    return errorResponse(400, "invalid_file", "領収書の画像が選択されていません。", corsHeaders);
  }

  if (!file.type || !file.type.startsWith(ALLOWED_CONTENT_TYPE_PREFIX)) {
    return errorResponse(
      400,
      "invalid_file",
      "対応していないファイル形式です。画像ファイル（JPEG/PNG等）を選択してください。",
      corsHeaders,
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return errorResponse(
      400,
      "invalid_file",
      `ファイルサイズが大きすぎます（上限${Math.floor(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB）。`,
      corsHeaders,
    );
  }

  const imageBytes = new Uint8Array(await file.arrayBuffer());

  let analysis;
  try {
    analysis = await analyzeReceipt(imageBytes, file.type);
  } catch (caughtError) {
    console.error("azure request threw", caughtError?.message);
    return errorResponse(502, "azure_error", "領収書の解析中にエラーが発生しました。", corsHeaders);
  }

  if (analysis.outcome === "misconfigured") {
    console.error("azure secrets are not configured");
    return errorResponse(500, "unknown", "現在この機能を利用できません。しばらくしてから再度お試しください。", corsHeaders);
  }

  if (analysis.outcome === "azure_error") {
    return errorResponse(502, "azure_error", "領収書の解析中にエラーが発生しました。しばらくしてから再度お試しください。", corsHeaders);
  }

  if (analysis.outcome === "analysis_failed") {
    return errorResponse(
      422,
      "analysis_failed",
      "領収書を読み取れませんでした。画像の向き・明るさを確認し、もう一度お試しください。",
      corsHeaders,
    );
  }

  if (analysis.outcome === "timeout") {
    return errorResponse(504, "timeout", "解析に時間がかかりすぎたため中断しました。もう一度お試しください。", corsHeaders);
  }

  const { normalizeReceiptAnalyzeResult } = await import("./normalizeReceiptResult.js");
  const normalized = normalizeReceiptAnalyzeResult(analysis.analyzeResult);

  return jsonResponse(200, normalized, corsHeaders);
});
