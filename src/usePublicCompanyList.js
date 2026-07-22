import { useEffect, useState } from "react";
import { availableCompanies as staticAvailableCompanies } from "@configSource";
import { isSupabaseConfigured } from "./lib/supabaseClient";
import { fetchPublicCompanies } from "./data/publicConfigRepository";

// 本番Bot画面（App.jsx）の会社セレクタに出す「公開中の会社一覧」を解決するフック。
//
// useResolvedBotConfig（実際に表示する設定本体の取得）とは完全に独立している。
// companyId自体はURLまたは既定値からApp.jsx側で同期的に決まっており、この一覧の
// 取得が遅れても・失敗しても、Bot本体の質問フロー表示は妨げられない
// （この一覧はセレクタの選択肢が後から増減するだけに影響する）。
//
// isSupabaseConfigured（isPublicDemoではない）を判定に使うのは、他のSupabase
// 連携箇所（useResolvedBotConfig等）と一貫させるため。これによりローカル開発でも
// .env.local にSupabaseの認証情報を設定していれば、実際に公開されている会社が
// セレクタへ反映される（configファイルの実在有無とは独立に、実際の公開状態を
// 確認できるほうが開発時にも都合が良い）。
//
// 通信エラー時のみ静的一覧へフォールバックする。「0件」という正常な結果は
// フォールバックしない（「まだ何も公開されていない」を正直に表すため）。
export function usePublicCompanyList() {
  const [companies, setCompanies] = useState(
    isSupabaseConfigured ? [] : staticAvailableCompanies,
  );

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return;
    }

    let cancelled = false;

    fetchPublicCompanies().then(({ companies: remoteCompanies, error }) => {
      if (cancelled) {
        return;
      }

      if (error) {
        console.error("公開会社一覧の取得に失敗しました", error);
        setCompanies(staticAvailableCompanies);
        return;
      }

      setCompanies(remoteCompanies);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return companies;
}
