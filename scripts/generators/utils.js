function toValue(text, fallback) {
  const value = String(text || "").trim();

  if (!value) {
    return fallback;
  }

  const fixedMap = {
    はい: "yes",
    いいえ: "no",
    有: "yes",
    無: "no",
    必要: "yes",
    不要: "no",
  };

  if (fixedMap[value]) {
    return fixedMap[value];
  }

  return (
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[・、，,／/]/g, "_")
      .replace(/[（）()「」『』【】\[\]]/g, "")
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_\-]/g, "")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || fallback
  );
}

function isFilled(value) {
  return String(value || "").trim() !== "";
}

module.exports = {
  toValue,
  isFilled,
  toQuestionId,
};

function toQuestionId(columnName) {
  if (columnName === "申請内容") {
    return "q-category";
  }

  const questionIdMap = {
    出張に関係: "q-business-trip",
    領収書あり: "q-receipt",
  };

  return questionIdMap[columnName] || `q-${toValue(columnName, columnName)}`;
}
