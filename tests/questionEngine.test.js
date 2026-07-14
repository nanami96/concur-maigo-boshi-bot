import { describe, it, expect } from "vitest";
import QuestionEngine from "../src/engine/QuestionEngine";

const config = {
  questions: [
    {
      id: "q1",
      text: "今日は何を申請しますか？",
      options: [
        {
          label: "電車",
          value: "train",
          nextQuestionId: "q2",
        },
      ],
    },
    {
      id: "q2",
      text: "出張ですか？",
      options: [
        {
          label: "はい",
          value: "yes",
        },
      ],
    },
  ],
  rules: [
    {
      id: "r1",
      priority: 1,
      active: true,
      conditions: {
        q1: "train",
        q2: "yes",
      },
      resultExpenseTypeId: "train_local",
      message: "電車・近隣交通費を選択してください。",
    },
  ],
  expenseTypes: [
    {
      id: "train_local",
      name: "電車・近隣交通費",
      receiptRequired: false,
      note: "",
    },
  ],
};

describe("QuestionEngine", () => {
  it("最初の質問を取得できる", () => {
    const engine = new QuestionEngine(config);

    expect(engine.getFirstQuestion().id).toBe("q1");
  });
});

it("回答すると次の質問へ進む", () => {
  const engine = new QuestionEngine(config);

  engine.getFirstQuestion();

  const nextQuestion = engine.submitAnswer("train");

  expect(nextQuestion.id).toBe("q2");
});

it("回答内容に一致する結果を取得できる", () => {
  const engine = new QuestionEngine(config);

  engine.getFirstQuestion();
  engine.submitAnswer("train");
  engine.submitAnswer("yes");

  const result = engine.getResult();

  expect(result.expenseType.name).toBe("電車・近隣交通費");
  expect(result.rule.message).toBe("電車・近隣交通費を選択してください。");
});
it("resetすると最初の質問に戻る", () => {
  const engine = new QuestionEngine(config);

  engine.getFirstQuestion();
  engine.submitAnswer("train");

  const firstQuestion = engine.reset();

  expect(firstQuestion.id).toBe("q1");
});
it("restoreSnapshotで以前の状態に戻せる", () => {
  const engine = new QuestionEngine(config);

  engine.getFirstQuestion();

  const snapshot = engine.getSnapshot();

  engine.submitAnswer("train");

  engine.restoreSnapshot(snapshot);

  const nextQuestion = engine.submitAnswer("train");

  expect(nextQuestion.id).toBe("q2");
});

it("どのルールにも一致しない場合はnullを返す", () => {
  const engine = new QuestionEngine(config);

  engine.getFirstQuestion();
  engine.submitAnswer("train");
  engine.submitAnswer("no");

  expect(engine.getResult()).toBeNull();
});

it("2条件のうち1条件だけ回答済みの場合は一致しない", () => {
  const engine = new QuestionEngine(config);

  engine.getFirstQuestion();
  engine.submitAnswer("train");

  expect(engine.getResult()).toBeNull();
});

it("2条件が両方揃った場合のみ一致する", () => {
  const engine = new QuestionEngine(config);

  engine.getFirstQuestion();

  expect(engine.getResult()).toBeNull();

  engine.submitAnswer("train");
  expect(engine.getResult()).toBeNull();

  engine.submitAnswer("yes");
  expect(engine.getResult()?.expenseType.name).toBe("電車・近隣交通費");
});

it("条件の回答順が逆でも一致する（回答履歴の並び順に依存しない）", () => {
  const engine = new QuestionEngine(config);

  engine.restoreSnapshot({
    currentQuestion: config.questions[1],
    answers: [
      { questionId: "q2", answer: "yes" },
      { questionId: "q1", answer: "train" },
    ],
  });

  const result = engine.getResult();

  expect(result.expenseType.name).toBe("電車・近隣交通費");
});

it("複数条件のANDルールが複数成立した場合はcandidatesとして全件返す", () => {
  const multiConditionConfig = {
    questions: config.questions,
    rules: [
      {
        id: "r010-g1",
        priority: 1,
        active: true,
        conditions: { q1: "train", q2: "yes" },
        resultExpenseTypeId: "bullet_train",
        message: "新幹線として案内",
      },
      {
        id: "r010-g2",
        priority: 2,
        active: true,
        conditions: { q1: "train", q2: "yes" },
        resultExpenseTypeId: "limited_express",
        message: "特急として案内",
      },
    ],
    expenseTypes: [
      { id: "bullet_train", name: "新幹線代" },
      { id: "limited_express", name: "特急料金" },
    ],
  };

  const engine = new QuestionEngine(multiConditionConfig);

  engine.getFirstQuestion();
  engine.submitAnswer("train");
  engine.submitAnswer("yes");

  const result = engine.getResult();

  expect(result.candidates).toHaveLength(2);
  expect(result.candidates.map((candidate) => candidate.expenseType.name)).toEqual([
    "新幹線代",
    "特急料金",
  ]);
});

it("同一条件に複数のルールが一致する場合、先頭1件に絞らずcandidatesとして全件返す", () => {
  const multiMatchConfig = {
    questions: config.questions,
    rules: [
      {
        id: "r1",
        priority: 1,
        active: true,
        conditions: { q1: "train" },
        resultExpenseTypeId: "bullet_train",
        message: "新幹線として案内",
      },
      {
        id: "r2",
        priority: 2,
        active: true,
        conditions: { q1: "train" },
        resultExpenseTypeId: "limited_express",
        message: "特急として案内",
      },
    ],
    expenseTypes: [
      { id: "bullet_train", name: "新幹線代" },
      { id: "limited_express", name: "特急料金" },
    ],
  };

  const engine = new QuestionEngine(multiMatchConfig);

  engine.getFirstQuestion();
  engine.submitAnswer("train");

  const result = engine.getResult();

  expect(result.candidates).toHaveLength(2);
  expect(result.candidates.map((candidate) => candidate.expenseType.name)).toEqual([
    "新幹線代",
    "特急料金",
  ]);
});
