// 新Excelスキーマ（関係モデル: 04_質問/05_選択肢/06_判定ルール）用の変換処理。
// 既存の questions.js / rules.js / expenseTypes.js / utils.js は company-a（旧スキーマ）の
// 生成経路を壊さないため一切変更せず、この新しいファイルに専用ロジックを実装する。

const QUESTION_ID_PATTERN = /^Q\d{3}$/;
const OPTION_ID_PATTERN = /^O\d{3}$/;
const RULE_ID_PATTERN = /^r\d{3}$/;

function toText(value) {
  return String(value ?? "").trim();
}

function toOptionalText(value) {
  const text = toText(value);
  return text === "" ? undefined : text;
}

function isYes(value) {
  return toText(value) === "Y";
}

// 条件グループは文字列・数値どちらで入力されても安全に正規化する。空欄は後方互換のため"1"として扱う。
function normalizeGroup(value) {
  const text = toText(value);
  return text === "" ? "1" : text;
}

// (ルールID, 条件グループ) の組み合わせを1つの判定ルールとしてグループ化する。
// Map は挿入順を保持するため、返す配列の順序がそのままExcel上の初出順＝priority採番順になる。
function groupRuleRows(ruleSheet) {
  const groups = new Map();

  ruleSheet.forEach((row) => {
    const ruleId = toText(row["ルールID"]);
    const group = normalizeGroup(row["条件グループ"]);
    const key = `${ruleId}|${group}`;

    if (!groups.has(key)) {
      groups.set(key, { ruleId, group, rows: [] });
    }

    groups.get(key).rows.push(row);
  });

  return [...groups.values()];
}

function createCompanyFromNewSchema(companySheet) {
  const row = companySheet[0] || {};

  return {
    company_id: toText(row["会社ID"]),
    company_name: toText(row["会社名"]),
  };
}

function createPoliciesFromNewSchema(policySheet) {
  return policySheet.map((row) => ({
    policy_id: toText(row["ポリシーID"]),
    policy_name: toText(row["ポリシー名"]),
    enabled: toText(row["使用有無"]),
  }));
}

function createExpenseTypesFromNewSchema(expenseTypeSheet) {
  return expenseTypeSheet.map((row) => ({
    id: toText(row["経費タイプID"]),
    policyId: toText(row["ポリシーID"]),
    name: toText(row["経費タイプ名"]),
    receiptRequired: isYes(row["領収書有無"]),
    active: isYes(row["使用有無"]),
    note: "",
  }));
}

function createQuestionsWithOptionsFromNewSchema(questionSheet, optionSheet) {
  const sortedQuestionRows = [...questionSheet].sort(
    (left, right) => Number(left["質問の表示順"]) - Number(right["質問の表示順"]),
  );

  return sortedQuestionRows.map((row) => {
    const questionId = toText(row["質問ID"]);

    const options = optionSheet
      .filter((optionRow) => toText(optionRow["質問ID"]) === questionId)
      .map((optionRow) => {
        const optionId = toText(optionRow["選択肢ID"]);

        return {
          id: optionId,
          value: optionId,
          questionId,
          label: toText(optionRow["ボタンに表示する文字"]),
          nextQuestionId: toOptionalText(optionRow["次に質問する質問ID"]),
        };
      });

    return {
      id: questionId,
      text: toText(row["質問文"]),
      type: toText(row["質問形式"]),
      displayOrder: Number(row["質問の表示順"]),
      options,
    };
  });
}

function createRulesFromNewSchema(ruleSheet) {
  const groups = groupRuleRows(ruleSheet);

  return groups.map(({ ruleId, group, rows }, index) => {
    const conditions = {};

    rows.forEach((row) => {
      const questionId = toText(row["判定対象の質問ID"]);
      const optionId = toText(row["選択肢ID"]);
      conditions[questionId] = optionId;
    });

    const firstRow = rows[0];

    return {
      id: `${ruleId}-g${group}`,
      sourceRuleId: ruleId,
      priority: index + 1,
      conditions,
      resultExpenseTypeId: toText(firstRow["表示する経費タイプID"]),
      message: toText(firstRow["ユーザーへ案内するメッセージ"]),
      warningMessage: toText(firstRow["注意事項"]),
      active: true,
    };
  });
}

