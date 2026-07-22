import { describe, it, expect } from "vitest";
import { normalizeFlow } from "../src/flow/normalizeFlow";

describe("normalizeFlow", () => {
  it("既に健全なflowは変更せず、issuesも空で返す", () => {
    const flow = {
      rootQuestionId: "q1",
      questions: {
        q1: { text: "質問1", type: "single_select", optionIds: ["O001", "O002"] },
      },
      options: {
        O001: { label: "A", next: { type: "unset" } },
        O002: { label: "B", next: { type: "result", candidates: [{ expenseTypeId: "e1" }] } },
      },
    };

    const { flow: normalized, issues } = normalizeFlow(flow);

    expect(issues).toEqual([]);
    expect(normalized).toEqual(flow);
  });

  it("空のflow（questions/optionsが空オブジェクト）はそのまま安全に扱う", () => {
    const flow = { rootQuestionId: null, questions: {}, options: {} };
    const { flow: normalized, issues } = normalizeFlow(flow);
    expect(normalized).toEqual(flow);
    expect(issues).toEqual([]);
  });

  it("optionIdがnull（Supabase jsonb往復でundefinedがnullになったケース）でも、flow.optionsに実在する一意なidへ補正する", () => {
    // 実際にcompany-aで発生していた壊れ方：optionIdsが全てnullで、
    // flow.optionsには"undefined"という1つのキーしか無い状態を再現。
    const flow = {
      rootQuestionId: "q-category",
      questions: {
        "q-category": { text: "質問", type: "single_select", optionIds: [null, null, null] },
      },
      options: {
        undefined: { label: "はい", next: { type: "unset" } },
      },
    };

    const { flow: normalized, issues } = normalizeFlow(flow);

    const optionIds = normalized.questions["q-category"].optionIds;
    expect(new Set(optionIds).size).toBe(3);
    optionIds.forEach((optionId) => {
      expect(normalized.options[optionId]).toBeDefined();
    });
    expect(issues.length).toBe(3);
  });

  it("同じ質問内でoptionIdが重複している場合、片方は元のデータを保ち、もう片方は新しいidへ補正される", () => {
    const flow = {
      rootQuestionId: "q1",
      questions: {
        q1: { text: "質問1", type: "single_select", optionIds: ["O001", "O001"] },
      },
      options: {
        O001: { label: "A", next: { type: "unset" } },
      },
    };

    const { flow: normalized, issues } = normalizeFlow(flow);

    const optionIds = normalized.questions.q1.optionIds;
    expect(optionIds[0]).toBe("O001");
    expect(optionIds[1]).not.toBe("O001");
    expect(normalized.options[optionIds[1]]).toEqual({ label: "A", next: { type: "unset" } });
    expect(issues.some((issue) => issue.includes("重複していた"))).toBe(true);
  });

  it("optionIdsがflow.optionsに存在しないIDを指している（ぶら下がり参照）場合、未設定の選択肢として補う", () => {
    const flow = {
      rootQuestionId: "q1",
      questions: {
        q1: { text: "質問1", type: "single_select", optionIds: ["O999"] },
      },
      options: {},
    };

    const { flow: normalized, issues } = normalizeFlow(flow);

    const optionIds = normalized.questions.q1.optionIds;
    expect(optionIds.length).toBe(1);
    expect(normalized.options[optionIds[0]]).toEqual({ label: "", next: { type: "unset" } });
    expect(issues.some((issue) => issue.includes("対応するデータが見つからなかった"))).toBe(true);
  });

  it("rootQuestionIdがquestionsに存在しない場合はnullへ補正する（FirstQuestionPromptが安全に表示される）", () => {
    const flow = { rootQuestionId: "does-not-exist", questions: {}, options: {} };
    const { flow: normalized, issues } = normalizeFlow(flow);
    expect(normalized.rootQuestionId).toBeNull();
    expect(issues.length).toBe(1);
  });

  it("flow自体が不正な形式（null等）でも空フローとして安全に扱う", () => {
    const { flow: normalized, issues } = normalizeFlow(null);
    expect(normalized).toEqual({ rootQuestionId: null, questions: {}, options: {} });
    expect(issues.length).toBe(1);
  });

  it("question.optionIdsが配列でない不正な形式でも空配列として扱う", () => {
    const flow = {
      rootQuestionId: "q1",
      questions: { q1: { text: "質問1", type: "single_select", optionIds: null } },
      options: {},
    };
    const { flow: normalized } = normalizeFlow(flow);
    expect(normalized.questions.q1.optionIds).toEqual([]);
  });
});
