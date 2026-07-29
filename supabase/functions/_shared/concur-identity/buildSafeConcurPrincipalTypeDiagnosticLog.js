// 【一時的なデバッグログ・要削除】Concur OAuth token応答のid_token（OIDCのJWT）から、
// principal種別を示す`concur.type`クレームの有無・安全化した値だけを一時診断
// ログ用に組み立てる純粋関数。401原因切り分け（Access Tokenがcompany-level
// かuser-levelかの参考情報を得るため）だけに使う。
//
// 【重要・この関数の位置づけについて】
// - ここで行うデコードは、診断のためにJWTのpayload（本文）部分を読み取る
//   だけであり、署名検証は一切行わない。したがって、この関数の戻り値を
//   「署名検証済みの認証根拠」として扱ってはならない。呼び出し元でも、
//   認証・認可の判定やIdentity API/Quick Expense呼び出しの分岐に使用しない
//   こと（あくまで人間が後からログを見て判断するための参考情報）。
// - id_token全体・JWTのheader部分・payload全体・concur.type以外のclaim名/
//   claim値は一切戻り値に含めない（concur.typeクレームの有無と安全化済みの
//   値だけを返す）。
// - Access Token・Refresh Token・Client Secretはこの関数の入力にも出力にも
//   一切関係しない（この関数が受け取るのはid_tokenだけであり、それ以外の
//   トークン種別を渡してはならない）。
// - デコードはEdge Function内部のグローバルAPI（atob・TextDecoder）だけで
//   完結し、外部サービス（jwt.io等）へのデータ送信は一切行わない。
// - JWTとして不正・Base64URLデコード失敗・JSON解析失敗・claim欠落等、
//   あらゆる異常時も例外を投げず、安全な真偽値・"unknown"を返す。
//
// デバッグが終わったら、この関数自体と呼び出し箇所
// （handleLookupConcurUserRequest.js）を削除すること。

const MAX_CONCUR_TYPE_LENGTH = 50;
const SAFE_CONCUR_TYPE_PATTERN = /^[A-Za-z0-9_-]+$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// JWTの第2セグメント（payload）をBase64URLデコードし、UTF-8文字列へ変換する。
// atob・TextDecoderはDeno・Node（vitest実行環境）双方のグローバルAPIで、
// 外部通信を一切伴わない。
function base64UrlDecodeToString(segment) {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binaryString = atob(padded);
  const bytes = Uint8Array.from(binaryString, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

// concur.typeクレームの値を安全化する。想定外の構造・危険そうな値なら
// nullへ丸める（生の値をそのままログへ出さない）。
function sanitizeConcurType(rawValue) {
  if (typeof rawValue !== "string") {
    return null;
  }
  const trimmed = rawValue.trim();
  if (trimmed === "" || trimmed.length > MAX_CONCUR_TYPE_LENGTH) {
    return null;
  }
  if (!SAFE_CONCUR_TYPE_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * @param {object} input
 * @param {string | null | undefined} input.idToken OAuth tokenレスポンスのid_token（JWT）。
 * @returns {{
 *   stage: "concur_principal_type_diagnostic",
 *   idTokenPresent: boolean,
 *   payloadParsed: boolean,
 *   concurTypePresent: boolean,
 *   concurType: string,
 * }}
 */
export function buildSafeConcurPrincipalTypeDiagnosticLog({ idToken }) {
  const idTokenPresent = isNonEmptyString(idToken);

  if (!idTokenPresent) {
    return {
      stage: "concur_principal_type_diagnostic",
      idTokenPresent: false,
      payloadParsed: false,
      concurTypePresent: false,
      concurType: "unknown",
    };
  }

  const segments = idToken.split(".");
  let payload = null;
  let payloadParsed = false;

  if (segments.length >= 2) {
    try {
      const decoded = base64UrlDecodeToString(segments[1]);
      const parsed = JSON.parse(decoded);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed;
        payloadParsed = true;
      }
    } catch {
      payloadParsed = false;
    }
  }

  const sanitizedConcurType = payloadParsed ? sanitizeConcurType(payload["concur.type"]) : null;

  return {
    stage: "concur_principal_type_diagnostic",
    idTokenPresent: true,
    payloadParsed,
    concurTypePresent: sanitizedConcurType !== null,
    concurType: sanitizedConcurType ?? "unknown",
  };
}
