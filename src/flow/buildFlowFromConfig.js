import { generateNextId } from "./idGenerator";

// 既存config.json（questions/rules）から、管理画面編集用の flow データ構造へ変換する。
//
// 現行の06_判定ルールは「(ルールID, 条件グループ)」でまとめた条件テーブルだが、
// 実データを検証した結果、質問フローは合流点が無い純粋な木構造であることが分かっている
// （各質問への流入は常に1つ）。そのため、ルート質問から選択肢を辿るだけで、
// 各リーフ（次の質問を持たない選択肢）に対応する判定ルールを一意に特定できる。
//
// QuestionEngine.getResult() と同じ「回答履歴に対する rule.conditions の完全一致」判定を
// ここでも使い、ルート→リーフの経路上で実際に得られる回答だけを使って一致するルールを探す。
function findMatchingRules(rules, answers) {
  return (rules || [])
    .filter((rule) => rule.active !== false)
    .filter((rule) =>
      Object.entries(rule.conditions || {}).every(
        ([questionId, value]) => answers[questionId] === value,
      ),
    )
    .slice()
    .sort((left, right) => left.priority - right.priority);
}

// nextQuestionIdを持たない選択肢（＝リーフ）の判定結果を、ルート→リーフの経路上で
// 実際に得られた回答（answersUpToQuestion + このoption自身の回答）だけを使って求める。
// question.id・option.valueは常にconfig.json由来の"元の"IDを使う（flow側で選択肢に
// 発番し直したID・複製した質問IDとは無関係。ルールの条件判定は元データの意味的な
// 値でのみ行う）。
function buildOptionNext(option, sourceQuestion, rules, answersUpToQuestion, warnings) {
  const leafAnswers = {
    ...answersUpToQuestion,
    [sourceQuestion.id]: option.value,
  };
  const matchedRules = findMatchingRules(rules, leafAnswers);

  if (matchedRules.length === 0) {
    warnings.push(
      `質問「${sourceQuestion.text}」の選択肢「${option.label}」に一致する判定ルールが見つからなかったため、未設定として取り込みました。`,
    );
    return { type: "unset" };
  }

  return {
    type: "result",
    candidates: matchedRules.map((rule) => ({
      expenseTypeId: rule.resultExpenseTypeId,
      message: rule.message || "",
      warningMessage: rule.warningMessage || "",
      // 元のルールIDは画面には出さないが、逆変換時にできるだけ同じIDを再利用するために保持する。
      sourceRuleId: rule.sourceRuleId || rule.id,
    })),
  };
}

