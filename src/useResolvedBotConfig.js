import { useEffect, useState } from "react";
import { getConfig, isPublicDemo } from "@configSource";
import { isSupabaseConfigured } from "./lib/supabaseClient";
import { fetchPublicConfig } from "./data/publicConfigRepository";
import { resolveBotConfigSource } from "./resolveBotConfigSource";

// 利用者Bot画面向けに、companyIdが変わるたびに「今回どの設定を使うか」を
// 非同期で解決するフック。実際の優先順位ロジックはresolveBotConfigSource
// （純粋関数）に任せ、ここではSupabase呼び出しと結果の反映だけを行う。
//
// QuestionEngine側は、このフックが返すresolved.configが静的config.json由来か
// Supabaseのconfig_snapshot由来かを一切意識しない（どちらもconfig.json互換の
// 同じ形）。
export function useResolvedBotConfig(companyId) {
  const [resolved, setResolved] = useState({ status: "loading", config: null, source: null });

  useEffect(() => {
    let cancelled = false;
    setResolved({ status: "loading", config: null, source: null });

    async function load() {
      const staticConfig = getConfig(companyId) || null;

      if (!isSupabaseConfigured) {
        if (!cancelled) {
          setResolved(
            resolveBotConfigSource({
              isSupabaseConfigured,
              isPublicDemo,
              staticConfig,
              remoteConfig: null,
              remoteError: null,
            }),
          );
        }
        return;
      }

      const { config: remoteConfig, error: remoteError } = await fetchPublicConfig(companyId);

      if (cancelled) {
        return;
      }

      setResolved(
        resolveBotConfigSource({
          isSupabaseConfigured,
          isPublicDemo,
          staticConfig,
          remoteConfig,
          remoteError,
        }),
      );
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  return resolved;
}
