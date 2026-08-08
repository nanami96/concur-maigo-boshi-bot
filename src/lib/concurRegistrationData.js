// 迷子防止Botの既存データ（会社情報・判定結果・OCR確認済みデータ）から、
// 将来Concurへ登録するための「迷子防止Bot内部のConcur登録用中間データ」を
// 1つにまとめて生成する統合関数。
//
// このファイルはConcur APIへの実通信・認証情報の使用を一切行わない
// （src/lib/concurExpenseData.jsと同じ純粋関数のみで構成）。生成する中間データも、
// Concur APIの実際のリクエストボディではなく、あくまで迷子防止Bot内部の
// 橋渡し用データである（concurExpenseData.js冒頭のコメント参照。Concur側の
// 正式なリクエストフィールドはまだ確定していないため、ここでは推測で作り込まない）。
//
// 経費タイプID＝Concur EXP_KEYという設計への正式リファクタリングにより、
// 以前ここにあった「Bot経費タイプID → Mapping → Concur Expense Type ID」という
// 変換ステップ（mapBotExpenseTypeToConcur()の呼び出し）を廃止した。
// judgmentResult.expenseType.id（config.expenseTypes[].idと同じ値）が、
// そのままConcur Quick Expense APIへ送るexpenseTypeIdである
// （src/admin/ExpenseTypeSettings.jsxの新規登録・編集画面が「Concur経費タイプ
// コード」として扱っているのと同じ値。詳細はそちらのコメント参照）。
// expenseTypeIdの必須チェック自体は、既存のbuildConcurExpenseData()/
// validateConcurExpenseData()（src/lib/concurExpenseData.js）が既に行っている
// （missing_expense_typeエラー）ため、ここで重複したチェックは追加しない。
//
// 既存の2つの関数の責務はそのまま再利用し、ここでは新しいバリデーション
// ロジックを増やさない（validation責務を分散させないため）：
//   - buildConcurExpenseData() / validateConcurExpenseData()
//       （src/lib/concurExpenseData.js）
//       … OCR結果・判定結果からtransactionDate/amount/currencyCode/
//         vendorName/receiptRequired/expenseTypeIdを組み立て・検証する。
//         このファイルでは再実装しない。
// このファイルが新たに追加する検証は、上記が関知しないcompanyId・policyId
// 自体の有無だけである。
//
// companyIdについて（重要・混同注意）：
// 現時点でフロント（BotConversation.jsx等）が実際に取得できるのは、
// Supabaseの内部UUID（companies.id）ではなく、会社を人が識別するための
// スラッグ（Supabase側の呼び方でいう company_code）だけである
// （get_my_public_config() RPCが返すのはcompany_codeのみで、UUIDはフロント
// へ渡っていない。supabase/schema.sql参照）。
// さらにややこしいことに、config.json/config_snapshot側（buildConfigFromFlow.js
// が組み立てる、questions/rules等と同じ設定オブジェクト。rules/sample-company/
// config.json参照）では、このスラッグは歴史的な事情（Supabase導入前の
// Excel/config.json時代の命名）により `company.company_id` というフィールド名
// で格納されている。「company_id」という名前だが中身はSupabaseのUUIDでは
// ない、という点を混同しないよう、このファイルの内部では一貫して
// 「companyCode」という変数名を使い、Supabase UUIDであるかのような実装は
// 一切行わない。将来Concur連携やバックエンド構成が変わり、別の識別子を
// 使う必要が出てきた場合も、影響はこのファイルの中（companyCodeの取り出し
// 部分、resolveCompanyCode()）だけに閉じ込まるようにする。
import { buildConcurExpenseData, validateConcurExpenseData } from "./concurExpenseData";

