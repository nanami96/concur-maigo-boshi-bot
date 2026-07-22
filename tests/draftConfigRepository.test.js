import { describe, it, expect, beforeEach, vi } from "vitest";

const authGetUserMock = vi.fn();
const fromMock = vi.fn();
// vi.mockのファクトリはモジュールが最初にimportされる際に遅延実行されるため、
// ここで先に定義しておけばTDZの心配なく参照できる
// （vi.mock自体の“登録”はホイストされるが、ファクトリの“実行”はホイストされない）。
const mockState = { isSupabaseConfigured: true };

vi.mock("../src/lib/supabaseClient.js", () => ({
  get isSupabaseConfigured() {
    return mockState.isSupabaseConfigured;
  },
  get supabase() {
    return mockState.isSupabaseConfigured
      ? { from: fromMock, auth: { getUser: authGetUserMock } }
      : null;
  },
}));

function makeChain(result) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  return chain;
}

const {
  mapDraftRowToWorkspaceState,
  mapWorkspaceStateToDraftRow,
  resolveInitialWorkspaceState,
  getCompanyDbId,
  fetchDraft,
  saveDraft,
} = await import("../src/data/draftConfigRepository.js");

beforeEach(() => {
  mockState.isSupabaseConfigured = true;
  fromMock.mockReset();
  authGetUserMock.mockReset();
});

describe("mapDraftRowToWorkspaceState / mapWorkspaceStateToDraftRow", () => {
  it("DBの行(snake_case)を編集state(camelCase)へ変換する", () => {
    const row = {
      company_settings: { company_id: "sample-company", company_name: "サンプル会社" },
      policies: [{ policy_id: "p1" }],
      expense_types: [{ expense_type_id: "e1" }],
      flow: { rootQuestionId: "q1", questions: {}, options: {} },
    };
    expect(mapDraftRowToWorkspaceState(row)).toEqual({
      company: row.company_settings,
      policies: row.policies,
      expenseTypes: row.expense_types,
      flow: row.flow,
    });
  });

  it("編集state(camelCase)をDBの行(snake_case)へ変換する（逆変換）", () => {
    const state = {
      company: { company_id: "sample-company" },
      policies: [],
      expenseTypes: [],
      flow: { rootQuestionId: null, questions: {}, options: {} },
    };
    expect(mapWorkspaceStateToDraftRow(state)).toEqual({
      company_settings: state.company,
      policies: state.policies,
      expense_types: state.expenseTypes,
      flow: state.flow,
    });
  });
});

describe("resolveInitialWorkspaceState", () => {
  const staticConfig = { company: { company_id: "sample-company" }, policies: [], expenseTypes: [], flow: {} };

  it("下書きがあれば、静的configより優先する", () => {
    const draftRow = {
      company_settings: { company_id: "sample-company", company_name: "編集後" },
      policies: [],
      expense_types: [],
      flow: {},
      updated_at: "2026-07-22T09:00:00Z",
    };
    const result = resolveInitialWorkspaceState({ draftRow, staticConfig });
    expect(result.source).toBe("draft");
    expect(result.initialState.company).toEqual(draftRow.company_settings);
    expect(result.initialUpdatedAt).toBe("2026-07-22T09:00:00Z");
  });

  it("下書きが無ければ静的configを使う", () => {
    const result = resolveInitialWorkspaceState({ draftRow: null, staticConfig });
    expect(result.source).toBe("static");
    expect(result.initialState).toBe(staticConfig);
    expect(result.initialUpdatedAt).toBeNull();
  });

  it("下書きも静的configも無ければnull", () => {
    const result = resolveInitialWorkspaceState({ draftRow: null, staticConfig: null });
    expect(result.source).toBe("none");
    expect(result.initialState).toBeNull();
  });
});

describe("getCompanyDbId", () => {
  it("Supabase未設定なら問い合わせずid:nullを返す", async () => {
    mockState.isSupabaseConfigured = false;
    const result = await getCompanyDbId("sample-company");
    expect(result).toEqual({ id: null, error: null });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("該当する会社が見つかればidを返す", async () => {
    fromMock.mockReturnValue(makeChain({ data: { id: "uuid-1" }, error: null }));
    const result = await getCompanyDbId("sample-company");
    expect(result).toEqual({ id: "uuid-1", error: null });
    expect(fromMock).toHaveBeenCalledWith("companies");
  });

  it("見つからない場合（未登録、またはRLSにより権限が無い場合を含む）はid:nullを返す", async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    const result = await getCompanyDbId("company-a");
    expect(result).toEqual({ id: null, error: null });
  });

  it("通信エラー等が発生した場合はerrorを返す", async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: { message: "boom" } }));
    const result = await getCompanyDbId("sample-company");
    expect(result.id).toBeNull();
    expect(result.error).toEqual({ type: "unknown", message: "boom" });
  });
});

describe("fetchDraft", () => {
  it("下書きが無ければ row:null, error:null（正常系）", async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    const result = await fetchDraft("uuid-1");
    expect(result).toEqual({ row: null, error: null });
  });

  it("下書きがあればその行を返す", async () => {
    const row = { company_id: "uuid-1", company_settings: {}, policies: [], expense_types: [], flow: {} };
    fromMock.mockReturnValue(makeChain({ data: row, error: null }));
    const result = await fetchDraft("uuid-1");
    expect(result).toEqual({ row, error: null });
  });

  it("Supabase未設定なら問い合わせずrow:nullを返す", async () => {
    mockState.isSupabaseConfigured = false;
    const result = await fetchDraft("uuid-1");
    expect(result).toEqual({ row: null, error: null });
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("saveDraft", () => {
  const state = { company: { company_id: "sample-company" }, policies: [], expenseTypes: [], flow: {} };

  it("userId指定時はgetUserを呼ばずに保存する", async () => {
    const savedRow = { company_id: "uuid-1", updated_at: "2026-07-22T09:00:00Z" };
    fromMock.mockReturnValue(makeChain({ data: savedRow, error: null }));

    const result = await saveDraft("uuid-1", state, { userId: "user-1" });

    expect(authGetUserMock).not.toHaveBeenCalled();
    expect(result).toEqual({ row: savedRow, error: null });
    expect(fromMock).toHaveBeenCalledWith("draft_configs");
  });

  it("userId未指定時は現在のセッションからuser idを解決する", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-2" } }, error: null });
    fromMock.mockReturnValue(makeChain({ data: { company_id: "uuid-1" }, error: null }));

    await saveDraft("uuid-1", state);

    expect(authGetUserMock).toHaveBeenCalled();
  });

  it("セッションが無い（認証切れの可能性）場合はauthエラーを返し、書き込みを試みない", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const result = await saveDraft("uuid-1", state);

    expect(result.row).toBeNull();
    expect(result.error.type).toBe("auth");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("保存に失敗した場合はerrorを返す", async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: { message: "write failed" } }));

    const result = await saveDraft("uuid-1", state, { userId: "user-1" });

    expect(result.row).toBeNull();
    expect(result.error).toEqual({ type: "unknown", message: "write failed" });
  });

  it("Supabase未設定なら保存を試みずエラーを返す", async () => {
    mockState.isSupabaseConfigured = false;
    const result = await saveDraft("uuid-1", state, { userId: "user-1" });
    expect(result.row).toBeNull();
    expect(result.error).not.toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });
});
