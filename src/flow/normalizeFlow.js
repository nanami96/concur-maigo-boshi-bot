import { generateNextId } from "./idGenerator";

// 管理画面のuseWorkspaceEditorへ渡す直前のflowに対する、最後の構造的な健全性チェック＋修復。
//
// なぜbuildFlowFromConfig側の修正だけでは不十分か：
//   buildFlowFromConfig.jsは「静的config.json→flowへの変換」時にoption.idの欠損・重複を
//   その場で修復するが、これは新規に変換する場合にしか効かない。既にdraft_configsへ
//   保存済みのflow（Supabaseのjsonbカラム）は、buildFlowFromConfigを一切経由せず
//   そのまま読み込まれる。過去に（修正前のbuildFlowFromConfigや、その他の経路で）
//   option.idが欠損・重複したflowが一度でも保存されてしまっていた場合、その保存済み
//   データ自体はbuildFlowFromConfigを直しても自動的には修復されない。
//   そのため、「静的config由来」「draft由来」を問わず、useWorkspaceEditorへ渡る
//   直前の入口1箇所でこの正規化を必ず通すことで、データの発生源に関わらず
//   安全な状態を保証する。
//
// 保証すること：
//   ・各questionのoptionIdsに含まれる値は、必ずflow.optionsに実在する一意なキーである
//   ・欠損（null/undefined/空文字）・重複・flow.optionsに対応する実体が無いIDは、
//     addOption等が使うのと同じgenerateNextId(..., "O")で新しいIDを発番して補正する
//   ・rootQuestionIdがquestionsに存在しない場合はnullへ補正する（FlowOutlineEditor側は
//     rootQuestionId=nullを「まだ質問が無い」として安全に扱う設計に既になっている）
//   ・データを「捏造」はしない：実体のあるoption/questionのlabel・next等はそのまま保持し、
//     IDの整合性だけを補正する。補正が発生した場合は issues として返し、
//     呼び出し側（CompanyEditor）が利用者に分かる形で警告表示できるようにする
//   ・既に健全なflowに対しては何も変更せず、issuesも空配列を返す（副作用の無い正規化）
export function normalizeFlow(flow) {
  const issues = [];

  if (!flow || typeof flow !== "object") {
    issues.push("フロー全体のデータ形式が不正だったため、空のフローとして扱いました。");
    return { flow: { rootQuestionId: null, questions: {}, options: {} }, issues };
  }

  const sourceQuestions =
    flow.questions && typeof flow.questions === "object" ? flow.questions : {};
  const sourceOptions = flow.options && typeof flow.options === "object" ? flow.options : {};

  const usedOptionIds = new Set();
  const normalizedOptions = {};
  const normalizedQuestions = {};

  Object.entries(sourceQuestions).forEach(([questionId, question]) => {
    const text = question?.text || "";
    const type = question?.type || "single_select";
    const optionIds = Array.isArray(question?.optionIds) ? question.optionIds : [];

    const resolvedOptionIds = optionIds.map((optionId) => {
      const sourceOption = optionId != null ? sourceOptions[optionId] : undefined;
      const isValid = Boolean(optionId) && Boolean(sourceOption) && !usedOptionIds.has(optionId);

      if (isValid) {
        usedOptionIds.add(optionId);
        normalizedOptions[optionId] = sourceOption;
        return optionId;
      }

      const newId = generateNextId(Array.from(usedOptionIds), "O");
      usedOptionIds.add(newId);
      // sourceOptionが実在すれば（IDの重複が原因のケース）中身は保持し、IDだけ差し替える。
      // sourceOption自体が無い（欠損・ぶら下がり参照）場合のみ、未設定の空選択肢として補う
      // （ラベル・next先を勝手に捏造しない）。
      normalizedOptions[newId] = sourceOption || { label: "", next: { type: "unset" } };
      issues.push(
        sourceOption
          ? `質問「${text || questionId}」の選択肢ID「${String(optionId)}」が他の選択肢と重複していたため、ID「${newId}」として復旧しました。`
          : `質問「${text || questionId}」の選択肢ID「${String(optionId)}」に対応するデータが見つからなかったため、未設定の選択肢としてID「${newId}」を割り当てました。`,
      );
      return newId;
    });

    normalizedQuestions[questionId] = { text, type, optionIds: resolvedOptionIds };
  });

  const rootQuestionId =
    flow.rootQuestionId && normalizedQuestions[flow.rootQuestionId] ? flow.rootQuestionId : null;

  if (flow.rootQuestionId && !rootQuestionId) {
    issues.push(
      `最初の質問（ID「${String(flow.rootQuestionId)}」）が見つからなかったため、質問が無い状態として扱いました。`,
    );
  }

  return {
    flow: { rootQuestionId, questions: normalizedQuestions, options: normalizedOptions },
    issues,
  };
}