// (ルールID, 条件グループ) でまとめた1グループ内の行同士に矛盾が無いかを検証する。
function validateRuleGroups(groups) {
  const errors = [];
  const warnings = [];

  groups.forEach(({ ruleId, group, rows }) => {
    const label = `${ruleId}(グループ${group})`;
    const optionByQuestion = {};
    const seenRowKeys = new Set();

    let expenseTypeId;
    let message;
    let warningMessage;

    rows.forEach((row) => {
      const questionId = toText(row["判定対象の質問ID"]);
      const optionId = toText(row["選択肢ID"]);
      const rowExpenseTypeId = toText(row["表示する経費タイプID"]);
      const rowMessage = toText(row["ユーザーへ案内するメッセージ"]);
      const rowWarningMessage = toText(row["注意事項"]);

      const rowKey = `${questionId}|${optionId}`;
      if (seenRowKeys.has(rowKey)) {
        warnings.push(
          `【06_判定ルール】ルール「${label}」で質問ID「${questionId}」/選択肢ID「${optionId}」の行が重複しています。`,
        );
      }
      seenRowKeys.add(rowKey);

      if (
        questionId in optionByQuestion &&
        optionByQuestion[questionId] !== optionId
      ) {
        errors.push(
          `【06_判定ルール】ルール「${label}」内で質問ID「${questionId}」に異なる選択肢ID（「${optionByQuestion[questionId]}」と「${optionId}」）が設定されています。`,
        );
      }
      optionByQuestion[questionId] = optionId;

      if (expenseTypeId === undefined) {
        expenseTypeId = rowExpenseTypeId;
      } else if (expenseTypeId !== rowExpenseTypeId) {
        errors.push(
          `【06_判定ルール】ルール「${label}」内で表示する経費タイプIDが一致しません（「${expenseTypeId}」と「${rowExpenseTypeId}」）。`,
        );
      }

      if (message === undefined) {
        message = rowMessage;
      } else if (message !== rowMessage) {
        errors.push(
          `【06_判定ルール】ルール「${label}」内でユーザーへ案内するメッセージが一致しません。`,
        );
      }

      if (warningMessage === undefined) {
        warningMessage = rowWarningMessage;
      } else if (warningMessage !== rowWarningMessage) {
        errors.push(
          `【06_判定ルール】ルール「${label}」内で注意事項が一致しません。`,
        );
      }
    });
  });

  return { errors, warnings };
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();

  values.forEach((value) => {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  });

  return [...duplicates];
}

