import { describe, it, expect } from "vitest";
import { buildConfigSnapshotForPublish } from "../src/admin/usePublish.js";

// usePublish自体はReactフック（useState/useCallback/useEffect）であり、この
// プロジェクトにはDOM描画テスト基盤（React Testing Library等）が無いため直接
// テストできない。そのため「workspace state → config_snapshot」という、この
// フックが公開時に行う変換のうち純粋関数として切り出せる部分だけを、ここで
// 直接検証する（src/ConcurRegistrationPanel.jsxの表示ロジックと同じ方針）。

function buildEditorState(overrides = {}) {
  return {
    company: { company_id: "sample-company", company_name: "サンプル会社" },
    policies: [{ policy_id: "normal_expense", policy_name: "通常経費" }],
    expenseTypes: [{ id: "taxi", policyId: "normal_expense", name: "タクシー" }],
    flow: {
      rootQuestionId: "q1",
      questions: {
        q1: { text: "何に使いましたか？", type: "single_select", optionIds: ["o1"] },
      },
      options: {
        o1: {
          label: "タクシー",
          next: {
            type: "result",
            candidates: [{ sourceRuleId: "r1", expenseTypeId: "taxi", message: "タクシー代です。", warningMessage: "" }],
          },
        },
      },
    },
    ...overrides,
  };
}

describe("buildConfigSnapshotForPublish", () => {
  it("config_snapshotにconcurキーは含まれない（経費タイプID＝Concur EXP_KEYという設計により、独立したmapping表は廃止済み）", () => {
    const editorState = buildEditorState();

    const configSnapshot = buildConfigSnapshotForPublish(editorState);

    expect(configSnapshot).not.toHaveProperty("concur");
    expect(configSnapshot.company).toBe(editorState.company);
    expect(configSnapshot.policies).toBe(editorState.policies);
    expect(configSnapshot.expenseTypes).toBe(editorState.expenseTypes);
    expect(configSnapshot.questions).toHaveLength(1);
    expect(configSnapshot.rules).toHaveLength(1);
  });
});