// 【重要・移行安全性】経費タイプID＝Concur EXP_KEYという設計は、既にConcur側の
// 正式なEXP_KEYへの移行が完了した会社にだけ適用してよい。移行前の会社
// （このコミット時点ではcompany-a・sample-companyを含む全社）は、経費タイプIDが
// 従来のBot内部の意味的スラッグ（例:"train_local"）のままであり、これを
// Concur expenseTypeIdとして送信すると誤った経費タイプへ登録されてしまう。
//
// 移行済みかどうかは、company.concurExpenseTypeIdMode（config_snapshot.company、
// つまりCompanySettings.jsxが編集するcompanyオブジェクトと同じ場所に置く）が
// 明示的に文字列"concur_exp_key"である場合だけ「移行済み」として扱う。
// 未設定・null・真偽値true・その他の文字列は全て「未移行」として扱う（安全側
// デフォルト）。経費タイプIDの見た目（数字かどうか・桁数・先頭ゼロの有無等）
// から移行済みかどうかを推測することは絶対に行わない（推測によるIDのフォーマット
// 判定は誤検知のリスクがあるため、必ず明示的なフラグだけを根拠にする）。
//
// このフラグを立てる管理画面UIは今回追加しない（誤って有効化されるリスクを
// 避けるため）。会社ごとに全経費タイプが実際にConcur EXP_KEYへ移行済みで
// あることを確認したうえで、config側（draft_configs.company_settingsまたは
// Excel生成前提のcompany_id/company_nameに追加する形）へ直接設定することを
// 想定している。
export function isExpenseTypeIdModeMigrated(company) {
  return company?.concurExpenseTypeIdMode === "concur_exp_key";
}

// company.company_id の実体はcompany_code（ファイル冒頭コメント参照）。
// 補完はせず、空文字・非文字列は「無し」として扱う。
function resolveCompanyCode(company) {
  const companyCode = company?.company_id ?? null;
  return typeof companyCode === "string" && companyCode.trim() !== "" ? companyCode : null;
}

// result.expenseType.policyIdをそのまま使う。値が無い場合に別のポリシーへ
// 差し替える・既定値を補うといったことは行わない（要件：明示的にエラーにする）。
function resolvePolicyId(result) {
  const policyId = result?.expenseType?.policyId ?? null;
  return typeof policyId === "string" && policyId.trim() !== "" ? policyId : null;
}

