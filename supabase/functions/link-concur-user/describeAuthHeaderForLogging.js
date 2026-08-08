// index.tsのログ用に、Authorizationヘッダーの中身（トークン本体）を一切含まない
// 要約だけを作る純粋関数。他のEdge Function（create-concur-quick-expense等）と
// 同じ内容（ヘッダーの有無・Bearer形式かどうか・トークンの文字数）を、
// このFunction専用に複製している（既存方針。ocr-receipt/index.ts参照）。
export function describeAuthHeaderForLogging(authHeader) {
  if (!authHeader) {
    return "Authorizationヘッダーなし";
  }

  const isBearerFormat = /^Bearer\s+.+/i.test(authHeader);
  const tokenLength = authHeader.replace(/^Bearer\s+/i, "").length;
  return `Authorizationヘッダーあり, Bearer形式=${isBearerFormat}, トークン長=${tokenLength}`;
}
