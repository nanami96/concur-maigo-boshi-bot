function normalizeText(value) {
  return String(value ?? "").toLowerCase();
}

function includesQuery(value, query) {
  return normalizeText(value).includes(query);
}

function getExpenseTypeName(config, expenseTypeId) {
  return (
    config.expenseTypes.find((expenseType) => expenseType.id === expenseTypeId)
      ?.name || expenseTypeId
  );
}

function optionId(questionId, option) {
  return `${questionId}-${option.value}`;
}

function questionMatches(question, query) {
  return (
    includesQuery(question.id, query) ||
    includesQuery(question.text, query) ||
    (question.options || []).some(
      (option) =>
        includesQuery(option.label, query) ||
        includesQuery(option.value, query) ||
        includesQuery(option.nextQuestionId, query),
    )
  );
}

function optionMatches(option, query) {
  return (
    includesQuery(option.label, query) ||
    includesQuery(option.value, query) ||
    includesQuery(option.nextQuestionId, query)
  );
}

function ruleMatches(config, rule, query) {
  const expenseTypeName = getExpenseTypeName(config, rule.resultExpenseTypeId);

  return (
    includesQuery(rule.id, query) ||
    includesQuery(rule.resultExpenseTypeId, query) ||
    includesQuery(expenseTypeName, query) ||
    includesQuery(rule.message, query)
  );
}

function expenseTypeMatches(expenseType, query) {
  return (
    includesQuery(expenseType.id, query) ||
    includesQuery(expenseType.name, query)
  );
}

function diffItemMatches(item, query) {
  return (
    includesQuery(item.id, query) ||
    includesQuery(JSON.stringify(item.previous || ""), query) ||
    includesQuery(JSON.stringify(item.current || ""), query)
  );
}

function filterDiffGroup(items, query) {
  return items.filter((item) => diffItemMatches(item, query));
}

function filterDiff(diff, query) {
  if (!diff) {
    return diff;
  }

  const targets = Object.entries(diff.targets).reduce(
    (result, [targetKey, targetDiff]) => {
      result[targetKey] = {
        ...targetDiff,
        added: filterDiffGroup(targetDiff.added, query),
        removed: filterDiffGroup(targetDiff.removed, query),
        changed: filterDiffGroup(targetDiff.changed, query),
      };
      return result;
    },
    {},
  );

  const summary = Object.values(targets).reduce(
    (result, targetDiff) => {
      result.added += targetDiff.added.length;
      result.removed += targetDiff.removed.length;
      result.changed += targetDiff.changed.length;
      return result;
    },
    {
      added: 0,
      removed: 0,
      changed: 0,
    },
  );

  return {
    targets,
    summary,
    hasDiff: summary.added + summary.removed + summary.changed > 0,
  };
}

function toArray(set) {
  return [...set];
}

export function searchConfig(config, searchQuery, diff) {
  const query = normalizeText(searchQuery).trim();

  if (!query) {
    return {
      hasQuery: false,
      hasMatches: true,
      matches: {
        questionIds: config.questions.map((question) => question.id),
        optionIds: config.questions.flatMap((question) =>
          (question.options || []).map((option) => optionId(question.id, option)),
        ),
        ruleIds: config.rules.map((rule) => rule.id),
        expenseTypeIds: config.expenseTypes.map((expenseType) => expenseType.id),
      },
      filtered: {
        questions: config.questions,
        rules: config.rules,
        expenseTypes: config.expenseTypes,
        diff,
      },
    };
  }

  const questionIds = new Set();
  const optionIds = new Set();
  const ruleIds = new Set();
  const expenseTypeIds = new Set();

  config.questions.forEach((question) => {
    if (questionMatches(question, query)) {
      questionIds.add(question.id);
    }

    (question.options || []).forEach((option) => {
      if (optionMatches(option, query)) {
        optionIds.add(optionId(question.id, option));
        questionIds.add(question.id);
      }
    });
  });

  config.expenseTypes.forEach((expenseType) => {
    if (expenseTypeMatches(expenseType, query)) {
      expenseTypeIds.add(expenseType.id);
    }
  });

  config.rules.forEach((rule) => {
    if (
      ruleMatches(config, rule, query) ||
      expenseTypeIds.has(rule.resultExpenseTypeId)
    ) {
      ruleIds.add(rule.id);
      expenseTypeIds.add(rule.resultExpenseTypeId);
      Object.keys(rule.conditions || {}).forEach((questionId) =>
        questionIds.add(questionId),
      );
    }
  });

  const filteredDiff = filterDiff(diff, query);
  const diffHasMatches = Boolean(filteredDiff?.hasDiff);
  const hasMatches =
    questionIds.size > 0 ||
    optionIds.size > 0 ||
    ruleIds.size > 0 ||
    expenseTypeIds.size > 0 ||
    diffHasMatches;

  return {
    hasQuery: true,
    hasMatches,
    matches: {
      questionIds: toArray(questionIds),
      optionIds: toArray(optionIds),
      ruleIds: toArray(ruleIds),
      expenseTypeIds: toArray(expenseTypeIds),
    },
    filtered: {
      questions: config.questions.filter((question) =>
        questionIds.has(question.id),
      ),
      rules: config.rules.filter((rule) => ruleIds.has(rule.id)),
      expenseTypes: config.expenseTypes.filter((expenseType) =>
        expenseTypeIds.has(expenseType.id),
      ),
      diff: filteredDiff,
    },
  };
}
