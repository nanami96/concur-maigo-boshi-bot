import { describe, it, expect } from "vitest";
import { buildFlowFromConfig } from "../src/flow/buildFlowFromConfig";
import { buildConfigFromFlow } from "../src/flow/buildConfigFromFlow";
import { checkFlow } from "../src/flow/flowChecks";
import QuestionEngine from "../src/engine/QuestionEngine";
import sampleCompanyConfig from "../rules/sample-company/config.json";
import companyAConfig from "../rules/company-a/config.json";

// flow.rootQuestionIdからnext.questionIdを辿り、同じ質問を2度通る経路
// （＝自己ループ）が無いことを確認するヘルパー。
function hasCycle(flow) {
  const path = new Set();

  function visit(questionId) {
    const question = flow.questions[questionId];
    if (!questionId || !question) {
      return false;
    }
    if (path.has(questionId)) {
      return true;
    }
    path.add(questionId);

    const cyclic = question.optionIds.some((optionId) => {
      const option = flow.options[optionId];
      return option?.next?.type === "question" && visit(option.next.questionId);
    });

    path.delete(questionId);
    return cyclic;
  }

  return visit(flow.rootQuestionId);
}

// 到達可能な全ての選択肢（リーフ）が、最終的に"result"（未設定ではない）へ
// たどり着けることを確認するヘルパー。
function collectAllLeafNextTypes(flow) {
  const types = [];
  const visited = new Set();

  function visit(questionId) {
    if (visited.has(questionId)) {
      return;
    }
    visited.add(questionId);
    const question = flow.questions[questionId];
    if (!question) {
      return;
    }
    question.optionIds.forEach((optionId) => {
      const option = flow.options[optionId];
      if (!option?.next) {
        types.push("missing");
        return;
      }
      types.push(option.next.type);
      if (option.next.type === "question") {
        visit(option.next.questionId);
      }
    });
  }

  visit(flow.rootQuestionId);
  return types;
}

// 木構造の全リーフ（次の質問を持たない選択肢）まで実際に回答を進め、
// 判定結果（経費タイプ・メッセージ・注意事項）を集める。
// QuestionEngineを実際に動かして確認することで、内部データ形式の一致ではなく
// 「動作として同等か」を検証する。
function collectLeafOutcomes(config) {
  const questionsById = new Map(config.questions.map((question) => [question.id, question]));
  const outcomes = [];

  function walk(question, answersSoFar) {
    question.options.forEach((option) => {
      const nextAnswers = [...answersSoFar, { questionId: question.id, answer: option.value }];

      if (option.nextQuestionId) {
        walk(questionsById.get(option.nextQuestionId), nextAnswers);
        return;
      }

      const engine = new QuestionEngine(config);
      engine.getFirstQuestion();
      nextAnswers.forEach(({ answer }) => engine.submitAnswer(answer));
      const result = engine.getResult();

      outcomes.push({
        path: nextAnswers.map((item) => item.answer).join(">"),
        result,
      });
    });
  }

  walk(config.questions[0], []);

  return outcomes;
}

