import { describe, it, expect } from "vitest";
import { checkFlow } from "../src/flow/flowChecks";
import { buildFlowFromConfig } from "../src/flow/buildFlowFromConfig";
import {
  createEmptyFlow,
  addRootQuestion,
  addOption,
  setOptionNextToResult,
} from "../src/flow/flowMutations";
import sampleCompanyConfig from "../rules/sample-company/config.json";

describe("checkFlow", () => {
  it("フローが空の場合はErrorで最初の質問の作成を促す", () => {
    const { errors } = checkFlow(createEmptyFlow(), []);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("最初の質問");
  });

  it("sample-companyを取り込んだ結果はErrorが0件になる", () => {
    const { flow } = buildFlowFromConfig(sampleCompanyConfig);
    const { errors } = checkFlow(flow, sampleCompanyConfig.expenseTypes);
    expect(errors).toEqual([]);
  });

  it("次の質問/結果が未設定の選択肢はIDを含まない自然文でErrorになる", () => {
    let flow = createEmptyFlow();
    const root = addRootQuestion(flow, "何の経費ですか？");
    flow = root.flow;
    const option = addOption(flow, root.questionId, "タクシー");
    flow = option.flow;

    const { errors } = checkFlow(flow, []);
    const message = errors.find((issue) => issue.optionId === option.optionId)?.message;

    expect(message).toBe(
      "質問「何の経費ですか？」の選択肢「タクシー」で、次の質問または結果が設定されていません。",
    );
    expect(message).not.toMatch(/Q\d{3}|O\d{3}/);
  });

  it("結果の経費タイプが未選択だとErrorになる", () => {
    let flow = createEmptyFlow();
    const root = addRootQuestion(flow, "Q");
    flow = root.flow;
    const option = addOption(flow, root.questionId, "タクシー");
    flow = option.flow;
    flow = setOptionNextToResult(flow, option.optionId);

    const { errors } = checkFlow(flow, []);
    expect(
      errors.some((issue) => issue.message.includes("経費タイプが選択されていません")),
    ).toBe(true);
  });
});