// sourceQuestion: config.json由来の元の質問オブジェクト（.id/.text/.optionsは常に元データのまま）。
// flowQuestionId: この質問の内容を flow.questions に格納するときのキー。
//   通常は sourceQuestion.id と同じだが、同じ質問が複数の選択肢から参照される
//   「合流点」の2回目以降の出現では、新しく発番したIDになる（下記参照）。
function walkQuestion(
  sourceQuestion,
  flowQuestionId,
  questionsById,
  rules,
  answersUpToQuestion,
  flow,
  warnings,
  visiting,
  seenSourceQuestionIds,
  usedOptionIds,
) {
  // visitingは「現在たどっている経路上の祖先」を元の質問ID（sourceQuestion.id）で
  // 追跡する。ここが真になるのは、ある質問が自分自身の子孫として再度現れる
  // ＝真の循環参照の場合のみ（合流点＝別の兄弟経路からの再参照とは区別する。
  // 合流点はseenSourceQuestionIdsで検出し、呼び出し側で複製して安全に処理する）。
  if (visiting.has(sourceQuestion.id)) {
    warnings.push(
      `質問「${sourceQuestion.text}」で循環参照を検出したため、それ以上先は取り込みませんでした。`,
    );
    return;
  }

  visiting.add(sourceQuestion.id);
  seenSourceQuestionIds.add(sourceQuestion.id);

  // 元データのoption.idは、欠損（キー自体が無い）・全選択肢で同一値・他の選択肢との
  // 重複、のいずれもあり得る（実際にcompany-aの静的configで発生していた）。
  // option.idをそのままflow.optionsのキー・optionIdsの値として使うと、
  // 複数の選択肢が同じキーへ書き込まれて後勝ちで上書きされ、データが
  // silentに失われた上、React側では同一keyの重複・存在しないoptionIdへの
  // 参照によるクラッシュ（OptionRow）を引き起こす。そのため、有効かつ
  // 未使用のIDが無い場合は、管理画面が新規選択肢作成時に使うのと同じ
  // generateNextId(..., "O") で新しいIDを発番し、以後は必ず一意なIDで
  // flow.options / optionIds の両方を揃える。
  const resolvedOptions = sourceQuestion.options.map((option) => {
    const hasValidId = Boolean(option.id) && !usedOptionIds.has(option.id);
    const optionId = hasValidId ? option.id : generateNextId(Array.from(usedOptionIds), "O");
    usedOptionIds.add(optionId);

    if (!hasValidId) {
      warnings.push(
        option.id
          ? `質問「${sourceQuestion.text}」の選択肢「${option.label || "(文言未入力)"}」のID「${option.id}」が他の選択肢と重複していたため、新しいID「${optionId}」を発番しました。`
          : `質問「${sourceQuestion.text}」の選択肢「${option.label || "(文言未入力)"}」にIDが設定されていなかったため、新しいID「${optionId}」を発番しました。`,
      );
    }

    return { ...option, id: optionId };
  });

  flow.questions[flowQuestionId] = {
    text: sourceQuestion.text || "",
    type: sourceQuestion.type || "single_select",
    optionIds: resolvedOptions.map((option) => option.id),
  };

  resolvedOptions.forEach((option) => {
    if (!option.nextQuestionId) {
      flow.options[option.id] = {
        label: option.label || "",
        next: buildOptionNext(option, sourceQuestion, rules, answersUpToQuestion, warnings),
      };
      return;
    }

    const nextSourceQuestion = questionsById.get(option.nextQuestionId);

    if (!nextSourceQuestion) {
      warnings.push(
        `質問「${sourceQuestion.text}」の選択肢「${option.label}」が参照する次の質問が見つかりませんでした。`,
      );
      flow.options[option.id] = {
        label: option.label || "",
        next: { type: "question", questionId: option.nextQuestionId },
      };
      return;
    }

    let nextFlowQuestionId = option.nextQuestionId;

    // 合流点の検出：この質問(option.nextQuestionId)は既に他の選択肢から一度
    // 処理済み（seenSourceQuestionIdsに登録済み）。
    // 管理画面のflowデータ構造は「1つの質問は必ず1つの親を持つ木構造」を前提としており、
    // 共有ノードをそのまま指し示すと、後から処理した経路の回答内容（answersUpToQuestion）で
    // その質問の判定結果が上書きされてしまい、先に処理した経路側では結果判定に必要な
    // 条件が失われる。実際に、ある選択肢経由で合流先の質問に到達しても、別の
    // 選択肢経由の判定条件しか残らず、どの結果にも一致せず同じ質問が繰り返し
    // 表示される（無限ループのように見える）不具合が発生したことがある。
    // そのため、合流点は経路ごとに独立した質問として複製する
    // （質問文・選択肢の内容は共有元からそのままコピーし、判定条件だけが
    // 経路（answersUpToQuestion）ごとに正しく分岐する）。
    // なお「自分自身が祖先」の真の循環はvisitingで別途検出されるため、
    // ここで無限に複製が発生することはない。
    if (seenSourceQuestionIds.has(option.nextQuestionId)) {
      nextFlowQuestionId = generateNextId(Object.keys(flow.questions), "Q");
      warnings.push(
        `質問「${nextSourceQuestion.text}」は複数の選択肢（合流点）から参照されているため、経路ごとに複製して取り込みました。`,
      );
    }

    flow.options[option.id] = {
      label: option.label || "",
      next: { type: "question", questionId: nextFlowQuestionId },
    };

    walkQuestion(
      nextSourceQuestion,
      nextFlowQuestionId,
      questionsById,
      rules,
      { ...answersUpToQuestion, [sourceQuestion.id]: option.value },
      flow,
      warnings,
      visiting,
      seenSourceQuestionIds,
      usedOptionIds,
    );
  });

  visiting.delete(sourceQuestion.id);
}

// 戻り値: { flow, warnings }
// warnings は「取り込みでは表現しきれなかった内容」を人間向けに報告するためのもの。
// sample-company の現状データでは warnings が空になることをテストで担保する。
export function buildFlowFromConfig(config) {
  const questions = config?.questions || [];
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const flow = { rootQuestionId: null, questions: {}, options: {} };
  const warnings = [];
  const usedOptionIds = new Set();
  const seenSourceQuestionIds = new Set();

  const rootQuestion = questions[0];

  if (!rootQuestion) {
    return { flow, warnings };
  }

  flow.rootQuestionId = rootQuestion.id;
  walkQuestion(
    rootQuestion,
    rootQuestion.id,
    questionsById,
    config.rules,
    {},
    flow,
    warnings,
    new Set(),
    seenSourceQuestionIds,
    usedOptionIds,
  );

  questions.forEach((question) => {
    if (!seenSourceQuestionIds.has(question.id)) {
      warnings.push(
        `質問「${question.text}」はどの選択肢からも辿り着けないため、取り込みの対象外になりました。`,
      );
    }
  });

  return { flow, warnings };
}
