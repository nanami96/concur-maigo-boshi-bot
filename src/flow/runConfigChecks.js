import { checkFlow } from "./flowChecks";
import { checkMasterData } from "./masterDataChecks";

// ConfigCheckPanel（表示用）と公開処理のゲート（Errorが1件でもあれば公開不可）が
// 同じ判定結果を共有するための、唯一のチェック集約ポイント。
// 表示側と公開可否判定側でロジックがズレることを防ぐため、必ずこの関数を経由する。
export function runConfigChecks({ company, policies, expenseTypes, flow }) {
  const flowResult = checkFlow(flow, expenseTypes);
  const masterDataResult = checkMasterData({ company, policies, expenseTypes, flow });

  return {
    errors: [...masterDataResult.errors, ...flowResult.errors],
    warnings: [...masterDataResult.warnings, ...flowResult.warnings],
  };
}
