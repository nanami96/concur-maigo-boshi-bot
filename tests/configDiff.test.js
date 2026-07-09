import { describe, expect, it } from "vitest";
import { diffConfigs } from "../src/configDiff";

const baseConfig = {
  questions: [
    {
      id: "q-category",
      text: "What are you claiming?",
      displayOrder: 1,
      options: [
        {
          label: "Train",
          value: "train",
        },
      ],
    },
  ],
  rules: [
    {
      id: "r-train",
      priority: 1,
      active: true,
      conditions: {
        "q-category": "train",
      },
      resultExpenseTypeId: "train_local",
      message: "Use train expense.",
    },
  ],
  expenseTypes: [
    {
      id: "train_local",
      name: "Train",
      receiptRequired: false,
      active: true,
    },
  ],
};

function cloneConfig(config) {
  return structuredClone(config);
}

describe("diffConfigs", () => {
  it("detects added questions", () => {
    const currentConfig = cloneConfig(baseConfig);
    currentConfig.questions.push({
      id: "q-trip",
      text: "Is this for a business trip?",
      displayOrder: 2,
      options: [],
    });

    const diff = diffConfigs(baseConfig, currentConfig);

    expect(diff.targets.questions.added).toHaveLength(1);
    expect(diff.targets.questions.added[0].id).toBe("q-trip");
    expect(diff.summary.added).toBe(1);
  });

  it("detects removed questions", () => {
    const currentConfig = {
      ...cloneConfig(baseConfig),
      questions: [],
    };

    const diff = diffConfigs(baseConfig, currentConfig);

    expect(diff.targets.questions.removed).toHaveLength(1);
    expect(diff.targets.questions.removed[0].id).toBe("q-category");
    expect(diff.summary.removed).toBe(1);
  });

  it("detects changed questions", () => {
    const currentConfig = cloneConfig(baseConfig);
    currentConfig.questions[0].text = "Changed question";

    const diff = diffConfigs(baseConfig, currentConfig);

    expect(diff.targets.questions.changed).toHaveLength(1);
    expect(diff.targets.questions.changed[0].id).toBe("q-category");
    expect(diff.targets.questions.changed[0].changes).toEqual([
      {
        field: "text",
        before: "What are you claiming?",
        after: "Changed question",
      },
    ]);
    expect(diff.summary.changed).toBe(1);
  });

  it("detects added, removed, and changed rules", () => {
    const currentConfig = cloneConfig(baseConfig);
    currentConfig.rules = [
      {
        ...currentConfig.rules[0],
        message: "Changed message.",
      },
      {
        id: "r-taxi",
        priority: 2,
        active: true,
        conditions: {
          "q-category": "taxi",
        },
        resultExpenseTypeId: "taxi",
        message: "Use taxi expense.",
      },
    ];
    const previousConfig = cloneConfig(baseConfig);
    previousConfig.rules.push({
      id: "r-old",
      priority: 3,
      active: true,
      conditions: {
        "q-category": "old",
      },
      resultExpenseTypeId: "old",
      message: "Old rule.",
    });

    const diff = diffConfigs(previousConfig, currentConfig);

    expect(diff.targets.rules.added.map((item) => item.id)).toEqual([
      "r-taxi",
    ]);
    expect(diff.targets.rules.removed.map((item) => item.id)).toEqual([
      "r-old",
    ]);
    expect(diff.targets.rules.changed.map((item) => item.id)).toEqual([
      "r-train",
    ]);
    expect(diff.targets.rules.changed[0].changes).toEqual([
      {
        field: "message",
        before: "Use train expense.",
        after: "Changed message.",
      },
    ]);
  });

  it("detects added, removed, and changed expense types", () => {
    const currentConfig = cloneConfig(baseConfig);
    currentConfig.expenseTypes = [
      {
        ...currentConfig.expenseTypes[0],
        receiptRequired: true,
      },
      {
        id: "taxi",
        name: "Taxi",
        receiptRequired: true,
        active: true,
      },
    ];
    const previousConfig = cloneConfig(baseConfig);
    previousConfig.expenseTypes.push({
      id: "old",
      name: "Old expense",
      receiptRequired: false,
      active: false,
    });

    const diff = diffConfigs(previousConfig, currentConfig);

    expect(diff.targets.expenseTypes.added.map((item) => item.id)).toEqual([
      "taxi",
    ]);
    expect(diff.targets.expenseTypes.removed.map((item) => item.id)).toEqual([
      "old",
    ]);
    expect(diff.targets.expenseTypes.changed.map((item) => item.id)).toEqual([
      "train_local",
    ]);
    expect(diff.targets.expenseTypes.changed[0].changes).toEqual([
      {
        field: "receiptRequired",
        before: false,
        after: true,
      },
    ]);
  });

  it("returns an empty diff when configs are equal", () => {
    const diff = diffConfigs(baseConfig, cloneConfig(baseConfig));

    expect(diff.hasDiff).toBe(false);
    expect(diff.summary).toEqual({
      added: 0,
      removed: 0,
      changed: 0,
    });
    expect(diff.targets.questions).toMatchObject({
      added: [],
      removed: [],
      changed: [],
    });
    expect(diff.targets.rules).toMatchObject({
      added: [],
      removed: [],
      changed: [],
    });
    expect(diff.targets.expenseTypes).toMatchObject({
      added: [],
      removed: [],
      changed: [],
    });
  });
});
