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
