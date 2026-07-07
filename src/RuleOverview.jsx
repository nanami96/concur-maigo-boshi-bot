import { useMemo, useState } from "react";
import { checkConfig } from "./configChecks";
import { diffConfigs } from "./configDiff";
import { searchConfig } from "./configSearch";
import RuleFlowTree from "./RuleFlowTree";

function getExpenseTypeName(config, expenseTypeId) {
  return (
    config.expenseTypes.find((expenseType) => expenseType.id === expenseTypeId)
      ?.name || expenseTypeId
  );
}

function getQuestionLabel(config, questionId) {
  return (
    config.questions.find((question) => question.id === questionId)?.text ||
    questionId
  );
}

function getOptionLabel(config, questionId, value) {
  const question = config.questions.find((item) => item.id === questionId);
  const option = question?.options.find((item) => item.value === value);

  return option?.label || value;
}

function QuestionCard({ question }) {
  return (
    <article className="overviewCard">
      <div className="cardHeading">
        <span className="idBadge">{question.id}</span>
        <h3>{question.text}</h3>
      </div>

      {question.options.length > 0 ? (
        <ul className="optionList">
          {question.options.map((option) => (
            <li key={`${question.id}-${option.value}`}>
              <div>
                <strong>{option.label}</strong>
                <span>{option.value}</span>
              </div>
              <p>
                {option.nextQuestionId
                  ? `次の質問: ${option.nextQuestionId}`
                  : "結果へ進む"}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="emptyState">選択肢はまだ設定されていません。</p>
      )}
    </article>
  );
}

function RuleCard({ config, rule }) {
  const conditions = Object.entries(rule.conditions);

  return (
    <article className="overviewCard ruleCard">
      <div className="cardHeading">
        <span className="idBadge">{rule.id}</span>
        <h3>{getExpenseTypeName(config, rule.resultExpenseTypeId)}</h3>
      </div>

      <dl className="ruleDetails">
        <div>
          <dt>条件</dt>
          <dd>
            {conditions.length > 0 ? (
              <ul className="conditionList">
                {conditions.map(([questionId, value]) => (
                  <li key={`${rule.id}-${questionId}`}>
                    <span>{getQuestionLabel(config, questionId)}</span>
                    <strong>{getOptionLabel(config, questionId, value)}</strong>
                    <small>
                      {questionId}: {value}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              "条件なし"
            )}
          </dd>
        </div>
        <div>
          <dt>案内メッセージ</dt>
          <dd>{rule.message}</dd>
        </div>
      </dl>
    </article>
  );
}

function CheckIssueList({ title, items, level }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className={`checkGroup ${level}`}>
      <h3>{title}</h3>
      <ul className="checkList">
        {items.map((issue) => (
          <li key={issue.id}>
            <span>{issue.target}</span>
            <p>{issue.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfigCheckSection({ result }) {
  const { errors, warnings, info } = result;
  const hasIssues = errors.length > 0 || warnings.length > 0;

  return (
    <details className="overviewSection" open>
      <summary>
        設定チェック
        <span>
          Error {errors.length} / Warning {warnings.length}
        </span>
      </summary>

      {!hasIssues && (
        <div className="checkStatus ok">
          <strong>設定チェックOK</strong>
          <p>{info[0]?.message}</p>
        </div>
      )}

      <div className="checkSummaryGrid">
        <div className="checkMetric error">
          <span>Error</span>
          <strong>{errors.length}</strong>
        </div>
        <div className="checkMetric warning">
          <span>Warning</span>
          <strong>{warnings.length}</strong>
        </div>
        <div className="checkMetric info">
          <span>Info</span>
          <strong>{info.length}</strong>
        </div>
      </div>

      <CheckIssueList title="Error" items={errors} level="error" />
      <CheckIssueList title="Warning" items={warnings} level="warning" />
    </details>
  );
}

function DiffMetric({ label, value, type }) {
  return (
    <div className={`diffMetric ${type}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DiffItemGroup({ title, items, type }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className={`diffGroup ${type}`}>
      <h4>{title}</h4>
      <ul className="diffList">
        {items.map((item) => (
          <li key={`${type}-${item.id}`}>
            <span>{item.id}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfigDiffSection({ diff }) {
  return (
    <details className="overviewSection" open>
      <summary>
        設定差分
        <span>
          Added {diff.summary.added} / Removed {diff.summary.removed} / Changed{" "}
          {diff.summary.changed}
        </span>
      </summary>

      <div className="diffSummaryGrid">
        <DiffMetric label="Added" value={diff.summary.added} type="added" />
        <DiffMetric label="Removed" value={diff.summary.removed} type="removed" />
        <DiffMetric label="Changed" value={diff.summary.changed} type="changed" />
      </div>

      {!diff.hasDiff ? (
        <div className="diffEmpty">
          <strong>差分はありません</strong>
          <p>現在の設定と比較元の設定は同じ内容です。</p>
        </div>
      ) : (
        <div className="diffTargetList">
          {Object.entries(diff.targets).map(([targetKey, targetDiff]) => (
            <section className="diffTarget" key={targetKey}>
              <h3>{targetDiff.label}</h3>
              <DiffItemGroup
                title="Added"
                items={targetDiff.added}
                type="added"
              />
              <DiffItemGroup
                title="Removed"
                items={targetDiff.removed}
                type="removed"
              />
              <DiffItemGroup
                title="Changed"
                items={targetDiff.changed}
                type="changed"
              />
            </section>
          ))}
        </div>
      )}
    </details>
  );
}

function ConfigSearchBox({ value, onChange }) {
  return (
    <div className="configSearch">
      <label htmlFor="config-search">設定検索</label>
      <input
        id="config-search"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="質問ID、Rule ID、経費タイプなどで検索"
      />
    </div>
  );
}

function NoSearchResults() {
  return (
    <div className="searchEmpty">
      <strong>該当する設定はありません</strong>
    </div>
  );
}

export default function RuleOverview({ companyId, config, compareConfig }) {
  const [searchQuery, setSearchQuery] = useState("");
  const configDiffResult = useMemo(
    () => diffConfigs(compareConfig || config, config),
    [compareConfig, config],
  );
  const searchResult = useMemo(
    () => searchConfig(config, searchQuery, configDiffResult),
    [config, searchQuery, configDiffResult],
  );
  const visibleQuestions = searchResult.filtered.questions;
  const visibleRules = searchResult.filtered.rules;
  const sortedQuestions = [...visibleQuestions].sort(
    (left, right) => left.displayOrder - right.displayOrder,
  );
  const sortedRules = [...visibleRules].sort(
    (left, right) => left.priority - right.priority,
  );
  const configCheckResult = checkConfig(config);
  const visibleDiff = searchResult.filtered.diff || configDiffResult;
  const shouldShowSearchEmpty = searchResult.hasQuery && !searchResult.hasMatches;

  return (
    <section className="overviewPanel" aria-label="ルール確認">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">設定確認</p>
          <h2>ルール確認</h2>
        </div>
        <p>
          {config.company.company_name}
          <span>{companyId}</span>
        </p>
      </div>

      <ConfigSearchBox value={searchQuery} onChange={setSearchQuery} />
      {shouldShowSearchEmpty && <NoSearchResults />}

      <details className="overviewSection" open hidden={shouldShowSearchEmpty}>
        <summary>
          質問フロー
          <span>{sortedQuestions.length}件</span>
        </summary>
        <div className="overviewGrid">
          {sortedQuestions.map((question) => (
            <QuestionCard key={question.id} question={question} />
          ))}
        </div>
      </details>

      <details className="overviewSection" open hidden={shouldShowSearchEmpty}>
        <summary>
          判定フロー
          <span>ツリー</span>
        </summary>
        <RuleFlowTree config={config} searchResult={searchResult} />
      </details>

      <details className="overviewSection" open hidden={shouldShowSearchEmpty}>
        <summary>
          判定ルール
          <span>{sortedRules.length}件</span>
        </summary>
        <div className="overviewGrid">
          {sortedRules.map((rule) => (
            <RuleCard key={rule.id} config={config} rule={rule} />
          ))}
        </div>
      </details>

      <ConfigCheckSection result={configCheckResult} />
      {!shouldShowSearchEmpty && <ConfigDiffSection diff={visibleDiff} />}
    </section>
  );
}
