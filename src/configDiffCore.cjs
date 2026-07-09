const DIFF_TARGETS = [
  {
    key: "questions",
    label: "questions",
  },
  {
    key: "rules",
    label: "rules",
  },
  {
    key: "expenseTypes",
    label: "expenseTypes",
  },
];

function normalizeForCompare(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeForCompare);
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((normalized, key) => {
        normalized[key] = normalizeForCompare(value[key]);
        return normalized;
      }, {});
  }

  return value;
}

function isEqualConfigItem(left, right) {
  return (
    JSON.stringify(normalizeForCompare(left)) ===
    JSON.stringify(normalizeForCompare(right))
  );
}

function formatPath(parts) {
  return parts.length > 0 ? parts.join(".") : "(root)";
}

function getChangedFields(previous, current, path = []) {
  if (isEqualConfigItem(previous, current)) {
    return [];
  }

  const previousIsObject =
    previous && typeof previous === "object" && !Array.isArray(previous);
  const currentIsObject =
    current && typeof current === "object" && !Array.isArray(current);

  if (!previousIsObject || !currentIsObject) {
    return [
      {
        field: formatPath(path),
        before: previous,
        after: current,
      },
    ];
  }

  return [...new Set([...Object.keys(previous), ...Object.keys(current)])]
    .sort()
    .flatMap((key) =>
      getChangedFields(previous[key], current[key], [...path, key]),
    );
}

function indexById(items = []) {
  return new Map(items.map((item) => [item.id, item]));
}

function diffItems(previousItems = [], currentItems = []) {
  const previousById = indexById(previousItems);
  const currentById = indexById(currentItems);

  const added = currentItems
    .filter((item) => !previousById.has(item.id))
    .map((item) => ({
      type: "added",
      id: item.id,
      current: item,
    }));

  const removed = previousItems
    .filter((item) => !currentById.has(item.id))
    .map((item) => ({
      type: "removed",
      id: item.id,
      previous: item,
    }));

  const changed = currentItems
    .filter((item) => {
      const previous = previousById.get(item.id);
      return previous && !isEqualConfigItem(previous, item);
    })
    .map((item) => ({
      type: "changed",
      id: item.id,
      previous: previousById.get(item.id),
      current: item,
      changes: getChangedFields(previousById.get(item.id), item),
    }));

  return {
    added,
    removed,
    changed,
  };
}

function countDiffs(targetDiff) {
  return (
    targetDiff.added.length +
    targetDiff.removed.length +
    targetDiff.changed.length
  );
}

function diffConfigs(previousConfig, currentConfig) {
  const targets = DIFF_TARGETS.reduce((result, target) => {
    result[target.key] = {
      label: target.label,
      ...diffItems(previousConfig?.[target.key], currentConfig?.[target.key]),
    };
    return result;
  }, {});

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
    hasDiff: Object.values(targets).some((targetDiff) => countDiffs(targetDiff)),
  };
}

module.exports = {
  compareConfigs: diffConfigs,
  diffConfigs,
};
