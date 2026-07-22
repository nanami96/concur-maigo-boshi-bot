import { describe, it, expect, beforeEach, vi } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();
const mockState = { isSupabaseConfigured: true };

vi.mock("../src/lib/supabaseClient.js", () => ({
  get isSupabaseConfigured() {
    return mockState.isSupabaseConfigured;
  },
  get supabase() {
    return mockState.isSupabaseConfigured ? { rpc: rpcMock, from: fromMock } : null;
  },
}));

function makeChain(result) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  return chain;
}

const { publishDraft, fetchPublishHistory, fetchCurrentPublishedVersionId } = await import(
  "../src/data/publishRepository.js"
);

beforeEach(() => {
  mockState.isSupabaseConfigured = true;
  rpcMock.mockReset();
  fromMock.mockReset();
});

describe("publishDraft", () => {
  it("成功時は公開されたpublished_versions行を返す", async () => {
    const row = { id: "v1", published_at: "2026-07-22T10:00:00Z", published_by: "user-1" };
    rpcMock.mockResolvedValue({ data: row, error: null });

    const result = await publishDraft({ companyDbId: "company-1", configSnapshot: { foo: "bar" } });

    expect(result).toEqual({ row, error: null });
    expect(rpcMock).toHaveBeenCalledWith("publish_company_draft", {
      p_company_id: "company-1",
      p_config_snapshot: { foo: "bar" },
    });
  });

  it("42501（company_membersではない）はforbiddenに分類する", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "not a member" } });
    const result = await publishDraft({ companyDbId: "company-1", configSnapshot: {} });
    expect(result.error).toEqual({ type: "forbidden", message: "not a member" });
  });

  it("P0002（下書きなし）はno_draftに分類する", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0002", message: "no draft" } });
    const result = await publishDraft({ companyDbId: "company-1", configSnapshot: {} });
    expect(result.error).toEqual({ type: "no_draft", message: "no draft" });
  });

  it("28000（認証エラー）はauthに分類する", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "28000", message: "no session" } });
    const result = await publishDraft({ companyDbId: "company-1", configSnapshot: {} });
    expect(result.error).toEqual({ type: "auth", message: "no session" });
  });

  it("未知のエラーコードはunknownに分類する", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "99999", message: "mystery" } });
    const result = await publishDraft({ companyDbId: "company-1", configSnapshot: {} });
    expect(result.error).toEqual({ type: "unknown", message: "mystery" });
  });

  it("Supabase未設定なら呼び出さずエラーを返す", async () => {
    mockState.isSupabaseConfigured = false;
    const result = await publishDraft({ companyDbId: "company-1", configSnapshot: {} });
    expect(result.row).toBeNull();
    expect(result.error).not.toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("fetchPublishHistory", () => {
  it("新しい順の履歴を返す", async () => {
    const rows = [
      { id: "v2", published_at: "2026-07-22T10:00:00Z", published_by: "user-1" },
      { id: "v1", published_at: "2026-07-21T10:00:00Z", published_by: "user-1" },
    ];
    fromMock.mockReturnValue(makeChain({ data: rows, error: null }));

    const result = await fetchPublishHistory("company-1");

    expect(result).toEqual({ rows, error: null });
    expect(fromMock).toHaveBeenCalledWith("published_versions");
  });

  it("Supabase未設定なら空配列を返す", async () => {
    mockState.isSupabaseConfigured = false;
    const result = await fetchPublishHistory("company-1");
    expect(result).toEqual({ rows: [], error: null });
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("fetchCurrentPublishedVersionId", () => {
  it("現在の公開バージョンIDを返す", async () => {
    fromMock.mockReturnValue(makeChain({ data: { current_published_version_id: "v2" }, error: null }));
    const result = await fetchCurrentPublishedVersionId("company-1");
    expect(result).toEqual({ currentPublishedVersionId: "v2", error: null });
  });

  it("未公開の場合はnullを返す", async () => {
    fromMock.mockReturnValue(makeChain({ data: { current_published_version_id: null }, error: null }));
    const result = await fetchCurrentPublishedVersionId("company-1");
    expect(result.currentPublishedVersionId).toBeNull();
  });
});
