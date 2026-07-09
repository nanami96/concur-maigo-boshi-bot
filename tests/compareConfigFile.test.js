import { describe, expect, it } from "vitest";
import { compareConfigs } from "../src/configDiff";
import { parseCompareConfigText } from "../src/compareConfigFile";

const currentConfig = {
  questions: [
    {
      id: "q-category",
      text: "What are you claiming?",
      options: [],
    },
  ],
  rules: [
    {
      id: "r-train",
      conditions: {
        "q-category": "train",
      },
      resultExpenseTypeId: "train",
    },
  ],
  expenseTypes: [
    {
      id: "train",
      name: "Train",
    },
  ],
};

describe("parseCompareConfigText", () => {
  it("returns a clear error for invalid JSON", () => {
    const result = parseCompareConfigText("{ invalid json");

    expect(result.config).toBeNull();
    expect(result.error).toContain("JSON");
  });

  it("returns a clear error for invalid config shape", () => {
    const result = parseCompareConfigText(
      JSON.stringify({
        questions: [],
        rules: [],
      }),
    );

    expect(result.config).toBeNull();
    expect(result.error).toContain("expenseTypes");
  });

  it("can compare a loaded config with differences", () => {
    const previousConfig = {
      ...currentConfig,
      questions: [],
      rules: [],
      expenseTypes: [],
    };
    const result = parseCompareConfigText(JSON.stringify(previousConfig));
    const diff = compareConfigs(result.config, currentConfig);

    expect(result.error).toBe("");
    expect(diff.summary).toEqual({
      added: 3,
      removed: 0,
      changed: 0,
    });
    expect(diff.hasDiff).toBe(true);
  });

  it("can compare a loaded config with no differences", () => {
    const result = parseCompareConfigText(JSON.stringify(currentConfig));
    const diff = compareConfigs(result.config, currentConfig);

    expect(result.error).toBe("");
    expect(diff.summary).toEqual({
      added: 0,
      removed: 0,
      changed: 0,
    });
    expect(diff.hasDiff).toBe(false);
  });
});
