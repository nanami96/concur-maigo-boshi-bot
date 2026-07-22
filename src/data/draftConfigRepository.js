import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";

// draft_configs（Supabase）の1行 ⇔ useWorkspaceEditorの編集state、の相互変換。
// DB側はsnake_case（company_settings, expense_types）、
// 編集state側はcamelCase（company, expenseTypes）なので、この変換を必ず経由する。
// config.json互換形式（buildConfigFromFlowの出力）への変換はここでは行わない。
// あれは「公開」フェーズ専用の別の変換であり、下書きはあくまで編集しやすい
// 正規のデータ（company/policies/expenseTypes/flowをそのまま）として保存する。
export function mapDraftRowToWorkspaceState(row) {
  return {
    company: row.company_settings,
    policies: row.policies,
    expenseTypes: row.expense_types,
    flow: row.flow,
  };
}

export function mapWorkspaceStateToDraftRow(state) {
  return {
    company_settings: state.company,
    policies: state.policies,
    expense_types: state.expenseTypes,
    flow: state.flow,
  };
}

// 会社を選択した時点での初期stateを、優先順位に従って決定する純粋関数。
//   1. draft_configsに保存済みの下書きがあれば、それを最優先で使う
//   2. 下書きが無ければ、静的config.json由来のstaticConfigを使う
//   3. どちらも無ければ、編集不可（呼び出し側は「設定が見つからない」表示にする）
//
// 「一から作成」「Excelインポート」直後は、この関数を経由せず
// customSetup.initialStateをそのまま使う（そちらは常に新規なので
// 下書きより新規入力内容を優先するのが自然なため）。
export function resolveInitialWorkspaceState({ draftRow, staticConfig }) {
  if (draftRow) {
    return {
      initialState: mapDraftRowToWorkspaceState(draftRow),
      initialUpdatedAt: draftRow.updated_at,
      source: "draft",
    };
  }

  if (staticConfig) {
    return { initialState: staticConfig, initialUpdatedAt: null, source: "static" };
  }

  return { initialState: null, initialUpdatedAt: null, source: "none" };
}

// ログイン中の管理者が所属する会社の一覧を取得する（管理画面の会社セレクタ用）。
//
// 専用RPCは新設せず、companiesへの通常SELECTをそのまま使う。既存のRLS
// （companies_select_member: company_membersに自分が所属する会社のみ）が
// 既に「自分の所属会社しか見えない」を保証しているため、これで十分安全に
// スコープされる（他の管理者の所属会社の存在・名前は一切見えない）。
export async function fetchMyCompanies() {
  if (!isSupabaseConfigured) {
    return { companies: [], error: null };
  }

  try {
    const { data, error } = await supabase
      .from("companies")
      .select("company_code, company_name")
      .order("company_code");

    if (error) {
      return { companies: [], error: { type: "unknown", message: error.message } };
    }

    const companies = (data || []).map((row) => ({
      id: row.company_code,
      label: row.company_name,
    }));

    return { companies, error: null };
  } catch (caughtError) {
    return { companies: [], error: { type: "network", message: caughtError.message } };
  }
}

// company_code（例: "sample-company"）から、draft_configs操作に必要な
// companies.id（uuid）を引く。
//
// RLSの設計上、「その会社がSupabaseに存在しない」のと「存在するが自分は
// company_membersに所属していない」のは、SELECT結果としては区別できない
// （どちらも0件になる。これはRLSが所属していない会社の存在有無を
// 推測されないようにするための意図的な設計であり、バグではない）。
// そのため呼び出し側は id === null を「保存先が見つからない
// （未登録、またはアクセス権が無い）」として一律に扱うこと。
export async function getCompanyDbId(companyCode) {
  if (!isSupabaseConfigured) {
    return { id: null, error: null };
  }

  try {
    const { data, error } = await supabase
      .from("companies")
      .select("id")
      .eq("company_code", companyCode)
      .maybeSingle();

    if (error) {
      return { id: null, error: { type: "unknown", message: error.message } };
    }

    return { id: data?.id ?? null, error: null };
  } catch (caughtError) {
    return { id: null, error: { type: "network", message: caughtError.message } };
  }
}

// companies.id（uuid）に対応するdraft_configsの行を取得する。
// 行が存在しない（まだ一度も保存されていない）場合は row: null, error: null を返す
// （これはエラーではなく、正常な「下書きなし」の状態）。
export async function fetchDraft(companyDbId) {
  if (!isSupabaseConfigured) {
    return { row: null, error: null };
  }

  try {
    const { data, error } = await supabase
      .from("draft_configs")
      .select("*")
      .eq("company_id", companyDbId)
      .maybeSingle();

    if (error) {
      return { row: null, error: { type: "unknown", message: error.message } };
    }

    return { row: data ?? null, error: null };
  } catch (caughtError) {
    return { row: null, error: { type: "network", message: caughtError.message } };
  }
}

// state（company/policies/expenseTypes/flow）をdraft_configsへupsertする。
// updated_byは呼び出し側から渡されなければ、現在のSupabaseセッションから解決する
// （セッションが無い＝認証切れの可能性がある場合は、書き込みを試みる前に
// type: "auth" のエラーとして返す）。
//
// Phase 5で一度save_draft_with_history RPC（draft_configsのupsertと同時に
// draft_config_versionsへ履歴を追記するもの）経由に変更したが、「下書き変更履歴」
// 機能そのものを撤去したため、Phase 2時点の素のupsert方式に戻している。
export async function saveDraft(companyDbId, state, { userId } = {}) {
  if (!isSupabaseConfigured) {
    return { row: null, error: { type: "unknown", message: "Supabaseが設定されていません。" } };
  }

  try {
    let resolvedUserId = userId ?? null;

    if (!resolvedUserId) {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        return {
          row: null,
          error: {
            type: "auth",
            message: userError?.message || "ログインセッションが確認できませんでした。",
          },
        };
      }
      resolvedUserId = userData.user.id;
    }

    const { data, error } = await supabase
      .from("draft_configs")
      .upsert(
        {
          company_id: companyDbId,
          ...mapWorkspaceStateToDraftRow(state),
          updated_at: new Date().toISOString(),
          updated_by: resolvedUserId,
        },
        { onConflict: "company_id" },
      )
      .select()
      .maybeSingle();

    if (error) {
      return { row: null, error: { type: "unknown", message: error.message } };
    }

    return { row: data, error: null };
  } catch (caughtError) {
    return { row: null, error: { type: "network", message: caughtError.message } };
  }
}