describe("buildFlowFromConfig / buildConfigFromFlow の往復変換", () => {
  it("sample-companyの取り込みで警告が発生しない（現状データが純粋な木構造であることの裏付け）", () => {
    const { warnings } = buildFlowFromConfig(sampleCompanyConfig);
    expect(warnings).toEqual([]);
  });

  it("往復変換後も質問・選択肢の総数が変わらない", () => {
    const { flow } = buildFlowFromConfig(sampleCompanyConfig);
    const rebuilt = buildConfigFromFlow(flow, {
      company: sampleCompanyConfig.company,
      policies: sampleCompanyConfig.policies,
      expenseTypes: sampleCompanyConfig.expenseTypes,
    });

    expect(rebuilt.questions.length).toBe(sampleCompanyConfig.questions.length);

    const originalOptionCount = sampleCompanyConfig.questions.reduce(
      (sum, question) => sum + question.options.length,
      0,
    );
    const rebuiltOptionCount = rebuilt.questions.reduce(
      (sum, question) => sum + question.options.length,
      0,
    );
    expect(rebuiltOptionCount).toBe(originalOptionCount);
  });

  it("全リーフ経路で、往復変換後も判定結果（経費タイプ・メッセージ・注意事項）が完全に一致する", () => {
    const { flow } = buildFlowFromConfig(sampleCompanyConfig);
    const rebuilt = buildConfigFromFlow(flow, {
      company: sampleCompanyConfig.company,
      policies: sampleCompanyConfig.policies,
      expenseTypes: sampleCompanyConfig.expenseTypes,
    });

    const originalOutcomes = collectLeafOutcomes(sampleCompanyConfig);
    const rebuiltOutcomes = collectLeafOutcomes(rebuilt);

    expect(rebuiltOutcomes.length).toBe(originalOutcomes.length);

    originalOutcomes.forEach((original, index) => {
      const rebuiltOutcome = rebuiltOutcomes[index];
      expect(rebuiltOutcome.path).toBe(original.path);
      expect(rebuiltOutcome.result?.expenseType?.id).toBe(original.result?.expenseType?.id);
      expect(rebuiltOutcome.result?.rule?.message).toBe(original.result?.rule?.message);
      expect(rebuiltOutcome.result?.rule?.warningMessage).toBe(
        original.result?.rule?.warningMessage,
      );
    });

    // 現状データでは候補が複数になるリーフは存在しない（前回調査で確認済み）ことも合わせて担保する。
    originalOutcomes.forEach((original) => {
      expect(original.result?.candidates).toBeUndefined();
    });
  });

  it("質問と回答が空のフローは questions=[] / rules=[] になる", () => {
    const emptyFlow = { rootQuestionId: null, questions: {}, options: {} };
    const config = buildConfigFromFlow(emptyFlow, {});
    expect(config.questions).toEqual([]);
    expect(config.rules).toEqual([]);
  });
});

// company-aのように選択肢にidが無い（または重複している）config.jsonを取り込んだ際、
// 全ての選択肢が同じキー（undefined相当）へ上書きされてデータが失われたり、
// optionIdsが実在しないキーを指してOptionRowがクラッシュしたりしないことを保証する。
// （実際にcompany-aで発生していたバグの再現・回帰防止テスト）
describe("buildFlowFromConfig: option.idが欠損・重複しているconfigの取り込み", () => {
  it("選択肢にidフィールドが無い場合でも、一意なidを自動発番し、データを失わない", () => {
    const config = {
      questions: [
        {
          id: "q1",
          text: "質問1",
          type: "single_select",
          options: [
            { label: "A", value: "A" },
            { label: "B", value: "B" },
            { label: "C", value: "C" },
          ],
        },
      ],
      rules: [
        { id: "r1", priority: 1, conditions: { q1: "A" }, resultExpenseTypeId: "e1", active: true },
        { id: "r2", priority: 2, conditions: { q1: "B" }, resultExpenseTypeId: "e2", active: true },
        { id: "r3", priority: 3, conditions: { q1: "C" }, resultExpenseTypeId: "e3", active: true },
      ],
    };

    const { flow, warnings } = buildFlowFromConfig(config);

    const optionIds = flow.questions.q1.optionIds;
    // 3つとも異なるidが発番されていること（重複が無いこと＝Reactのkey重複警告の回避）
    expect(new Set(optionIds).size).toBe(3);
    // 発番されたidが全てflow.optionsに実在すること（OptionRowのクラッシュ回避）
    optionIds.forEach((optionId) => {
      expect(flow.options[optionId]).toBeDefined();
    });
    // 各選択肢のデータ（結果の紐付け）が、上書きされず個別に保持されていること
    const expenseTypeIds = optionIds.map((optionId) => flow.options[optionId].next.candidates[0].expenseTypeId);
    expect(expenseTypeIds).toEqual(["e1", "e2", "e3"]);
    expect(warnings.length).toBe(3);
    expect(warnings[0]).toContain("IDが設定されていなかった");
  });

  it("選択肢のidが複数の選択肢で重複している場合も、一意なidへ補正してデータを保持する", () => {
    const config = {
      questions: [
        {
          id: "q1",
          text: "質問1",
          type: "single_select",
          options: [
            { id: "O001", label: "A", value: "A" },
            { id: "O001", label: "B", value: "B" },
          ],
        },
      ],
      rules: [
        { id: "r1", priority: 1, conditions: { q1: "A" }, resultExpenseTypeId: "e1", active: true },
        { id: "r2", priority: 2, conditions: { q1: "B" }, resultExpenseTypeId: "e2", active: true },
      ],
    };

    const { flow, warnings } = buildFlowFromConfig(config);

    const optionIds = flow.questions.q1.optionIds;
    expect(new Set(optionIds).size).toBe(2);
    optionIds.forEach((optionId) => {
      expect(flow.options[optionId]).toBeDefined();
    });
    const expenseTypeIds = optionIds.map((optionId) => flow.options[optionId].next.candidates[0].expenseTypeId);
    expect(expenseTypeIds).toEqual(["e1", "e2"]);
    expect(warnings.some((warning) => warning.includes("重複していた"))).toBe(true);
  });

  it("company-aの実データ（選択肢にidが無い）を取り込んでも、JSON往復後（Supabase保存想定）にoptionIdsが全て実在するキーを指す", () => {
    const { flow } = buildFlowFromConfig(companyAConfig);
    // draft_configsのjsonbカラムへの保存・再取得を模擬（undefinedを含む配列要素はnullへ変換される）
    const roundTripped = JSON.parse(JSON.stringify(flow));

    Object.values(roundTripped.questions).forEach((question) => {
      const optionIdSet = new Set();
      question.optionIds.forEach((optionId) => {
        expect(roundTripped.options[optionId]).toBeDefined();
        expect(optionIdSet.has(optionId)).toBe(false);
        optionIdSet.add(optionId);
      });
    });
  });
});