function validateNewSchema({
  companySheet,
  policySheet,
  expenseTypeSheet,
  questionSheet,
  optionSheet,
  ruleSheet,
}) {
  const errors = [];
  const warnings = [];

  const questionIds = new Set(questionSheet.map((row) => toText(row["質問ID"])));
  const optionIds = new Set(optionSheet.map((row) => toText(row["選択肢ID"])));
  const expenseTypeIds = new Set(
    expenseTypeSheet.map((row) => toText(row["経費タイプID"])),
  );
  const policyIds = new Set(policySheet.map((row) => toText(row["ポリシーID"])));

  // ID形式チェック
  questionSheet.forEach((row) => {
    const id = toText(row["質問ID"]);
    if (!QUESTION_ID_PATTERN.test(id)) {
      errors.push(`【04_質問】質問ID「${id}」の形式が不正です（Q001形式である必要があります）。`);
    }
  });

  optionSheet.forEach((row) => {
    const id = toText(row["選択肢ID"]);
    if (!OPTION_ID_PATTERN.test(id)) {
      errors.push(`【05_選択肢】選択肢ID「${id}」の形式が不正です（O001形式である必要があります）。`);
    }
  });

  ruleSheet.forEach((row) => {
    const id = toText(row["ルールID"]);
    if (!RULE_ID_PATTERN.test(id)) {
      errors.push(`【06_判定ルール】ルールID「${id}」の形式が不正です（r001形式である必要があります）。`);
    }
  });

  // 重複チェック
  findDuplicates(questionSheet.map((row) => toText(row["質問ID"]))).forEach((id) => {
    errors.push(`【04_質問】質問ID「${id}」が重複しています。`);
  });

  findDuplicates(optionSheet.map((row) => toText(row["選択肢ID"]))).forEach((id) => {
    errors.push(`【05_選択肢】選択肢ID「${id}」が重複しています。`);
  });

  // ルールIDは (ルールID, 条件グループ) が同一の行が複数存在すること自体は正常（同一ルールの
  // 複数条件行）なので、単純な重複チェックは行わない。グループ内の整合性は後段でチェックする。

  findDuplicates(expenseTypeSheet.map((row) => toText(row["経費タイプID"]))).forEach(
    (id) => {
      errors.push(`【03_経費タイプ】経費タイプID「${id}」が重複しています。`);
    },
  );

  // 参照整合性チェック
  optionSheet.forEach((row) => {
    const optionId = toText(row["選択肢ID"]);
    const questionId = toText(row["質問ID"]);
    const nextQuestionId = toOptionalText(row["次に質問する質問ID"]);

    if (!questionIds.has(questionId)) {
      errors.push(
        `【05_選択肢】選択肢「${optionId}」の質問ID「${questionId}」が04_質問に存在しません。`,
      );
    }

    if (nextQuestionId && !questionIds.has(nextQuestionId)) {
      errors.push(
        `【05_選択肢】選択肢「${optionId}」の次に質問する質問ID「${nextQuestionId}」が04_質問に存在しません。`,
      );
    }
  });

  ruleSheet.forEach((row) => {
    const ruleId = toText(row["ルールID"]);
    const questionId = toText(row["判定対象の質問ID"]);
    const optionId = toText(row["選択肢ID"]);
    const expenseTypeId = toText(row["表示する経費タイプID"]);

    if (!questionIds.has(questionId)) {
      errors.push(
        `【06_判定ルール】ルール「${ruleId}」の質問ID「${questionId}」が04_質問に存在しません。`,
      );
    }

    if (!optionIds.has(optionId)) {
      errors.push(
        `【06_判定ルール】ルール「${ruleId}」の選択肢ID「${optionId}」が05_選択肢に存在しません。`,
      );
    } else {
      const option = optionSheet.find((o) => toText(o["選択肢ID"]) === optionId);
      if (option && toText(option["質問ID"]) !== questionId) {
        errors.push(
          `【06_判定ルール】ルール「${ruleId}」: 選択肢「${optionId}」は質問「${toText(option["質問ID"])}」に属しており、指定された質問ID「${questionId}」と一致しません。`,
        );
      }
    }

    if (!expenseTypeIds.has(expenseTypeId)) {
      errors.push(
        `【06_判定ルール】ルール「${ruleId}」の経費タイプID「${expenseTypeId}」が03_経費タイプに存在しません。`,
      );
    }
  });

  // (ルールID, 条件グループ) 単位のグループ内整合性チェック
  const ruleGroupValidation = validateRuleGroups(groupRuleRows(ruleSheet));
  errors.push(...ruleGroupValidation.errors);
  warnings.push(...ruleGroupValidation.warnings);

  expenseTypeSheet.forEach((row) => {
    const expenseTypeId = toText(row["経費タイプID"]);
    const policyId = toText(row["ポリシーID"]);

    if (!policyIds.has(policyId)) {
      errors.push(
        `【03_経費タイプ】経費タイプ「${expenseTypeId}」のポリシーID「${policyId}」が02_ポリシーに存在しません。`,
      );
    }
  });

  // 到達可能性チェック（Warning）
  const optionsByQuestion = {};
  optionSheet.forEach((row) => {
    const questionId = toText(row["質問ID"]);
    (optionsByQuestion[questionId] ||= []).push(row);
  });

  const firstQuestionId = [...questionSheet].sort(
    (left, right) => Number(left["質問の表示順"]) - Number(right["質問の表示順"]),
  )[0]?.["質問ID"];

  const visited = new Set();
  const queue = firstQuestionId ? [toText(firstQuestionId)] : [];

  while (queue.length > 0) {
    const questionId = queue.shift();
    if (visited.has(questionId)) {
      continue;
    }
    visited.add(questionId);

    (optionsByQuestion[questionId] || []).forEach((row) => {
      const nextQuestionId = toOptionalText(row["次に質問する質問ID"]);
      if (nextQuestionId) {
        queue.push(nextQuestionId);
      }
    });
  }

  questionSheet.forEach((row) => {
    const questionId = toText(row["質問ID"]);
    if (!visited.has(questionId)) {
      warnings.push(
        `【04_質問】質問「${questionId}（${toText(row["質問文"])}）」は最初の質問から到達できません。`,
      );
    }
  });

  // 終端選択肢にルールが無い場合（Warning）
  const rulesByQuestionOption = new Set(
    ruleSheet.map(
      (row) => `${toText(row["判定対象の質問ID"])}|${toText(row["選択肢ID"])}`,
    ),
  );

  optionSheet.forEach((row) => {
    const nextQuestionId = toOptionalText(row["次に質問する質問ID"]);
    if (nextQuestionId) {
      return;
    }

    const questionId = toText(row["質問ID"]);
    const optionId = toText(row["選択肢ID"]);

    if (!rulesByQuestionOption.has(`${questionId}|${optionId}`)) {
      warnings.push(
        `【05_選択肢】終端選択肢「${questionId}/${optionId}（${toText(row["ボタンに表示する文字"])}）」に対応する判定ルールが06_判定ルールに存在しません。`,
      );
    }
  });

  // 未使用の経費タイプ（Warning）
  const usedExpenseTypeIds = new Set(
    ruleSheet.map((row) => toText(row["表示する経費タイプID"])),
  );

  expenseTypeSheet.forEach((row) => {
    const expenseTypeId = toText(row["経費タイプID"]);
    if (!usedExpenseTypeIds.has(expenseTypeId)) {
      warnings.push(
        `【03_経費タイプ】経費タイプ「${expenseTypeId}（${toText(row["経費タイプ名"])}）」はどの判定ルールからも使用されていません。`,
      );
    }
  });

  return { errors, warnings };
}

module.exports = {
  createCompanyFromNewSchema,
  createPoliciesFromNewSchema,
  createExpenseTypesFromNewSchema,
  createQuestionsWithOptionsFromNewSchema,
  createRulesFromNewSchema,
  validateNewSchema,
};
