// 「初期設定Excel 正式仕様 v1」（excel/templates/initial-setup-template-v1.xlsx）を解析し、
// 管理画面がそのまま使える { company, policies, expenseTypes, flow } を組み立てる。
//
// 06_判定ルールは存在せず、質問→選択肢→次の質問 または 結果 という構造を
// 05_選択肢シートから直接読み取る。ルールID・条件グループ・AND条件といった概念は
// このファイルの外（既存のQuestionEngine/buildConfigFromFlow）にも一切登場しない。
import * as XLSX from "xlsx";
import { generateNextId } from "./idGenerator";

const REQUIRED_SHEETS = ["01_基本設定", "02_ポリシー", "03_経費タイプ", "04_質問", "05_選択肢"];

const SHEET_COLUMNS = {
  "01_基本設定": ["会社ID", "会社名"],
  "02_ポリシー": ["ポリシーID", "ポリシー名", "使用有無"],
  "03_経費タイプ": ["経費タイプID", "ポリシーID", "経費タイプ名", "領収書要否", "使用有無"],
  "04_質問": ["質問キー", "質問文", "質問形式", "質問の表示順"],
  "05_選択肢": [
    "質問キー",
    "ボタンに表示する文字",
    "次のアクション",
    "次に質問する質問キー",
    "経費タイプID",
    "案内メッセージ",
    "注意事項",
  ],
};

function issue(level, id, message) {
  return { level, id, message };
}

function text(value) {
  return String(value ?? "").trim();
}

function getHeaders(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  return (rows[0] || []).map((cell) => text(cell));
}

function readSheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headers = (rows[0] || []).map((cell) => text(cell));
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => text(cell) !== ""))
    .map((row) => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index];
      });
      return obj;
    });
}