// company-aのconfig.jsonは「出張に関係ですか？」が電車・バス／ホテルの両方の
// 選択肢から参照される合流点（1つの質問が複数の親を持つ構造）になっている。
// この構造を取り込んだ際に、質問が上書きされて自己ループのように見える不具合
// （プレビューで同じ質問が無限に繰り返される）が実際に発生していたため、
// その回帰防止テスト。
describe("buildFlowFromConfig: 合流点（同じ質問が複数の選択肢から参照される）の取り込み", () => {
  it("company-aの全質問・選択肢を変換でき、自己ループが発生しない", () => {
    const { flow } = buildFlowFromConfig(companyAConfig);
    expect(hasCycle(flow)).toBe(false);
  });

  it("company-aの合流点（出張に関係ですか？）は経路ごとに複製され、警告に記録される", () => {
    const { warnings } = buildFlowFromConfig(companyAConfig);
    expect(warnings.some((warning) => warning.includes("合流点"))).toBe(true);
  });

  it("到達可能な選択肢は全て最終的に結果（result）へ到達でき、未設定(unset)は残らない", () => {
    const { flow } = buildFlowFromConfig(companyAConfig);
    const types = collectAllLeafNextTypes(flow);
    // 「電車・バス」「ホテル」はquestionへ、「タクシー」「はい」×2はresultへ、が期待値
    expect(types.filter((type) => type === "unset")).toEqual([]);
    expect(types.filter((type) => type === "missing")).toEqual([]);
    expect(types.filter((type) => type === "result").length).toBe(3);
  });

  it("電車・バス→出張に関係ですか？→はい、の経路が本来のr001（電車・近隣交通費）へ到達する", () => {
    const { flow } = buildFlowFromConfig(companyAConfig);
    const config = buildConfigFromFlow(flow, {
      company: companyAConfig.company,
      policies: companyAConfig.policies,
      expenseTypes: companyAConfig.expenseTypes,
    });

    const engine = new QuestionEngine(config);
    const q1 = engine.getFirstQuestion();
    const trainOption = q1.options.find((option) => option.label === "電車・バス");
    const q2 = engine.submitAnswer(trainOption.value);
    expect(q2.text).toBe("出張に関係ですか？");
    const yesOption = q2.options.find((option) => option.label === "はい");
    engine.submitAnswer(yesOption.value);

    const result = engine.getResult();
    expect(result.expenseType.id).toBe("train_local");
    expect(result.rule.message).toBe("電車・バスは「電車・近隣交通費」を選択してください。");
  });

  it("ホテル→出張に関係ですか？→はい、の経路が本来のr003（宿泊費）へ到達する（複製された合流点でも正しく分岐する）", () => {
    const { flow } = buildFlowFromConfig(companyAConfig);
    const config = buildConfigFromFlow(flow, {
      company: companyAConfig.company,
      policies: companyAConfig.policies,
      expenseTypes: companyAConfig.expenseTypes,
    });

    const engine = new QuestionEngine(config);
    const q1 = engine.getFirstQuestion();
    const hotelOption = q1.options.find((option) => option.label === "ホテル");
    const q2 = engine.submitAnswer(hotelOption.value);
    expect(q2.text).toBe("出張に関係ですか？");
    const yesOption = q2.options.find((option) => option.label === "はい");
    engine.submitAnswer(yesOption.value);

    const result = engine.getResult();
    expect(result.expenseType.id).toBe("hotel");
    expect(result.rule.message).toBe("宿泊費を選択してください。");
  });

  it("タクシー、の経路が本来のr002（タクシー）へ即座に到達する", () => {
    const { flow } = buildFlowFromConfig(companyAConfig);
    const config = buildConfigFromFlow(flow, {
      company: companyAConfig.company,
      policies: companyAConfig.policies,
      expenseTypes: companyAConfig.expenseTypes,
    });

    const engine = new QuestionEngine(config);
    const q1 = engine.getFirstQuestion();
    const taxiOption = q1.options.find((option) => option.label === "タクシー");
    const next = engine.submitAnswer(taxiOption.value);
    expect(next).toBeNull();

    const result = engine.getResult();
    expect(result.expenseType.id).toBe("taxi");
  });

  it("合流点が無いsample-companyでは複製が発生しない（回帰なし）", () => {
    const { warnings } = buildFlowFromConfig(sampleCompanyConfig);
    expect(warnings.some((warning) => warning.includes("合流点"))).toBe(false);
  });
});

