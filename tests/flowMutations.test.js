import { describe, it, expect } from "vitest";
import {
  createEmptyFlow,
  addRootQuestion,
  addOption,
  updateOptionLabel,
  setOptionNextToNewQuestion,
  setOptionNextToResult,
  computeBranchImpact,
  deleteOption,
  reorderOption,
  updateResultCandidate,
} from "../src/flow/flowMutations";

function buildSampleFlow() {
  // 「何の経費ですか？」→「交通費」→「交通費の種類は？」→「タクシー」→結果 という3階層のフローを組み立てる。
  let flow = createEmptyFlow();
  const root = addRootQuestion(flow, "何の経費ですか？");
  flow = root.flow;

  const option1 = addOption(flow, root.questionId, "交通費");
  flow = option1.flow;
  flow = updateOptionLabel(flow, option1.optionId, "交通費");

  const branch = setOptionNextToNewQuestion(flow, option1.optionId, "交通費の種類は？");
  flow = branch.flow;

  const option2 = addOption(flow, branch.questionId, "タクシー");
  flow = option2.flow;
  flow = setOptionNextToResult(flow, option2.optionId);
  flow = updateResultCandidate(flow, option2.optionId, 0, { expenseTypeId: "taxi" });

  return { flow, rootQuestionId: root.questionId, option1Id: option1.optionId, option2Id: option2.optionId };
}

describe("flowMutations", () => {
  it("質問→選択肢→子質問→選択肢→結果、と組み立てられる", () => {
    const { flow, rootQuestionId, option1Id, option2Id } = buildSampleFlow();

    expect(flow.rootQuestionId).toBe(rootQuestionId);
    expect(flow.options[option1Id].next.type).toBe("question");
    const childQuestionId = flow.options[option1Id].next.questionId;
    expect(flow.questions[childQuestionId].text).toBe("交通費の種類は？");
    expect(flow.options[option2Id].next.type).toBe("result");
    expect(flow.options[option2Id].next.candidates[0].expenseTypeId).toBe("taxi");
  });

  it("新規追加したIDは既存IDと衝突しない", () => {
    const { flow } = buildSampleFlow();
    const ids = [...Object.keys(flow.questions), ...Object.keys(flow.options)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("computeBranchImpactが配下の質問・選択肢・結果件数を正しく数える", () => {
    const { flow, option1Id } = buildSampleFlow();
    const impact = computeBranchImpact(flow, option1Id);
    expect(impact).toEqual({ questionCount: 1, optionCount: 1, resultCount: 1 });
  });

  it("結果を持つ選択肢のcomputeBranchImpactはresultCount=1になる", () => {
    const { flow, option2Id } = buildSampleFlow();
    expect(computeBranchImpact(flow, option2Id)).toEqual({
      questionCount: 0,
      optionCount: 0,
      resultCount: 1,
    });
  });

  it("選択肢を削除すると配下の質問・選択肢・結果も全て消える", () => {
    const { flow, rootQuestionId, option1Id } = buildSampleFlow();
    const impactBefore = computeBranchImpact(flow, option1Id);
    expect(impactBefore.questionCount).toBeGreaterThan(0);

    const childQuestionId = flow.options[option1Id].next.questionId;
    const after = deleteOption(flow, rootQuestionId, option1Id);

    expect(after.questions[rootQuestionId].optionIds).not.toContain(option1Id);
    expect(after.options[option1Id]).toBeUndefined();
    expect(after.questions[childQuestionId]).toBeUndefined();
  });

  it("「次の質問へ進む」から「結果を表示する」へ切替えると配下が削除される", () => {
    const { flow, option1Id } = buildSampleFlow();
    const childQuestionId = flow.options[option1Id].next.questionId;

    const after = setOptionNextToResult(flow, option1Id);

    expect(after.options[option1Id].next.type).toBe("result");
    expect(after.questions[childQuestionId]).toBeUndefined();
  });

  it("選択肢の並び替えができる", () => {
    let flow = createEmptyFlow();
    const root = addRootQuestion(flow, "Q");
    flow = root.flow;
    const a = addOption(flow, root.questionId, "A");
    flow = a.flow;
    const b = addOption(flow, root.questionId, "B");
    flow = b.flow;

    const reordered = reorderOption(flow, root.questionId, 0, 1);
    expect(reordered.questions[root.questionId].optionIds).toEqual([b.optionId, a.optionId]);
  });
});
