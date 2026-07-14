import { useEffect, useMemo, useState } from "react";
import { checkConfig } from "./configChecks";
import { searchConfig } from "./configSearch";
import { generateReviewComments } from "./reviewAdvisor";
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

// 画面表示用のルールID。Excel上のルールID(sourceRuleId)があればそれを使い、
// 無い場合（旧スキーマ等）はconfig.json内部のidをそのまま使う。
function getDisplayRuleId(rule) {
  return rule.sourceRuleId || rule.id;
}

// config.json内部id（例: "r058-g1"）からExcelの「条件グループ」番号だけを取り出す。
// sourceRuleIdが無い場合や、内部idがその形式でない場合はnullを返す。
function getConditionGroup(rule) {
  if (!rule.sourceRuleId || !rule.id.startsWith(`${rule.sourceRuleId}-g`)) {
    return null;
  }

  return rule.id.slice(rule.sourceRuleId.length + 2);
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
  const displayRuleId = getDisplayRuleId(rule);
  const conditionGroup = getConditionGroup(rule);

  return (
    <article className="overviewCard ruleCard">
      <div className="cardHeading">
        <span className="idBadge">{displayRuleId}</span>
        <h3>{getExpenseTypeName(config, rule.resultExpenseTypeId)}</h3>
      </div>

      <dl className="ruleDetails">
        {conditionGroup && conditionGroup !== "1" && (
          <div>
            <dt>条件グループ</dt>
            <dd>{conditionGroup}</dd>
          </div>
        )}
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

      {!hasIssues && <p className="checkOk">設定チェックOK</p>}
      <CheckIssueList title="Error" items={errors} level="error" />
      <CheckIssueList title="Warning" items={warnings} level="warning" />
    </details>
  );
}

function ReviewCommentList({ title, items, type }) {
  return (
    <div className={`advisorGroup ${type}`}>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => {
          const message = typeof item === "string" ? item : item.message;
          const severity = typeof item === "string" ? null : item.severity;

          return (
            <li key={`${severity || "good"}-${message}`}>
              {severity && (
                <span className={`severityBadge ${severity}`}>
                  {severity}
                </span>
              )}
              <span>{message}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReviewAdvisorCard({ result }) {
  return (
    <details className="overviewSection" open>
      <summary>
        {"AI\u30ec\u30d3\u30e5\u30fc\u30b3\u30e1\u30f3\u30c8"}
        <span>Rule-based</span>
      </summary>
      <div className="advisorCard">
        <ReviewCommentList
          title={"\u826f\u3044\u70b9"}
          items={result.goodPoints}
          type="good"
        />
        <ReviewCommentList
          title={"\u6539\u5584\u5019\u88dc"}
          items={result.improvementCandidates}
          type="improvement"
        />
      </div>
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

export default function RuleOverview({ companyId, config }) {
  const [searchQuery, setSearchQuery] = useState("");
  const searchResult = useMemo(
    () => searchConfig(config, searchQuery),
    [config, searchQuery],
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
  const reviewAdvisorResult = useMemo(() => generateReviewComments(config), [
    config,
  ]);
  const shouldShowSearchEmpty = searchResult.hasQuery && !searchResult.hasMatches;

  useEffect(() => {
    setSearchQuery("");
  }, [companyId]);

  return (
    <section className="overviewPanel" aria-label="ルール確認">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">設定確認</p>
          <h2>ルール確認</h2>
        </div>
        <p>
          {config.company.company_name}
          <span>{config.company.company_id}</span>
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
      <ReviewAdvisorCard result={reviewAdvisorResult} />
    </section>
  );
}
