import { useMemo } from "react";
import RuleFlowTree from "../RuleFlowTree";
import { buildConfigFromFlow } from "../flow/buildConfigFromFlow";

// 既存の RuleFlowTree（利用者向けBot画面のレビュー機能で使っているもの）をそのまま再利用し、
// 編集中のflowを一切改修せずに「全体をツリーで見る」読み取り専用ビューとして表示する。
export default function FlowTreeReadOnlyView({ flow, baseData }) {
  const config = useMemo(() => buildConfigFromFlow(flow, baseData), [flow, baseData]);

  return <RuleFlowTree config={config} />;
}
