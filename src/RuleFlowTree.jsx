import { buildRuleFlowTree } from "./ruleFlowBuilder";

function includesMatch(searchResult, target, id) {
  if (!searchResult?.hasQuery) {
    return true;
  }

  return searchResult.matches[target].includes(id);
}

function optionHasMatch(searchResult, option) {
  if (!searchResult?.hasQuery) {
    return true;
  }

  return (
    includesMatch(searchResult, "optionIds", option.id) ||
    branchHasMatch(searchResult, option.child)
  );
}

function branchHasMatch(searchResult, node) {
  if (!searchResult?.hasQuery) {
    return true;
  }

  if (node.type === "question") {
    return (
      includesMatch(searchResult, "questionIds", node.id) ||
      node.children.some((option) => optionHasMatch(searchResult, option))
    );
  }

  if (node.type === "result") {
    if (node.candidates) {
      return node.candidates.some(
        (candidate) =>
          includesMatch(searchResult, "ruleIds", candidate.ruleId) ||
          includesMatch(searchResult, "expenseTypeIds", candidate.expenseTypeId),
      );
    }

    return (
      includesMatch(searchResult, "ruleIds", node.ruleId) ||
      includesMatch(searchResult, "expenseTypeIds", node.expenseTypeId)
    );
  }

  return false;
}

function QuestionNode({ node }) {
  return (
    <div className="treeNode questionNode">
      <span>{node.id}</span>
      <strong>{node.text}</strong>
    </div>
  );
}

function ResultNode({ node }) {
  if (node.type === "missing-result") {
    return (
      <div className="treeNode missingNode">
        <span>結果なし</span>
        <strong>{node.text}</strong>
      </div>
    );
  }

  if (node.type === "loop") {
    return (
      <div className="treeNode missingNode">
        <span>Loop</span>
        <strong>{node.text}</strong>
      </div>
    );
  }

  if (node.candidates) {
    return (
      <div className="resultNodeGroup">
        {node.candidates.map((candidate) => (
          <div className="treeNode resultNode" key={candidate.ruleId}>
            <span>{candidate.displayRuleId}</span>
            <strong>{candidate.expenseTypeName}</strong>
            <small>{candidate.expenseTypeId}</small>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="treeNode resultNode">
      <span>{node.displayRuleId}</span>
      <strong>{node.expenseTypeName}</strong>
      <small>{node.expenseTypeId}</small>
    </div>
  );
}

function TreeBranch({ node, searchResult }) {
  if (!branchHasMatch(searchResult, node)) {
    return null;
  }

  if (node.type === "question") {
    const visibleChildren = node.children.filter((option) =>
      optionHasMatch(searchResult, option),
    );

    return (
      <div className="treeQuestion">
        <QuestionNode node={node} />
        {visibleChildren.length > 0 ? (
          <ul className="treeOptions">
            {visibleChildren.map((option) => (
              <li key={option.id}>
                <div className="treeOption">
                  <span>{option.label}</span>
                  <small>{option.value}</small>
                </div>
                <TreeBranch node={option.child} searchResult={searchResult} />
              </li>
            ))}
          </ul>
        ) : (
          <ResultNode
            node={{
              type: "missing-result",
              id: `${node.id}-no-options`,
              text: "選択肢が設定されていません。",
            }}
          />
        )}
      </div>
    );
  }

  return <ResultNode node={node} />;
}

export default function RuleFlowTree({ config, searchResult }) {
  const tree = buildRuleFlowTree(config);

  return (
    <div className="flowTree">
      <div className="treeNode startNode">
        <span>開始</span>
        <strong>質問フロー</strong>
      </div>
      <TreeBranch node={tree.child} searchResult={searchResult} />
    </div>
  );
}
