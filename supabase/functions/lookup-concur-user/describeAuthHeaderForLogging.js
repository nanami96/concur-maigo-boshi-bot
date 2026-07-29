// index.tsのログ用に、Authorizationヘッダーの中身（トークン本体）を一切含まない
// 要約だけを作る純粋関数。supabase/functions/check-concur-oauth/
// describeAuthHeaderForLogging.js・supabase/functions/create-concur-quick-expense/
// describeAuthHeaderForLogging.jsと同一内容（各Edge Functionは自身の
// ディレクトリだけが独立してデプロイバンドルされるため、この程度の小さな
// 純粋関数はディレクトリをまたいでimportせず複製する、という既存プロジェクトの
// 方針を踏襲している）。
export function describeAuthHeaderForLogging(authHeader) {
  if (!authHeader) {
    return "Authorizationヘッダーなし";
  }

  const isBearerFormat = /^Bearer\s+.+/i.test(authHeader);
  const tokenLength = authHeader.replace(/^Bearer\s+/i, "").length;
  return `Authorizationヘッダーあり, Bearer形式=${isBearerFormat}, トークン長=${tokenLength}`;
}
