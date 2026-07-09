const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { compareConfigs } = require("../src/configDiffCore.cjs");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDiffValue(value) {
  if (value === undefined) {
    return "(未設定)";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(date);
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
      kind: "question",
      text: `${question.id}: ${question.text}`,
    });

    (question.options || []).forEach((option) => {
      if (option.nextQuestionId) {
        lines.push({
          depth: depth + 1,
          kind: "option",
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
        kind: "result",
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
    <table class="data-table key-value-table">
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
    <table class="data-table">
      <thead>
        <tr><th>ID</th><th>質問文</th><th>選択肢と遷移</th></tr>
      </thead>
      <tbody>
        ${(config.questions || [])
          .map(
            (question) => `
              <tr>
                <td><span class="code">${escapeHtml(question.id)}</span></td>
                <td>${escapeHtml(question.text)}</td>
                <td>
                  <ul class="compact-list">
                    ${(question.options || [])
                      .map(
                        (option) => `
                          <li>
                            <strong>${escapeHtml(option.label)}</strong>
                            <span class="muted">(${escapeHtml(option.value)})</span>
                            <span class="arrow">-></span>
                            ${
                              option.nextQuestionId
                                ? `<span class="code">${escapeHtml(option.nextQuestionId)}</span>`
                                : `<span class="result-label">結果</span>`
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
    <table class="data-table">
      <thead>
        <tr><th>ID</th><th>条件</th><th>経費タイプ</th><th>案内メッセージ</th></tr>
      </thead>
      <tbody>
        ${(config.rules || [])
          .map(
            (rule) => `
              <tr>
                <td><span class="code">${escapeHtml(rule.id)}</span></td>
                <td>
                  <ul class="compact-list">
                    ${Object.entries(rule.conditions || {})
                      .map(
                        ([questionId, value]) => `
                          <li>
                            ${escapeHtml(getQuestionText(config, questionId))}
                            <span class="muted">(${escapeHtml(questionId)}: ${escapeHtml(value)})</span>
                          </li>
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
    <table class="data-table">
      <thead>
        <tr><th>ID</th><th>名称</th><th>領収書</th><th>状態</th></tr>
      </thead>
      <tbody>
        ${(config.expenseTypes || [])
          .map(
            (expenseType) => `
              <tr>
                <td><span class="code">${escapeHtml(expenseType.id)}</span></td>
                <td>${escapeHtml(expenseType.name)}</td>
                <td>${escapeHtml(expenseType.receiptRequired ? "必要" : "不要")}</td>
                <td>
                  <span class="status ${expenseType.active ? "active" : "inactive"}">
                    ${escapeHtml(expenseType.active ? "有効" : "無効")}
                  </span>
                </td>
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

function renderDiffObject(value) {
  return `<pre>${escapeHtml(formatDiffValue(value))}</pre>`;
}

function renderDiffItems(title, items, type) {
  if (items.length === 0) {
    return "";
  }

  return `
    <div class="diff-group ${escapeHtml(type)}">
      <h3>${escapeHtml(title)}</h3>
      <ul class="diff-list">
        ${items
          .map(
            (item) => `
              <li>
                <span class="code">${escapeHtml(item.id)}</span>
                ${renderDiffObject(type === "added" ? item.current : item.previous)}
              </li>
            `,
          )
          .join("")}
      </ul>
    </div>
  `;
}

function renderChangedItems(items) {
  if (items.length === 0) {
    return "";
  }

  return `
    <div class="diff-group changed">
      <h3>Changed</h3>
      <ul class="diff-list">
        ${items
          .map(
            (item) => `
              <li>
                <span class="code">${escapeHtml(item.id)}</span>
                <table class="data-table diff-change-table">
                  <thead>
                    <tr><th>変更項目</th><th>Before</th><th>After</th></tr>
                  </thead>
                  <tbody>
                    ${item.changes
                      .map(
                        (change) => `
                          <tr>
                            <td>${escapeHtml(change.field)}</td>
                            <td>${renderDiffObject(change.before)}</td>
                            <td>${renderDiffObject(change.after)}</td>
                          </tr>
                        `,
                      )
                      .join("")}
                  </tbody>
                </table>
              </li>
            `,
          )
          .join("")}
      </ul>
    </div>
  `;
}

function renderConfigDiff(diff) {
  if (!diff.hasDiff) {
    return `<p class="empty">差分はありません</p>`;
  }

  return `
    <div class="metrics">
      <div class="metric added"><span>Added</span><strong>${diff.summary.added}</strong></div>
      <div class="metric removed"><span>Removed</span><strong>${diff.summary.removed}</strong></div>
      <div class="metric changed"><span>Changed</span><strong>${diff.summary.changed}</strong></div>
    </div>
    <div class="diff-targets">
      ${Object.entries(diff.targets)
        .map(
          ([targetKey, targetDiff]) => `
            <section class="diff-target">
              <div class="section-heading compact">
                <h3>${escapeHtml(targetDiff.label)}</h3>
                <span>${escapeHtml(targetKey)}</span>
              </div>
              ${renderDiffItems("Added", targetDiff.added, "added")}
              ${renderDiffItems("Removed", targetDiff.removed, "removed")}
              ${renderChangedItems(targetDiff.changed)}
            </section>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderReviewCommentSection() {
  return `
    <div class="review-fields">
      <div class="review-field">
        <span>レビュー担当</span>
        <div class="write-line"></div>
      </div>
      <div class="review-field">
        <span>レビュー日</span>
        <div class="write-line"></div>
      </div>
      <div class="review-field wide">
        <span>備考</span>
        <div class="write-line"></div>
      </div>
    </div>

    <div class="review-result">
      <h3>確認結果</h3>
      <label><span class="checkbox"></span>問題なし</label>
      <label><span class="checkbox"></span>修正あり</label>
      <label><span class="checkbox"></span>再レビュー必要</label>
    </div>

    <div class="review-comment">
      <h3>レビューコメント</h3>
      <div class="comment-box"></div>
    </div>
  `;
}

function renderAiReviewComments(reviewComments) {
  return `
    <div class="ai-review-grid">
      <div class="ai-review-card good">
        <h3>良い点</h3>
        <ul>
          ${(reviewComments.goodPoints || [])
            .map((comment) => `<li>${escapeHtml(comment)}</li>`)
            .join("")}
        </ul>
      </div>
      <div class="ai-review-card improvement">
        <h3>改善候補</h3>
        <ul>
          ${(reviewComments.improvementCandidates || [])
            .map((comment) => `<li>${escapeHtml(comment)}</li>`)
            .join("")}
        </ul>
      </div>
    </div>
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
            <li class="${escapeHtml(line.kind)}" style="--depth: ${line.depth}">
              ${escapeHtml(line.text)}
            </li>
          `,
        )
        .join("")}
    </ol>
  `;
}

function renderSummaryCards(config, checkResult) {
  return `
    <div class="summary-grid">
      <div class="summary-card"><span>質問</span><strong>${(config.questions || []).length}</strong></div>
      <div class="summary-card"><span>判定ルール</span><strong>${(config.rules || []).length}</strong></div>
      <div class="summary-card"><span>経費タイプ</span><strong>${(config.expenseTypes || []).length}</strong></div>
      <div class="summary-card risk"><span>要確認</span><strong>${checkResult.errors.length + checkResult.warnings.length}</strong></div>
    </div>
  `;
}

function renderReportStyles() {
  return `
    :root {
      color: #172033;
      background: #eef2f7;
      font-family: "Segoe UI", "Hiragino Sans", "Yu Gothic", sans-serif;
      line-height: 1.55;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px; display: grid; gap: 18px; }
    .cover {
      min-height: 260px;
      display: grid;
      align-content: space-between;
      gap: 28px;
      border-radius: 12px;
      background: linear-gradient(135deg, #174ea6 0%, #2563eb 45%, #0f766e 100%);
      color: #ffffff;
      padding: 32px;
      page-break-after: avoid;
    }
    .cover h1 { margin: 0; font-size: 34px; letter-spacing: 0; }
    .cover p { margin: 10px 0 0; color: #dbeafe; }
    .cover-meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .cover-meta div {
      border: 1px solid rgba(255,255,255,.35);
      border-radius: 8px;
      background: rgba(255,255,255,.12);
      padding: 12px;
    }
    .cover-meta span { display: block; color: #bfdbfe; font-size: 12px; font-weight: 700; }
    .cover-meta strong { display: block; margin-top: 4px; overflow-wrap: anywhere; }
    section {
      border: 1px solid #d7deea;
      border-radius: 10px;
      background: #ffffff;
      padding: 22px;
      box-shadow: 0 10px 24px rgba(15,23,42,.05);
      break-inside: avoid;
    }
    .section-heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 10px;
    }
    h1, h2 { margin: 0; }
    h2 { font-size: 20px; }
    .section-heading span { color: #64748b; font-size: 12px; font-weight: 700; }
    .summary-grid, .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 14px; }
    .summary-card, .metric {
      border: 1px solid #d7deea;
      border-radius: 8px;
      background: #f8fafc;
      padding: 14px;
    }
    .summary-card span, .metric span {
      display: block;
      color: #64748b;
      font-size: 12px;
      font-weight: 700;
    }
    .summary-card strong, .metric strong { display: block; margin-top: 5px; font-size: 26px; }
    .summary-card.risk strong { color: #92400e; }
    .data-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      overflow: hidden;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
    }
    .data-table th, .data-table td {
      border-top: 1px solid #e2e8f0;
      padding: 11px 12px;
      text-align: left;
      vertical-align: top;
    }
    .data-table thead th {
      border-top: 0;
      background: #eef2f7;
      color: #334155;
      font-size: 12px;
      letter-spacing: .02em;
    }
    .key-value-table th { width: 220px; background: #f8fafc; color: #475569; }
    .compact-list { display: grid; gap: 5px; margin: 0; padding-left: 18px; }
    .code {
      display: inline-block;
      max-width: 100%;
      border-radius: 999px;
      background: #eef2f7;
      color: #334155;
      padding: 2px 8px;
      overflow-wrap: anywhere;
      font-family: Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      font-weight: 700;
    }
    .muted { color: #64748b; }
    .arrow { color: #2563eb; font-weight: 700; }
    .result-label, .status {
      border-radius: 999px;
      background: #f0fdf4;
      color: #166534;
      padding: 2px 8px;
      font-size: 12px;
      font-weight: 700;
    }
    .status.inactive { background: #fef2f2; color: #991b1b; }
    .metric.error, .check-list .error { border-color: #fecaca; background: #fef2f2; color: #991b1b; }
    .metric.warning, .check-list .warning { border-color: #fde68a; background: #fffbeb; color: #92400e; }
    .metric.info, .check-list .info { border-color: #bbf7d0; background: #f0fdf4; color: #166534; }
    .metric.added { border-color: #bbf7d0; background: #f0fdf4; color: #166534; }
    .metric.removed { border-color: #fecaca; background: #fef2f2; color: #991b1b; }
    .metric.changed { border-color: #bfdbfe; background: #eff6ff; color: #1d4ed8; }
    .check-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
    .check-list li { border: 1px solid; border-radius: 8px; padding: 12px; }
    .check-list p { margin: 6px 0 0; color: inherit; }
    .diff-targets { display: grid; gap: 14px; margin-top: 14px; }
    .diff-target {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
      padding: 14px;
      box-shadow: none;
    }
    .section-heading.compact { margin-bottom: 10px; padding-bottom: 8px; }
    .section-heading.compact h3 { margin: 0; font-size: 16px; }
    .diff-group + .diff-group { margin-top: 12px; }
    .diff-group h3 { margin: 0 0 8px; font-size: 14px; }
    .diff-group.added h3 { color: #166534; }
    .diff-group.removed h3 { color: #991b1b; }
    .diff-group.changed h3 { color: #1d4ed8; }
    .diff-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
    .diff-list > li {
      display: grid;
      gap: 8px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #ffffff;
      padding: 12px;
    }
    .diff-list pre,
    .diff-change-table pre {
      max-height: 220px;
      margin: 0;
      overflow: auto;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
      color: #172033;
      padding: 10px;
      white-space: pre-wrap;
      word-break: break-word;
      font: 12px/1.5 Consolas, "Liberation Mono", monospace;
    }
    .diff-change-table { margin-top: 2px; }
    .review-fields {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 18px;
    }
    .review-field {
      display: grid;
      gap: 8px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
      padding: 12px;
    }
    .review-field.wide { grid-column: 1 / -1; }
    .review-field span,
    .review-result h3,
    .review-comment h3 {
      margin: 0;
      color: #475569;
      font-size: 13px;
      font-weight: 700;
    }
    .write-line {
      min-height: 34px;
      border-bottom: 1.5px solid #94a3b8;
      background: #ffffff;
    }
    .review-result {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px 18px;
      margin-bottom: 18px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #ffffff;
      padding: 12px;
    }
    .review-result label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
    }
    .checkbox {
      width: 18px;
      height: 18px;
      border: 1.8px solid #475569;
      border-radius: 3px;
      background: #ffffff;
      display: inline-block;
    }
    .review-comment {
      display: grid;
      gap: 10px;
    }
    .comment-box {
      min-height: 180px;
      border: 1.5px solid #94a3b8;
      border-radius: 8px;
      background:
        repeating-linear-gradient(
          #ffffff,
          #ffffff 31px,
          #e2e8f0 32px
        );
    }
    .ai-review-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .ai-review-card {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
      padding: 16px;
      break-inside: avoid;
    }
    .ai-review-card h3 {
      margin: 0 0 10px;
      font-size: 15px;
    }
    .ai-review-card ul {
      display: grid;
      gap: 8px;
      margin: 0;
      padding-left: 20px;
    }
    .ai-review-card li {
      break-inside: avoid;
    }
    .ai-review-card.good {
      border-color: #bbf7d0;
      background: #f0fdf4;
      color: #166534;
    }
    .ai-review-card.improvement {
      border-color: #fde68a;
      background: #fffbeb;
      color: #92400e;
    }
    .flow-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .flow-list li {
      margin-left: calc(var(--depth) * 20px);
      border-left: 4px solid #cbd5e1;
      border-radius: 6px;
      background: #f8fafc;
      padding: 9px 12px;
    }
    .flow-list .question { border-left-color: #2563eb; font-weight: 700; }
    .flow-list .option { border-left-color: #94a3b8; color: #475569; }
    .flow-list .result { border-left-color: #16a34a; color: #166534; }
    .empty { color: #64748b; }
    @media print {
      :root { background: #ffffff; color: #111827; }
      body { background: #ffffff; }
      main { max-width: none; padding: 0; gap: 14px; }
      .cover {
        color: #111827;
        background: #ffffff;
        border: 2px solid #111827;
        min-height: 220px;
      }
      .cover p, .cover-meta span { color: #374151; }
      .cover-meta div { border-color: #9ca3af; background: #ffffff; }
      section { box-shadow: none; border-color: #cbd5e1; break-inside: avoid; }
      .review-field, .review-result { background: #ffffff; }
      .ai-review-card { background: #ffffff; }
      .comment-box { min-height: 220px; }
      .data-table { font-size: 12px; }
      a { color: inherit; text-decoration: none; }
    }
    @media (max-width: 760px) {
      main { padding: 16px; }
      .cover-meta, .summary-grid, .metrics { grid-template-columns: 1fr; }
      .cover { padding: 22px; }
      .cover h1 { font-size: 26px; }
      .data-table { display: block; overflow-x: auto; }
      .review-fields { grid-template-columns: 1fr; }
      .ai-review-grid { grid-template-columns: 1fr; }
      .flow-list li { margin-left: 0; }
    }
  `;
}

async function loadReviewAdvisor() {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, "..", "src", "reviewAdvisorCore.mjs"),
  ).href;
  return import(moduleUrl);
}

async function generateReportHtml(config, companyId, options = {}) {
  const checkResult = checkConfigForReport(config);
  const configDiff = compareConfigs(options.compareConfig || config, config);
  const { generateReviewComments } = await loadReviewAdvisor();
  const reviewComments = generateReviewComments(config);
  const generatedAt = new Date();
  const company = config.company || {};
  const companyName = company.company_name || company.company_id || companyId;

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(companyName)} 設定レビューレポート</title>
  <style>${renderReportStyles()}</style>
</head>
<body>
  <main>
    <header class="cover">
      <div>
        <h1>設定レビューレポート</h1>
        <p>Excelから生成された設定内容を、レビュー・共有用に整理したHTMLレポートです。</p>
      </div>
      <div class="cover-meta">
        <div><span>会社名</span><strong>${escapeHtml(companyName)}</strong></div>
        <div><span>会社ID</span><strong>${escapeHtml(companyId)}</strong></div>
        <div><span>生成日時</span><strong>${escapeHtml(formatDateTime(generatedAt))}</strong></div>
      </div>
    </header>

    <section>
      <div class="section-heading"><h2>サマリー</h2><span>Review Overview</span></div>
      ${renderSummaryCards(config, checkResult)}
    </section>

    <section>
      <div class="section-heading"><h2>レビューコメント</h2><span>Review Notes</span></div>
      ${renderReviewCommentSection()}
    </section>

    <section>
      <div class="section-heading"><h2>AIレビューコメント</h2><span>Rule-based Advisor</span></div>
      ${renderAiReviewComments(reviewComments)}
    </section>

    <section>
      <div class="section-heading"><h2>会社情報</h2><span>Company</span></div>
      ${renderKeyValueTable(company)}
    </section>

    <section>
      <div class="section-heading"><h2>質問一覧</h2><span>Questions</span></div>
      ${renderQuestions(config)}
    </section>

    <section>
      <div class="section-heading"><h2>判定ルール一覧</h2><span>Rules</span></div>
      ${renderRules(config)}
    </section>

    <section>
      <div class="section-heading"><h2>経費タイプ一覧</h2><span>Expense Types</span></div>
      ${renderExpenseTypes(config)}
    </section>

    <section>
      <div class="section-heading"><h2>設定チェック結果</h2><span>Validation</span></div>
      ${renderCheckResult(checkResult)}
    </section>

    <section>
      <div class="section-heading"><h2>設定差分</h2><span>Config Diff</span></div>
      ${renderConfigDiff(configDiff)}
    </section>

    <section>
      <div class="section-heading"><h2>判定フロー概要</h2><span>Flow</span></div>
      ${renderFlowSummary(config)}
    </section>
  </main>
</body>
</html>`;
}

async function exportReport(companyId, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const configPath = path.join(rootDir, "rules", companyId, "config.json");
  const outputDir = path.join(rootDir, "reports");
  const outputPath = path.join(outputDir, `${companyId}-review.html`);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const compareConfig = options.compareConfigPath
    ? JSON.parse(fs.readFileSync(path.resolve(rootDir, options.compareConfigPath), "utf8"))
    : options.compareConfig;
  const html = await generateReportHtml(config, companyId, { compareConfig });

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
  renderReportStyles,
};