export function slugify(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function generateCompanyId(companyName) {
  const slug = slugify(companyName);
  return slug || `company-${Math.random().toString(36).slice(2, 8)}`;
}

// --- schema_version ---------------------------------------------------

export function detectSchemaVersion(workbook) {
  const rows = readSheetRows(workbook, "01_基本設定");
  const raw = rows[0]?.["schema_version"];

  if (raw === undefined || raw === null || text(raw) === "") {
    return null;
  }

  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : NaN;
}

// --- 01_基本設定 ---------------------------------------------------

function parseCompany(workbook, errors, warnings) {
  const rows = readSheetRows(workbook, "01_基本設定");
  const row = rows[0];

  if (!row) {
    errors.push(issue("error", "company-missing", "01_基本設定シートにデータ行がありません。"));
    return null;
  }

  const companyName = text(row["会社名"]);
  if (!companyName) {
    errors.push(issue("error", "company-name-required", "01_基本設定: 会社名が入力されていません。"));
  }

  let companyId = text(row["会社ID"]);
  if (!companyId) {
    companyId = generateCompanyId(companyName);
    warnings.push(
      issue(
        "warning",
        "company-id-generated",
        `会社IDが未入力だったため、会社名から自動生成しました（${companyId}）。`,
      ),
    );
  }

  return { company_id: companyId, company_name: companyName };
}

// --- 02_ポリシー ---------------------------------------------------

function parsePolicies(workbook, errors) {
  const rows = readSheetRows(workbook, "02_ポリシー");
  const seen = new Set();
  const policies = [];

  rows.forEach((row, index) => {
    const line = index + 2;
    const id = text(row["ポリシーID"]);
    const name = text(row["ポリシー名"]);
    const enabled = text(row["使用有無"]);

    if (!id) {
      errors.push(issue("error", `policy-id-required-${line}`, `02_ポリシー ${line}行目: ポリシーIDが入力されていません。`));
      return;
    }
    if (seen.has(id)) {
      errors.push(issue("error", `policy-id-dup-${id}`, `02_ポリシー: ポリシーID「${id}」が重複しています。`));
      return;
    }
    seen.add(id);

    if (!name) {
      errors.push(
        issue("error", `policy-name-required-${id}`, `02_ポリシー（ポリシーID「${id}」）: ポリシー名が入力されていません。`),
      );
    }
    if (enabled !== "Y" && enabled !== "N") {
      errors.push(
        issue("error", `policy-enabled-invalid-${id}`, `02_ポリシー（ポリシーID「${id}」）: 使用有無はYまたはNのみ有効です。`),
      );
    }

    policies.push({ policy_id: id, policy_name: name, enabled });
  });

  return policies;
}

// --- 03_経費タイプ ---------------------------------------------------

function parseExpenseTypes(workbook, policies, errors, warnings) {
  const rows = readSheetRows(workbook, "03_経費タイプ");
  const policyIds = new Set(policies.map((policy) => policy.policy_id));
  const policyByOd = new Map(policies.map((policy) => [policy.policy_id, policy]));
  const seen = new Set();
  const expenseTypes = [];

  rows.forEach((row, index) => {
    const line = index + 2;
    const id = text(row["経費タイプID"]);
    const policyId = text(row["ポリシーID"]);
    const name = text(row["経費タイプ名"]);
    const receiptRaw = text(row["領収書要否"]);
    const enabledRaw = text(row["使用有無"]);

    if (!id) {
      errors.push(issue("error", `expense-id-required-${line}`, `03_経費タイプ ${line}行目: 経費タイプIDが入力されていません。`));
      return;
    }
    if (seen.has(id)) {
      errors.push(issue("error", `expense-id-dup-${id}`, `03_経費タイプ: 経費タイプID「${id}」が重複しています。`));
      return;
    }
    seen.add(id);

    if (!name) {
      errors.push(
        issue("error", `expense-name-required-${id}`, `03_経費タイプ（経費タイプID「${id}」）: 経費タイプ名が入力されていません。`),
      );
    }
    if (!policyId || !policyIds.has(policyId)) {
      errors.push(
        issue(
          "error",
          `expense-policy-missing-${id}`,
          `経費タイプ「${name || id}」が参照するポリシーID「${policyId}」が02_ポリシーに存在しません。`,
        ),
      );
    }

    let receiptRequired = null;
    if (receiptRaw === "必要") {
      receiptRequired = true;
    } else if (receiptRaw === "不要") {
      receiptRequired = false;
    } else if (receiptRaw === "") {
      receiptRequired = null;
      warnings.push(
        issue("warning", `expense-receipt-unset-${id}`, `経費タイプ「${name || id}」は領収書要否が未設定です。`),
      );
    } else {
      errors.push(
        issue(
          "error",
          `expense-receipt-invalid-${id}`,
          `経費タイプ「${name || id}」の領収書要否は「必要」「不要」または空欄のみ有効です。`,
        ),
      );
    }

    if (enabledRaw !== "Y" && enabledRaw !== "N") {
      errors.push(
        issue("error", `expense-enabled-invalid-${id}`, `経費タイプ「${name || id}」の使用有無はYまたはNのみ有効です。`),
      );
    }

    const active = enabledRaw === "Y";
    if (active) {
      const policy = policyByOd.get(policyId);
      if (policy && policy.enabled === "N") {
        warnings.push(
          issue(
            "warning",
            `expense-policy-disabled-${id}`,
            `経費タイプ「${name || id}」は使用有無=Yですが、属するポリシー「${policy.policy_name}」は使用有無=Nです。`,
          ),
        );
      }
    }

    expenseTypes.push({ id, policyId, name, receiptRequired, active, note: "" });
  });

  return expenseTypes;
}

// --- 04_質問 ---------------------------------------------------

function parseQuestions(workbook, errors) {
  const rows = readSheetRows(workbook, "04_質問");
  const seen = new Set();
  const questions = [];

  rows.forEach((row, index) => {
    const line = index + 2;
    const key = text(row["質問キー"]);
    const questionText = text(row["質問文"]);
    const typeRaw = text(row["質問形式"]);
    const orderRaw = row["質問の表示順"];

    if (!key) {
      errors.push(issue("error", `question-key-required-${line}`, `04_質問 ${line}行目: 質問キーが入力されていません。`));
      return;
    }
    if (seen.has(key)) {
      errors.push(issue("error", `question-key-dup-${key}`, `04_質問: 質問キー「${key}」が重複しています。`));
      return;
    }
    seen.add(key);

    if (!questionText) {
      errors.push(
        issue("error", `question-text-required-${key}`, `04_質問（質問キー「${key}」）: 質問文が入力されていません。`),
      );
    }

    const type = typeRaw || "single_select";
    if (type !== "single_select") {
      errors.push(
        issue(
          "error",
          `question-type-unsupported-${key}`,
          `質問「${questionText || key}」の質問形式「${type}」には対応していません（single_selectのみ対応）。`,
        ),
      );
    }

    const order = Number(orderRaw);
    questions.push({ key, text: questionText, type: "single_select", order: Number.isFinite(order) ? order : index });
  });

  return questions;
}

// --- 05_選択肢 ＋ flow構築 ---------------------------------------------------

function detectGlobalCycle(nextQuestionEdges, allQuestionKeys) {
  const visited = new Set();
  const visiting = new Set();
  let cyclePath = null;

  function dfs(key, path) {
    if (visiting.has(key)) {
      cyclePath = [...path, key];
      return true;
    }
    if (visited.has(key)) {
      return false;
    }

    visiting.add(key);
    const targets = nextQuestionEdges.get(key) || [];
    for (const target of targets) {
      if (dfs(target, [...path, key])) {
        return true;
      }
    }
    visiting.delete(key);
    visited.add(key);
    return false;
  }

  for (const key of allQuestionKeys) {
    if (!visited.has(key) && dfs(key, [])) {
      break;
    }
  }

  return cyclePath;
}

function determineRootCandidates(questions, nextQuestionEdges) {
  const referenced = new Set();
  nextQuestionEdges.forEach((targets) => targets.forEach((target) => referenced.add(target)));
  return questions.filter((question) => !referenced.has(question.key));
}

function parseOptionsAndBuildFlow(workbook, questions, expenseTypes, errors, warnings) {
  const questionByKey = new Map(questions.map((question) => [question.key, question]));
  const expenseTypeById = new Map(expenseTypes.map((expenseType) => [expenseType.id, expenseType]));
  const rawRows = readSheetRows(workbook, "05_選択肢");

  const groups = new Map();
  const groupOrderByQuestion = new Map();

  rawRows.forEach((row, index) => {
    const line = index + 2;
    const questionKey = text(row["質問キー"]);
    const label = text(row["ボタンに表示する文字"]);
    const action = text(row["次のアクション"]);
    const nextQuestionKey = text(row["次に質問する質問キー"]);
    const expenseTypeId = text(row["経費タイプID"]);
    const message = text(row["案内メッセージ"]);
    const warningMessage = text(row["注意事項"]);

    if (!questionKey || !questionByKey.has(questionKey)) {
      errors.push(
        issue("error", `option-question-missing-${line}`, `05_選択肢 ${line}行目: 存在しない質問キー「${questionKey}」を参照しています。`),
      );
      return;
    }

    const questionLabel = questionByKey.get(questionKey).text || questionKey;

    if (!label) {
      errors.push(
        issue(
          "error",
          `option-label-required-${line}`,
          `質問「${questionLabel}」の05_選択肢 ${line}行目: ボタンに表示する文字が入力されていません。`,
        ),
      );
      return;
    }

    if (action !== "次の質問" && action !== "結果") {
      errors.push(
        issue(
          "error",
          `option-action-invalid-${line}`,
          `質問「${questionLabel}」の選択肢「${label}」: 次のアクションは「次の質問」または「結果」のみ有効です。`,
        ),
      );
      return;
    }

    if (action === "次の質問") {
      if (expenseTypeId || message) {
        errors.push(
          issue(
            "error",
            `option-exclusive-question-${line}`,
            `質問「${questionLabel}」の選択肢「${label}」: 次のアクションが「次の質問」の場合、経費タイプID・案内メッセージは入力できません。`,
          ),
        );
        return;
      }
      if (!nextQuestionKey || !questionByKey.has(nextQuestionKey)) {
        errors.push(
          issue(
            "error",
            `option-next-missing-${line}`,
            `質問「${questionLabel}」の選択肢「${label}」: 次に質問する質問キー「${nextQuestionKey}」が存在しません。`,
          ),
        );
        return;
      }
    } else {
      if (nextQuestionKey) {
        errors.push(
          issue(
            "error",
            `option-exclusive-result-${line}`,
            `質問「${questionLabel}」の選択肢「${label}」: 次のアクションが「結果」の場合、次に質問する質問キーは入力できません。`,
          ),
        );
        return;
      }
      if (!expenseTypeId || !expenseTypeById.has(expenseTypeId)) {
        errors.push(
          issue(
            "error",
            `option-expense-missing-${line}`,
            `質問「${questionLabel}」の選択肢「${label}」: 経費タイプID「${expenseTypeId}」が存在しません。`,
          ),
        );
        return;
      }
      if (!message) {
        errors.push(
          issue(
            "error",
            `option-message-required-${line}`,
            `質問「${questionLabel}」の選択肢「${label}」: 結果には案内メッセージが必須です。`,
          ),
        );
        return;
      }
    }

    const groupKey = `${questionKey} ${label}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { questionKey, label, rows: [] });
      const order = groupOrderByQuestion.get(questionKey) || [];
      order.push(groupKey);
      groupOrderByQuestion.set(questionKey, order);
    }
    groups.get(groupKey).rows.push({ action, nextQuestionKey, expenseTypeId, message, warningMessage });
  });

  // --- グループ単位の整合性チェック（複数候補・排他） ---
  const validGroups = new Map();
  groups.forEach((group, groupKey) => {
    const questionLabel = questionByKey.get(group.questionKey).text || group.questionKey;
    const actions = new Set(group.rows.map((row) => row.action));

    if (actions.size > 1) {
      errors.push(
        issue(
          "error",
          `group-mixed-action-${groupKey}`,
          `質問「${questionLabel}」の選択肢「${group.label}」で「次の質問」と「結果」が混在しています。どちらか一方に統一してください。`,
        ),
      );
      return;
    }

    const action = group.rows[0].action;

    if (action === "次の質問") {
      if (group.rows.length > 1) {
        errors.push(
          issue(
            "error",
            `group-multiple-next-${groupKey}`,
            `質問「${questionLabel}」の選択肢「${group.label}」に「次の質問」の行が複数あります。1つの選択肢につき次の質問は1つだけにしてください。`,
          ),
        );
        return;
      }
      validGroups.set(groupKey, {
        questionKey: group.questionKey,
        label: group.label,
        next: { type: "question", targetQuestionKey: group.rows[0].nextQuestionKey },
      });
      return;
    }

    const seenExpenseIds = new Set();
    let hasDuplicate = false;
    group.rows.forEach((row) => {
      if (seenExpenseIds.has(row.expenseTypeId)) {
        errors.push(
          issue(
            "error",
            `group-duplicate-expense-${groupKey}-${row.expenseTypeId}`,
            `質問「${questionLabel}」の選択肢「${group.label}」の候補内で経費タイプID「${row.expenseTypeId}」が重複しています。`,
          ),
        );
        hasDuplicate = true;
      }
      seenExpenseIds.add(row.expenseTypeId);
    });
    if (hasDuplicate) return;

    validGroups.set(groupKey, {
      questionKey: group.questionKey,
      label: group.label,
      next: {
        type: "result",
        candidates: group.rows.map((row) => ({
          expenseTypeId: row.expenseTypeId,
          message: row.message,
          warningMessage: row.warningMessage,
        })),
      },
    });
  });

  // --- 循環参照チェック（到達可能性に関係なく、グラフ全体を対象にする） ---
  const nextQuestionEdges = new Map();
  validGroups.forEach((group) => {
    if (group.next.type === "question") {
      const list = nextQuestionEdges.get(group.questionKey) || [];
      list.push(group.next.targetQuestionKey);
      nextQuestionEdges.set(group.questionKey, list);
    }
  });

  const cyclePath = detectGlobalCycle(
    nextQuestionEdges,
    questions.map((question) => question.key),
  );
  if (cyclePath) {
    errors.push(
      issue(
        "error",
        "cycle-detected",
        `質問フローに循環参照が検出されました（${cyclePath
          .map((key) => questionByKey.get(key)?.text || key)
          .join(" → ")}）。`,
      ),
    );
    return { flow: null, questionKeyMap: {} };
  }

  // --- ルート質問判定（表示順は使わず、参照されていない質問を起点とする） ---
  const rootCandidates = determineRootCandidates(questions, nextQuestionEdges);
  if (rootCandidates.length === 0) {
    errors.push(
      issue(
        "error",
        "root-not-found",
        "先頭質問（フローの起点）を判定できません。すべての質問が他の質問から参照されているか、参照設定に誤りがある可能性があります。",
      ),
    );
    return { flow: null, questionKeyMap: {} };
  }
  if (rootCandidates.length > 1) {
    errors.push(
      issue(
        "error",
        "root-ambiguous",
        `先頭質問の候補が複数あります: ${rootCandidates.map((q) => `「${q.text}」`).join("、")}。質問フローが複数の起点に分かれていないか確認してください。`,
      ),
    );
    return { flow: null, questionKeyMap: {} };
  }

  const rootKey = rootCandidates[0].key;

  // --- ルートからの到達可能性ウォークで flow を構築し、内部ID(Q001/O001形式)を新規発番する ---
  const flow = { rootQuestionId: null, questions: {}, options: {} };
  const internalQuestionIdByKey = new Map();
  const assignedIds = [];
  const visitedKeys = new Set();

  function ensureQuestionId(key) {
    if (internalQuestionIdByKey.has(key)) {
      return internalQuestionIdByKey.get(key);
    }
    const id = generateNextId(assignedIds, "Q");
    assignedIds.push(id);
    internalQuestionIdByKey.set(key, id);
    return id;
  }

  function walk(key) {
    if (visitedKeys.has(key)) {
      return internalQuestionIdByKey.get(key);
    }
    visitedKeys.add(key);

    const questionId = ensureQuestionId(key);
    const question = questionByKey.get(key);
    const groupKeys = groupOrderByQuestion.get(key) || [];
    const optionIds = [];

    groupKeys.forEach((groupKey) => {
      const group = validGroups.get(groupKey);
      if (!group) {
        return;
      }

      const optionId = generateNextId(assignedIds, "O");
      assignedIds.push(optionId);
      optionIds.push(optionId);

      if (group.next.type === "question") {
        const targetQuestionId = walk(group.next.targetQuestionKey);
        flow.options[optionId] = {
          label: group.label,
          next: { type: "question", questionId: targetQuestionId },
        };
      } else {
        flow.options[optionId] = {
          label: group.label,
          next: { type: "result", candidates: group.next.candidates },
        };
      }
    });

    flow.questions[questionId] = {
      text: question.text,
      type: question.type,
      optionIds,
    };

    return questionId;
  }

  flow.rootQuestionId = walk(rootKey);

  questions.forEach((question) => {
    if (!visitedKeys.has(question.key)) {
      warnings.push(
        issue(
          "warning",
          `question-unreachable-${question.key}`,
          `質問「${question.text}」はどの選択肢からも辿り着けないため、取り込みの対象外になりました。`,
        ),
      );
    }
  });

  // --- 使用有無=Nの経費タイプを結果で参照している場合の警告 ---
  Object.values(flow.options).forEach((option) => {
    if (option.next.type !== "result") {
      return;
    }
    option.next.candidates.forEach((candidate) => {
      const expenseType = expenseTypeById.get(candidate.expenseTypeId);
      if (expenseType && !expenseType.active) {
        warnings.push(
          issue(
            "warning",
            `result-expense-disabled-${candidate.expenseTypeId}`,
            `結果で参照している経費タイプ「${expenseType.name}」は使用有無=Nです。`,
          ),
        );
      }
    });
  });

  return {
    flow,
    questionKeyMap: Object.fromEntries(internalQuestionIdByKey),
  };
}

// --- 未使用経費タイプ（どの結果からも参照されていない）警告 ---
function checkUnusedExpenseTypes(flow, expenseTypes, warnings) {
  const usedIds = new Set();
  Object.values(flow.options).forEach((option) => {
    if (option.next.type === "result") {
      option.next.candidates.forEach((candidate) => usedIds.add(candidate.expenseTypeId));
    }
  });

  expenseTypes.forEach((expenseType) => {
    if (!usedIds.has(expenseType.id)) {
      warnings.push(
        issue(
          "warning",
          `unused-expense-type-${expenseType.id}`,
          `経費タイプ「${expenseType.name}」はどの結果からも使われていません。`,
        ),
      );
    }
  });
}

// --- エントリポイント ---------------------------------------------------

export function parseInitialSetupExcel(workbook) {
  const errors = [];
  const warnings = [];

  const schemaVersion = detectSchemaVersion(workbook);

  if (schemaVersion === null) {
    errors.push(
      issue(
        "error",
        "schema-version-legacy",
        "このExcelは旧形式（schema_versionが未設定）です。初期設定インポートは新テンプレート（schema_version=1）のみ対応しています。旧形式のExcelは、これまでどおり npm run generate:config のパイプラインをご利用ください。",
      ),
    );
    return { schemaVersion: null, company: null, policies: [], expenseTypes: [], flow: null, errors, warnings };
  }

  if (Number.isNaN(schemaVersion) || schemaVersion !== 1) {
    errors.push(
      issue(
        "error",
        "schema-version-unsupported",
        `このExcelの設定形式には対応していません（schema_version=${schemaVersion}）。`,
      ),
    );
    return { schemaVersion, company: null, policies: [], expenseTypes: [], flow: null, errors, warnings };
  }

  const missingSheets = REQUIRED_SHEETS.filter((name) => !workbook.Sheets[name]);
  if (missingSheets.length > 0) {
    missingSheets.forEach((name) => {
      errors.push(issue("error", `missing-sheet-${name}`, `必須シート「${name}」が見つかりません。`));
    });
    return { schemaVersion, company: null, policies: [], expenseTypes: [], flow: null, errors, warnings };
  }

  const missingColumns = [];
  Object.entries(SHEET_COLUMNS).forEach(([sheetName, columns]) => {
    const headers = getHeaders(workbook, sheetName);
    columns.forEach((column) => {
      if (!headers.includes(column)) {
        missingColumns.push({ sheetName, column });
      }
    });
  });
  if (missingColumns.length > 0) {
    missingColumns.forEach(({ sheetName, column }) => {
      errors.push(
        issue("error", `missing-column-${sheetName}-${column}`, `${sheetName}シートに必須列「${column}」が見つかりません。`),
      );
    });
    return { schemaVersion, company: null, policies: [], expenseTypes: [], flow: null, errors, warnings };
  }

  const company = parseCompany(workbook, errors, warnings);
  const policies = parsePolicies(workbook, errors);
  const expenseTypes = parseExpenseTypes(workbook, policies, errors, warnings);
  const questions = parseQuestions(workbook, errors);
  const { flow, questionKeyMap } = parseOptionsAndBuildFlow(workbook, questions, expenseTypes, errors, warnings);

  if (flow) {
    checkUnusedExpenseTypes(flow, expenseTypes, warnings);
  }

  return {
    schemaVersion,
    company,
    policies,
    expenseTypes,
    flow,
    questionKeyMap,
    errors,
    warnings,
  };
}