describe("checkFlow: 自己ループ・存在しない次の質問の検出", () => {
  it("質問の選択肢が自分自身を指す直接自己ループはErrorになる", () => {
    const flow = {
      rootQuestionId: "q1",
      questions: { q1: { text: "質問1", type: "single_select", optionIds: ["O001"] } },
      options: { O001: { label: "A", next: { type: "question", questionId: "q1" } } },
    };

    const { errors } = checkFlow(flow, []);
    expect(errors.some((issue) => issue.id.startsWith("flow-cycle"))).toBe(true);
  });

  it("Q1→Q2→Q1のような間接的な循環もErrorになる", () => {
    const flow = {
      rootQuestionId: "q1",
      questions: {
        q1: { text: "質問1", type: "single_select", optionIds: ["O001"] },
        q2: { text: "質問2", type: "single_select", optionIds: ["O002"] },
      },
      options: {
        O001: { label: "A", next: { type: "question", questionId: "q2" } },
        O002: { label: "B", next: { type: "question", questionId: "q1" } },
      },
    };

    const { errors } = checkFlow(flow, []);
    expect(errors.some((issue) => issue.id.startsWith("flow-cycle"))).toBe(true);
  });

  it("循環が無い正常なflowではflow-cycleエラーが出ない", () => {
    const { flow } = buildFlowFromConfig(companyAConfig);
    const { errors } = checkFlow(flow, companyAConfig.expenseTypes);
    expect(errors.some((issue) => issue.id.startsWith("flow-cycle"))).toBe(false);
  });

  it("存在しない質問IDを参照するnextはErrorになる", () => {
    const flow = {
      rootQuestionId: "q1",
      questions: { q1: { text: "質問1", type: "single_select", optionIds: ["O001"] } },
      options: { O001: { label: "A", next: { type: "question", questionId: "does-not-exist" } } },
    };

    const { errors } = checkFlow(flow, []);
    expect(errors.some((issue) => issue.id.startsWith("option-next-question-missing"))).toBe(true);
  });
});
