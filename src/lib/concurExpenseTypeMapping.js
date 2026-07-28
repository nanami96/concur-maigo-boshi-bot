// 迷子防止Bot内部の経費タイプID（config.expenseTypes[].id、
// src/lib/concurExpenseData.jsのexpenseTypeIdと同じ値）を、Concur側の
// 経費タイプ識別子へ変換するための設計（マッピングのルックアップのみ）。
//
// 実際のConcur API通信・認証情報の使用・Supabase Edge Function・既存UIとの
// 接続は一切行わない（src/data/concurApi.jsとも接続しない）、純粋関数のみの
// ファイル。
//
// 名称についての注意（重要）：
// Concur側の経費タイプ取得API・正式なフィールド名はまだ確定していない。
// このファイルで使う "concurExpenseTypeId" という名前は、あくまで
// 「迷子防止Bot側の経費タイプIDに対応するConcur側の何らかの識別子」を指す
// ための中立的な仮称であり、Concurの実際のAPIレスポンスのフィールド名
// （例えば ExpenseTypeCode や Key 等、実際に何と呼ばれるかは未確定）を
// 決め打ちしたものではない。仕様確定後、このファイル・呼び出し側の名前は
// 変更されうる。
//
// マッピングデータの構造（引数として受け取るだけで、この関数自身は一切
// ハードコードしない）：
//   mappings は以下の形のオブジェクトを要素に持つ配列とする。
//     {
//       companyId: string,          // 迷子防止Botの会社ID
//       policyId: string,           // 迷子防止Botのポリシー ID
//       botExpenseTypeId: string,   // config.expenseTypes[].id と同じ値
//       concurExpenseTypeId: string // Concur側識別子（仮称。上記注意参照）
//     }
//   会社・ポリシーごとにConcur側の識別子が異なりうるという前提（同じ
//   botExpenseTypeIdでも、companyId・policyIdの組み合わせが違えば別の行として
//   複数存在してよい）を反映するため、ネストしたオブジェクトではなく
//   フラットな配列にしている。管理画面が既に経費タイプ・ポリシー・ルールを
//   フラットな配列として扱っている（buildConfigFromFlow.js等）のと同じ考え方。
//
//   「会社・ポリシーを問わず常に同じConcur識別子を使う」といった、company/policy
//   ワイルドカード（null等での「共通」指定）は今回の設計には含めない。要件に
//   無い挙動を先回りして作り込まないため（現時点では常に会社・ポリシーの
//   完全一致でのみ解決する）。将来的に必要になった場合の拡張ポイントとして、
//   このコメントに残しておく。

/**
 * mapping1件が、指定された会社・ポリシー・Bot側経費タイプIDの組み合わせ
 * （＝mappingの一意キー）と一致するかどうか。
 *
 * この関数は、実行時の解決（mapBotExpenseTypeToConcur、単一のbotExpenseTypeIdを
 * 問い合わせる）と、初期設定Excelインポート時の重複検出
 * （src/flow/parseInitialSetupExcel.js、mapping配列全体を走査して同じキーの
 * 行が複数無いかを確認する）の両方から呼ばれる、「何をもって同じmappingと
 * みなすか」の唯一の定義。判定ロジックを2箇所に別々実装しない。
 *
 * @param {{ companyId: string, policyId: string, botExpenseTypeId: string }} entry
 * @param {{ companyId: string, policyId: string, botExpenseTypeId: string }} key
 */
export function mappingMatchesKey(entry, key) {
  return (
    entry?.companyId === key?.companyId &&
    entry?.policyId === key?.policyId &&
    entry?.botExpenseTypeId === key?.botExpenseTypeId
  );
}

/**
 * 迷子防止Bot内部の経費タイプIDを、指定された会社・ポリシーの組み合わせにおける
 * Concur側の経費タイプ識別子（仮称：concurExpenseTypeId）へ変換する。
 *
 * @param {object} input
 * @param {string} input.botExpenseTypeId 迷子防止Bot内部の経費タイプID
 *   （config.expenseTypes[].id、src/lib/concurExpenseData.jsのexpenseTypeIdと同じ値）。
 * @param {string} input.companyId 迷子防止Botの会社ID。
 * @param {string} input.policyId 迷子防止Botのポリシーの識別子
 *   （src/lib/policyVisibility.js等が扱うpolicy.policy_id相当。会社によっては
 *   ポリシーが1件のみで実質的に選び分けが無い場合もあるが、その場合も
 *   マッピングデータ上はそのポリシーのIDを明示的に指定する必要がある。
 *   ワイルドカードでの省略は今回サポートしない）。
 * @param {Array<{ companyId: string, policyId: string, botExpenseTypeId: string, concurExpenseTypeId: string }>} input.mappings
 *   マッピングデータ本体。呼び出し側が用意する（このファイルにハードコードしない）。
 *
 * @returns {{ result: { concurExpenseTypeId: string } | null, error: { type: string, message: string } | null }}
 *   成功時は { result: { concurExpenseTypeId }, error: null }。
 *   失敗時は { result: null, error: { type, message } } で、typeは以下のいずれか：
 *     - "company_unknown"          … mappings内に該当companyIdの行が1件も無い
 *     - "policy_unknown"           … companyIdは見つかったが、該当policyIdの行が無い
 *     - "mapping_not_found"        … company・policyは見つかったが、該当botExpenseTypeIdの行が無い
 *     - "multiple_mappings_found"  … company・policy・botExpenseTypeIdすべてが一致する行が2件以上ある
 *       （本来あってはならないデータ不整合。マッピングデータの重複登録を示す）
 */
export function mapBotExpenseTypeToConcur({ botExpenseTypeId, companyId, policyId, mappings }) {
  const entries = Array.isArray(mappings) ? mappings : [];

  const companyEntries = entries.filter((entry) => entry?.companyId === companyId);
  if (companyEntries.length === 0) {
    return {
      result: null,
      error: {
        type: "company_unknown",
        message: "指定された会社のConcurマッピング情報が見つかりません。",
      },
    };
  }

  const policyEntries = companyEntries.filter((entry) => entry?.policyId === policyId);
  if (policyEntries.length === 0) {
    return {
      result: null,
      error: {
        type: "policy_unknown",
        message: "指定されたポリシーのConcurマッピング情報が見つかりません。",
      },
    };
  }

  const matches = policyEntries.filter((entry) =>
    mappingMatchesKey(entry, { companyId, policyId, botExpenseTypeId }),
  );

  if (matches.length === 0) {
    return {
      result: null,
      error: {
        type: "mapping_not_found",
        message: "この経費タイプに対応するConcur側の経費タイプ識別子が見つかりません。",
      },
    };
  }

  if (matches.length > 1) {
    return {
      result: null,
      error: {
        type: "multiple_mappings_found",
        message:
          "この経費タイプに対応するConcur側の経費タイプ識別子が複数見つかりました。マッピング設定を確認してください。",
      },
    };
  }

  return { result: { concurExpenseTypeId: matches[0].concurExpenseTypeId }, error: null };
}
