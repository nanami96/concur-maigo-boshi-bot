const fs = require("fs");
const path = require("path");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getExpenseTypeName(config, expenseTypeId) {
  return (
    (config.expenseTypes || []).find(
      (expenseType) => expenseType.id === expenseTypeId,
    )?.name || expenseTypeId
  );
}

function getQuestionText(config, questionId) {
  return (
    (config.questions || []).find((question) => question.id === questionId)
      ?.text || questionId
  );
}

function checkConfigForReport(config) {
  const errors = [];
  const warnings = [];
  const questions = config.questions || [];
  const rules = config.rules || [];
  const expenseTypes = config.expenseTypes || [];
  const questionIds = new Set(questions.map((question) => question.id));
  const expenseTypeIds = new Set(
    expenseTypes.map((expenseType) => expenseType.id),
  );
  const usedQuestionIds = new Set();
  const usedExpenseTypeIds = new Set();

  if (questions.length === 0) {
    errors.push({
      level: "error",
      target: "questions",
      message: "questions が設定されていません。",
    });
  }

  if (rules.length === 0) {
    errors.push({
      level: "error",
      target: "rules",
      message: "rules が設定されていません。",
    });
  }

  questions.forEach((question) => {
    (question.options || []).forEach((option) => {
      if (option.nextQuestionId && !questionIds.has(option.nextQuestionId)) {
        errors.push({
          level: "error",
          target: question.id,
          message: `${question.id} の選択肢 ${option.value} が存在しない質問 ${option.nextQuestionId} を参照しています。`,
        });
      }
    });
  });

  rules.forEach((rule) => {
    Object.keys(rule.conditions || {}).forEach((questionId) => {
      usedQuestionIds.add(questionId);

      if (!questionIds.has(questionId)) {
        errors.push({
          level: "error",
          target: rule.id,
          message: `${rule.id} が存在しない質問 ${questionId} を参照しています。`,
        });
      }
    });

    usedExpenseTypeIds.add(rule.resultExpenseTypeId);

    if (!expenseTypeIds.has(rule.resultExpenseTypeId)) {
      errors.push({
        level: "error",
        target: rule.id,
        message: `${rule.id} が存在しない経費タイプ ${rule.resultExpenseTypeId} を参照しています。`,
      });
    }
  });

  questions.forEach((question) => {
    if (!usedQuestionIds.has(question.id)) {
      warnings.push({
        level: "warning",
        target: question.id,
        message: `${question.id} は判定ルールの条件で使用されていません。`,
      });
    }
  });

  expenseTypes.forEach((expenseType) => {
    if (!usedExpenseTypeIds.has(expenseType.id)) {
      warnings.push({
        level: "warning",
        target: expenseType.id,
        message: `${expenseType.id} は判定ルールの結果で使用されていません。`,
      });
    }
  });

  return {
    errors,
    warnings,
    info:
      errors.length === 0 && warnings.length === 0
        ? [
            {
              level: "info",
              target: "config",
              message: "設定チェックOK",
            },
          ]
        : [],
  };
}

function buildFlowSummary(config) {
  const questionsById = new Map(
    (config.questions || []).map((question) => [question.id, question]),
  );
  const firstQuestion = (config.questions || [])[0];
  const lines = [];
  const visited = new Set();

  function visit(question, depth) {
    if (!question || visited.has(question.id)) {
      return;
    }

    visited.add(question.id);
    lines.push({
      depth,
      text: `${question.id}: ${question.text}`,
    });

    (question.options || []).forEach((option) => {
      if (option.nextQuestionId) {
        lines.push({
          depth: depth + 1,
          text: `${option.label} (${option.value}) -> ${option.nextQuestionId}`,
        });
        visit(questionsById.get(option.nextQuestionId), depth + 2);
        return;
      }

      const matchedRules = (config.rules || []).filter(
        (rule) => rule.conditions?.[question.id] === option.value,
      );
      const resultText =
        matchedRules.length > 0
          ? matchedRules
              .map(
                (rule) =>
                  `${rule.id}: ${getExpenseTypeName(
                    config,
                    rule.resultExpenseTypeId,
                  )}`,
              )
              .join(", ")
          : "該当ルールなし";

      lines.push({
        depth: depth + 1,
        text: `${option.label} (${option.value}) -> ${resultText}`,
      });
    });
  }

  if (firstQuestion) {
    visit(firstQuestion, 0);
  }

  return lines;
}

