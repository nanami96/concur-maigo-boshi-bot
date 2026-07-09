const REQUIRED_ARRAY_KEYS = ["questions", "rules", "expenseTypes"];

export function validateCompareConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return "config.json の内容がオブジェクトではありません。";
  }

  const missingKey = REQUIRED_ARRAY_KEYS.find(
    (key) => !Array.isArray(config[key]),
  );

  if (missingKey) {
    return `${missingKey} が配列として定義されていません。`;
  }

  return "";
}

export function parseCompareConfigText(text) {
  try {
    const config = JSON.parse(text);
    const error = validateCompareConfig(config);

    if (error) {
      return {
        config: null,
        error,
      };
    }

    return {
      config,
      error: "",
    };
  } catch {
    return {
      config: null,
      error: "JSONとして読み込めませんでした。config.json の形式を確認してください。",
    };
  }
}
