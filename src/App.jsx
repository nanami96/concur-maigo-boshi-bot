import { useState } from "react";
import { isPublicDemo } from "@configSource";
import BotConversation from "./BotConversation";
import { useResolvedBotConfig } from "./useResolvedBotConfig";
import { usePublicCompanyList } from "./usePublicCompanyList";
import { resolveInitialCompanyId } from "./resolveInitialCompanyId";

// 「?company=も無く、公開会社一覧もまだ無い/取得できない」場合に使う既定の会社。
// 会社一覧の取得順（配列の並び順）に依存する曖昧な挙動を避けるため、
// 固定のcompany_codeとして明示する（sample-companyはこのプロジェクトの
// 標準デモ会社であり、configSource.local.jsでも常に先頭に来るよう
// 扱われている既存の慣習に合わせている）。
const DEFAULT_COMPANY_ID = "sample-company";

// ローカル開発・静的デモ向けの会社セレクタ付きBot画面。
//
// Phase 7以降、実際のSupabase運用では一般利用者もログイン必須になり、会社は
// ログイン中ユーザーから自動判定される（main.jsx → AppAuthGate →
// AuthenticatedBotScreen経由。会社セレクタ・?company=・他社一覧は一切見せない）。
// このコンポーネント自体は、そちらへ置き換えるのではなく、
// 「Supabase未設定のローカル開発」「isPublicDemoの静的デモ」向けに、
// 従来通りの会社セレクタ付き体験として残してある
// （main.jsxがisSupabaseConfiguredで両者を切り替える）。
export default function App() {
  // companyIdの決定は、公開会社一覧の取得を待たずに同期的に行う
  // （?company=xxxが妥当な形式であればそのまま採用し、実在・公開確認は
  // 後続のuseResolvedBotConfigに一任する。resolveInitialCompanyId.js参照）。
  // これにより「一覧取得→検証→設定取得」という直列の3段階を避け、
  // Bot本体の表示が会社一覧の取得完了を待たされることが無くなる。
  const [companyId, setCompanyId] = useState(() =>
    resolveInitialCompanyId({
      search: typeof window !== "undefined" ? window.location.search : "",
      defaultCompanyId: DEFAULT_COMPANY_ID,
    }),
  );
  // 「今回どの設定を使うか」（Supabaseの公開設定 / 静的config.json / 未公開）は
  // useResolvedBotConfigが非同期に解決する。QuestionEngine・質問UI・結果UIは
  // resolved.configが確定してから初めて動き出すため、それ自体は設定の出所
  // （静的ファイルかSupabaseか）を一切意識しない。
  const resolved = useResolvedBotConfig(companyId);
  const config = resolved.status === "ready" ? resolved.config : null;

  // セレクタの選択肢一覧（公開中の会社一覧）は上記のcompanyId確定・設定取得とは
  // 完全に非同期・独立に解決される。取得が遅れてもBot本体の表示は妨げられず、
  // 到着ししだいセレクタの選択肢だけが更新される。
  const companies = usePublicCompanyList();

  function handleCompanyChange(event) {
    setCompanyId(event.target.value);
  }

  const headerActions = (
    <>
      {!isPublicDemo && (
        <a className="resetButton" href="#admin">
          管理画面
        </a>
      )}
      {companies.length > 1 && (
        <label className="companySelector">
          <span className="companySelectorLabel">会社</span>
          <span className="companySelectWrap">
            <select
              aria-label="会社を選択"
              value={companyId}
              onChange={handleCompanyChange}
            >
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.label}
                </option>
              ))}
            </select>
          </span>
        </label>
      )}
    </>
  );

  return <BotConversation config={config} status={resolved.status} headerActions={headerActions} />;
}
