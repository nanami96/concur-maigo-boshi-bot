// 結果画面の「ポリシー」欄を表示すべきかどうかの判定。
//
// 会社によっては「1ポリシーのみ」で運用しており、その場合は利用者が
// ポリシーを選び分ける必要が無いため、結果画面に毎回「ポリシー：〇〇」と
// 表示しても情報価値が低く、画面が煩雑になる。
//
// 判定基準はあくまで「その会社に現在設定されている有効ポリシー数」であり、
// 個々の結果（rule/expenseType）にpolicyIdが入っているかどうかとは独立に
// 決める（呼び出し側で、結果自体にポリシー名が無いケースとAND判定すること）。
//
// 「有効」の定義は、既存の管理画面（PolicySettings.jsx）が使っている
// policy.enabled === "Y"（使用中）にそのまま合わせる。Excel取り込み時点で
// enabledは"Y"/"N"のいずれか以外を許容しない検証が既にあるため
// （parseInitialSetupExcel.js参照）、"Y"以外はすべて非有効として扱ってよい。
export function countActivePolicies(policies) {
  if (!Array.isArray(policies)) {
    return 0;
  }

  return policies.filter((policy) => policy?.enabled === "Y").length;
}

// 有効ポリシーが2件以上の場合だけポリシー欄を表示する
// （0件・1件はどちらも「選び分ける意味が無い」ため非表示）。
export function shouldShowPolicySection(policies) {
  return countActivePolicies(policies) > 1;
}