function renderKeyValueTable(values) {
  return `
    <table>
      <tbody>
        ${Object.entries(values || {})
          .map(
            ([key, value]) => `
              <tr>
                <th>${escapeHtml(key)}</th>
                <td>${escapeHtml(value)}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderQuestions(config) {
  return `
    <table>
      <thead>
        <tr><th>ID</th><th>質問文</th><th>選択肢</th></tr>
      </thead>
      <tbody>
        ${(config.questions || [])
          .map(
            (question) => `
              <tr>
                <td>${escapeHtml(question.id)}</td>
                <td>${escapeHtml(question.text)}</td>
                <td>
                  <ul>
                    ${(question.options || [])
                      .map(
                        (option) => `
                          <li>
                            ${escapeHtml(option.label)} (${escapeHtml(
                              option.value,
                            )})
                            ${
                              option.nextQuestionId
                                ? ` -> ${escapeHtml(option.nextQuestionId)}`
                                : " -> 結果"
                            }
                          </li>
                        `,
                      )
                      .join("")}
                  </ul>
                </td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderRules(config) {
  return `
    <table>
      <thead>
        <tr><th>ID</th><th>条件</th><th>経費タイプ</th><th>案内メッセージ</th></tr>
      </thead>
      <tbody>
        ${(config.rules || [])
          .map(
            (rule) => `
              <tr>
                <td>${escapeHtml(rule.id)}</td>
                <td>
                  <ul>
                    ${Object.entries(rule.conditions || {})
                      .map(
                        ([questionId, value]) => `
                          <li>${escapeHtml(getQuestionText(config, questionId))}: ${escapeHtml(value)}</li>
                        `,
                      )
                      .join("")}
                  </ul>
                </td>
                <td>${escapeHtml(getExpenseTypeName(config, rule.resultExpenseTypeId))}</td>
                <td>${escapeHtml(rule.message)}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderExpenseTypes(config) {
  return `
    <table>
      <thead>
        <tr><th>ID</th><th>名称</th><th>領収書</th><th>有効</th></tr>
      </thead>
      <tbody>
        ${(config.expenseTypes || [])
          .map(
            (expenseType) => `
              <tr>
                <td>${escapeHtml(expenseType.id)}</td>
                <td>${escapeHtml(expenseType.name)}</td>
                <td>${escapeHtml(expenseType.receiptRequired ? "必要" : "不要")}</td>
                <td>${escapeHtml(expenseType.active ? "有効" : "無効")}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderCheckResult(checkResult) {
  const items = [
    ...checkResult.errors,
    ...checkResult.warnings,
    ...checkResult.info,
  ];

  return `
    <div class="metrics">
      <div class="metric error"><span>Error</span><strong>${checkResult.errors.length}</strong></div>
      <div class="metric warning"><span>Warning</span><strong>${checkResult.warnings.length}</strong></div>
      <div class="metric info"><span>Info</span><strong>${checkResult.info.length}</strong></div>
    </div>
    <ul class="check-list">
      ${items
        .map(
          (item) => `
            <li class="${escapeHtml(item.level)}">
              <strong>${escapeHtml(item.level.toUpperCase())}: ${escapeHtml(item.target)}</strong>
              <p>${escapeHtml(item.message)}</p>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function renderFlowSummary(config) {
  const lines = buildFlowSummary(config);

  if (lines.length === 0) {
    return `<p class="empty">判定フローがありません。</p>`;
  }

  return `
    <ol class="flow-list">
      ${lines
        .map(
          (line) => `
            <li style="margin-left: ${line.depth * 18}px">${escapeHtml(line.text)}</li>
          `,
        )
        .join("")}
    </ol>
  `;
}

function generateReportHtml(config, companyId) {
  const checkResult = checkConfigForReport(config);
  const generatedAt = new Date().toISOString();

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(companyId)} 設定レビューレポート</title>
  <style>
    :root { color: #172033; background: #eef2f7; font-family: "Segoe UI", sans-serif; }
    body { margin: 0; padding: 32px; }
    main { max-width: 1100px; margin: 0 auto; display: grid; gap: 20px; }
    header, section { background: #fff; border: 1px solid #d7deea; border-radius: 8px; padding: 20px; }
    h1, h2 { margin: 0; }
    h1 { font-size: 28px; }
    h2 { margin-bottom: 14px; font-size: 20px; }
    .meta { color: #64748b; margin: 8px 0 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-top: 1px solid #e2e8f0; padding: 10px; text-align: left; vertical-align: top; }
    th { width: 180px; color: #475569; background: #f8fafc; }
    ul, ol { margin: 0; padding-left: 20px; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
    .metric { border: 1px solid #d7deea; border-radius: 8px; padding: 12px; }
    .metric span { display: block; font-size: 12px; font-weight: 700; }
    .metric strong { display: block; font-size: 24px; }
    .error { border-color: #fecaca; background: #fef2f2; color: #991b1b; }
    .warning { border-color: #fde68a; background: #fffbeb; color: #92400e; }
    .info { border-color: #bbf7d0; background: #f0fdf4; color: #166534; }
    .check-list { display: grid; gap: 10px; padding-left: 0; list-style: none; }
    .check-list li { border-radius: 8px; padding: 12px; }
    .check-list p { margin: 6px 0 0; }
    .flow-list { display: grid; gap: 8px; }
    .empty { color: #64748b; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>設定レビューレポート</h1>
      <p class="meta">Company: ${escapeHtml(companyId)} / Generated: ${escapeHtml(generatedAt)}</p>
    </header>
    <section>
      <h2>会社情報</h2>
      ${renderKeyValueTable(config.company)}
    </section>
    <section>
      <h2>質問一覧</h2>
      ${renderQuestions(config)}
    </section>
    <section>
      <h2>判定ルール一覧</h2>
      ${renderRules(config)}
    </section>
    <section>
      <h2>経費タイプ一覧</h2>
      ${renderExpenseTypes(config)}
    </section>
    <section>
      <h2>設定チェック結果</h2>
      ${renderCheckResult(checkResult)}
    </section>
    <section>
      <h2>判定フロー概要</h2>
      ${renderFlowSummary(config)}
    </section>
  </main>
</body>
</html>`;
}

function exportReport(companyId, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const configPath = path.join(rootDir, "rules", companyId, "config.json");
  const outputDir = path.join(rootDir, "reports");
  const outputPath = path.join(outputDir, `${companyId}-review.html`);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const html = generateReportHtml(config, companyId);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, html, "utf8");

  return {
    outputPath,
    html,
  };
}

module.exports = {
  buildFlowSummary,
  checkConfigForReport,
  exportReport,
  generateReportHtml,
};