/**
 * 迷子防止Botの既存データから、Concur登録用の中間データを組み立てる。
 *
 * チェック順序（同時に複数の問題がある場合、最初に見つかった1件だけを返す。
 * 既存のvalidateConcurExpenseData()の呼び出しはその既存の優先順位をそのまま引き継ぐ）：
 *   1. companyId（company_code）なし → missing_company_id
 *   2. policyIdなし → missing_policy_id
 *   3. company.concurExpenseTypeIdModeが"concur_exp_key"でない（未移行の会社）
 *      → expense_type_id_not_migrated
 *   4. buildConcurExpenseData() + validateConcurExpenseData() による検証
 *      （利用日・金額・通貨・経費タイプ判定・領収書必須チェック）
 *
 * @param {object} [input]
 * @param {{ company_id?: string|null, company_name?: string|null }|null} [input.company]
 *   会社情報（BotConversation.jsxのconfig.companyと同じ形）。company_idの
 *   実体はcompany_code（ファイル冒頭コメント参照）。
 * @param {{ expenseType?: { id?: string, policyId?: string, receiptRequired?: boolean|null } }|null} [input.result]
 *   迷子防止Botの判定結果（src/engine/QuestionEngine.jsのgetResult()と同じ形。
 *   候補が複数（candidates）でまだ1件に絞られていない場合はexpenseTypeが
 *   無いため、経費タイプ未判定として扱われる）。
 * @param {{ transactionDate?: string|null, totalAmount?: number|null, currencyCode?: string|null, merchantName?: string|null }|null} [input.receiptData]
 *   OCR確認済みデータ（src/ReceiptOcrPanel.jsxのonConfirmが渡す形。
 *   buildConcurExpenseData()のocrResultと同じ）。
 * @param {File|null} [input.receiptFile]
 *   領収書ファイル自体。領収書必須チェック（既存のvalidateConcurExpenseData()）
 *   のためだけに使い、戻り値の中間データには含めない
 *   （要件：領収書画像自体は中間データに含めない）。
 * @param {string|null} [input.memo]
 *   利用者の自由入力コメント。現状UIに入力欄が無いため、指定が無ければ
 *   常にnull（ダミー文字列は生成しない）。
 * @param {string|null} [input.companyCode]
 *   【複数社所属対応・Commit 2で追加】現在選択中会社(currentCompany.companyCode。
 *   src/company/CompanyContext.jsx参照)を明示的に渡すためのオプション引数。
 *   指定時はcompany.company_id（config_snapshot内に埋め込まれた複製値。上記の
 *   「companyIdについて」参照）より優先してcompanyIdとして使う。省略時は
 *   既存どおりcompany.company_idへフォールバックする（後方互換）。
 *   Commit 2時点ではまだどのUIからもこの引数は渡していない
 *   （呼び出し側の配線・実際の複数社切替UIはCommit 3以降）。
 * @param {string|null} [input.concurLoginId]
 *   Concur Identity APIでuserIDを解決するためのConcurログインID。
 *   ConcurRegistrationPanel.jsxが用意する入力欄の値をそのまま渡す想定。
 *   このファイル自体は値の形式検証を行わない（禁止文字・長さ上限等の
 *   検証は、既存のIdentity検索と同じ基準をEdge Function側
 *   （supabase/functions/create-concur-quick-expense/validateQuickExpenseRequest.js）が
 *   担う。フロント側でバリデーションロジックを重複させないため）。
 *   未指定の場合、戻り値にconcurLoginIdキー自体を含めない
 *   （既存のtoEqualによる完全一致テストへ影響を与えないため）。
 *
 * @returns {{
 *   result: {
 *     companyId: string,
 *     policyId: string,
 *     expenseTypeId: string,
 *     transactionDate: string,
 *     amount: number,
 *     currencyCode: string,
 *     vendorName: string|null,
 *     receiptRequired: boolean|null,
 *     memo: string|null,
 *     concurLoginId?: string,
 *   } | null,
 *   error: { type: string, message: string } | null,
 * }}
 */
export function buildConcurRegistrationData({
  company,
  result,
  receiptData,
  receiptFile,
  memo,
  concurLoginId,
  companyCode,
} = {}) {
  const companyId =
    typeof companyCode === "string" && companyCode.trim() !== "" ? companyCode : resolveCompanyCode(company);
  if (!companyId) {
    return {
      result: null,
      error: { type: "missing_company_id", message: "会社を特定できませんでした。" },
    };
  }

  const policyId = resolvePolicyId(result);
  if (!policyId) {
    return {
      result: null,
      error: { type: "missing_policy_id", message: "ポリシーが判定されていません。" },
    };
  }

  if (!isExpenseTypeIdModeMigrated(company)) {
    return {
      result: null,
      error: {
        type: "expense_type_id_not_migrated",
        message: "この会社はConcur経費タイプコードへの移行が完了していないため、Concurへの登録はご利用いただけません。",
      },
    };
  }

  const expenseData = buildConcurExpenseData({
    ocrResult: receiptData,
    judgmentResult: result,
    receiptFile,
  });

  const { result: validatedExpenseData, error: expenseDataError } =
    validateConcurExpenseData(expenseData);

  if (expenseDataError) {
    return { result: null, error: expenseDataError };
  }

  return {
    result: {
      companyId,
      policyId,
      expenseTypeId: validatedExpenseData.expenseTypeId,
      transactionDate: validatedExpenseData.transactionDate,
      amount: validatedExpenseData.amount,
      currencyCode: validatedExpenseData.currencyCode,
      vendorName: validatedExpenseData.vendorName,
      receiptRequired: validatedExpenseData.receiptRequired,
      memo: typeof memo === "string" ? memo : null,
      ...(typeof concurLoginId === "string" ? { concurLoginId } : {}),
    },
    error: null,
  };
}
