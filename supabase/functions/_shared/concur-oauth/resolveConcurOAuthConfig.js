// Concur OAuth（Refresh Token Grant）に必要なSupabase Secretsの読取・
// 設定確認だけを担当する、Deno固有のAPIに一切依存しない純粋関数。
//
// 実際にDeno.env.get()を呼ぶのは、この関数の呼び出し元（各Edge Function側の
// 配線）であり、このファイル自身は「envという名前で渡された値の集合」を
// 検証するだけに留める。これによりNode/vitestから直接テストできる
// （supabase/functions/*/describeAuthHeaderForLogging.js等、このプロジェクト
// 全体で踏襲している既存の方針と同じ）。
//
// 参照するSecret名（実値はこの関数の引数として渡されるだけで、このファイル
// 自体はいかなる実値もハードコードしない）：
//   - CONCUR_CLIENT_ID      （必須）
//   - CONCUR_CLIENT_SECRET  （必須）
//   - CONCUR_REFRESH_TOKEN  （必須）
//   - CONCUR_TOKEN_URL      （必須。未設定の場合、既定URLへのフォールバックは
//                             行わない。誤った本番/検証環境への通信を避けるため、
//                             安全側でconfigured:falseとして失敗させる。加えて、
//                             値が設定されていても、解釈可能なURLでない場合・
//                             スキームがhttps以外の場合も同様にconfigured:false
//                             として扱う。本番のClient Secret・Refresh Tokenを
//                             平文で送信するリクエストのため、http（暗号化なし）
//                             宛先を許してしまうと盗聴リスクになる。ローカル開発・
//                             テスト用にlocalhost等を特別扱いする例外は設けない
//                             （テストは常にfetch自体をモックへ差し替えるため、
//                             実際にこの関数のURL検証を経由してhttpへ通信する
//                             状況はそもそも存在しない）。
//   - CONCUR_SCOPE          （任意）
const REQUIRED_ENV_KEYS = [
  ["clientId", "CONCUR_CLIENT_ID"],
  ["clientSecret", "CONCUR_CLIENT_SECRET"],
  ["refreshToken", "CONCUR_REFRESH_TOKEN"],
  ["tokenUrl", "CONCUR_TOKEN_URL"],
];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// CONCUR_TOKEN_URLが「解釈可能なURLであり、かつhttpsであること」を確認する。
// URLとして解釈できない文字列（例："not-a-url"）や、http等の非暗号化
// スキームは、本番のClient Secret・Refresh Tokenを送信する宛先として
// 安全でないため、ここで弾く。
function isValidHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * @param {Record<string, string | undefined> | undefined} env
 *   CONCUR_CLIENT_ID等のSecret名をキーとした、解決済みの値の集合。
 * @returns {{ ok: true, config: { clientId: string, clientSecret: string, refreshToken: string, tokenUrl: string, scope?: string } } | { ok: false, missing: string[] }}
 */
export function resolveConcurOAuthConfig(env) {
  const missing = [];
  const config = {};

  for (const [key, envName] of REQUIRED_ENV_KEYS) {
    const value = env?.[envName];
    if (isNonEmptyString(value)) {
      config[key] = value;
    } else {
      missing.push(envName);
    }
  }

  // CONCUR_TOKEN_URLは値の有無だけでなく、https URLとして解釈できることも
  // 確認する。不正な形式・非httpsの場合は「未設定」と同じ扱いにする
  // （呼び出し元へは区別を伝えない。いずれにせよ安全側でconfigured:falseに
  // すべき状況であることに変わりはないため）。
  if (isNonEmptyString(config.tokenUrl) && !isValidHttpsUrl(config.tokenUrl)) {
    delete config.tokenUrl;
    missing.push("CONCUR_TOKEN_URL");
  }

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  const scope = env?.CONCUR_SCOPE;
  if (isNonEmptyString(scope)) {
    config.scope = scope;
  }

  return { ok: true, config };
}
