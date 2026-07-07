import { describe, expect, it } from "vitest";
import { searchConfig } from "../src/configSearch";

const config = {
  questions: [
    {
      id: "q-category",
      text: "What are you claiming?",
      displayOrder: 1,
      options: [
        {
          label: "Train",
          value: "train",
          nextQuestionId: "q-trip",
        },
        {
          label: "Taxi",
          value: "taxi",
        },
      ],
    },
    {
      id: "q-trip",
      text: "Is this for a business trip?",
      displayOrder: 2,
      options: [
        {
          label: "Yes",
          value: "yes",
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
        "q-trip": "yes",
      },
      resultExpenseTypeId: "train_local",
      message: "Use local train expense.",
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
  ],
  expenseTypes: [
    {
      id: "train_local",
      name: "Local Train",
    },
    {
      id: "taxi",
      name: "Taxi",
    },
  ],
};

function ids(items) {
  return items.map((item) => item.id);
}

describe("searchConfig", () => {
  it("matches question IDs and text with partial case-insensitive search", () => {
    const result = searchConfig(config, "TRIP");

    expect(result.hasMatches).toBe(true);
    expect(result.matches.questionIds).toContain("q-trip");
    expect(ids(result.filtered.questions)).toContain("q-trip");
  });

  it("matches option labels and values", () => {
    const result = searchConfig(config, "tax");

    expect(result.matches.questionIds).toContain("q-category");
    expect(result.matches.optionIds).toContain("q-category-taxi");
  });

  it("matches rule IDs and guide messages", () => {
    const result = searchConfig(config, "local train");

    expect(result.matches.ruleIds).toContain("r-train");
    expect(ids(result.filtered.rules)).toEqual(["r-train"]);
  });

  it("matches expense type names and keeps related rules", () => {
    const result = searchConfig(config, "taxi");

    expect(result.matches.expenseTypeIds).toContain("taxi");
    expect(result.matches.ruleIds).toContain("r-taxi");
    expect(ids(result.filtered.expenseTypes)).toContain("taxi");
  });

  it("returns no matches for unknown text", () => {
    const result = searchConfig(config, "not-found");

    expect(result.hasMatches).toBe(false);
    expect(result.filtered.questions).toEqual([]);
    expect(result.filtered.rules).toEqual([]);
    expect(result.filtered.expenseTypes).toEqual([]);
  });

  it("returns all items when query is empty", () => {
    const result = searchConfig(config, "");

    expect(result.hasQuery).toBe(false);
    expect(ids(result.filtered.questions)).toEqual(["q-category", "q-trip"]);
    expect(ids(result.filtered.rules)).toEqual(["r-train", "r-taxi"]);
    expect(ids(result.filtered.expenseTypes)).toEqual(["train_local", "taxi"]);
  });
});
