import { describe, it, expect, beforeEach, vi } from "vitest";

const rpcMock = vi.fn();
const mockState = { isSupabaseConfigured: true };

vi.mock("../src/lib/supabaseClient.js", () => ({
  get isSupabaseConfigured() {
    return mockState.isSupabaseConfigured;
  },
  get supabase() {
    return mockState.isSupabaseConfigured ? { rpc: rpcMock } : null;
  },
}));

const { fetchPublicConfig, fetchPublicCompanies } = await import("../src/data/publicConfigRepository.js");

beforeEach(() => {
  mockState.isSupabaseConfigured = true;
  rpcMock.mockReset();
});

describe("fetchPublicConfig", () => {
  it("公開済み設定がある場合はconfig_snapshotを返す", async () => {
    const snapshot = { company: {}, policies: [], expenseTypes: [], questions: [], rules: [] };
    rpcMock.mockResolvedValue({
      data: [{ company_code: "sample-company", config_snapshot: snapshot, published_at: "2026-07-22T10:00:00Z" }],
      error: null,
    });

    const result = await fetchPublicConfig("sample-company");

    expect(result).toEqual({ config: snapshot, publishedAt: "2026-07-22T10:00:00Z", error: null });
    expect(rpcMock).toHaveBeenCalledWith("get_public_config", { p_company_code: "sample-company" });
  });

  it("0件（未公開 or 存在しない会社。両者は区別しない）はconfig:nullかつerror:nullを返す", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await fetchPublicConfig("company-a");
    expect(result).toEqual({ config: null, publishedAt: null, error: null });
  });

  it("RPC自体がエラーを返した場合はerrorを返す", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await fetchPublicConfig("sample-company");
    expect(result.config).toBeNull();
    expect(result.error).toEqual({ type: "unknown", message: "boom" });
  });

  it("config_snapshotの形式が不正な場合はconfigを返さずerrorにする", async () => {
    rpcMock.mockResolvedValue({
      data: [{ company_code: "sample-company", config_snapshot: { not: "valid" }, published_at: "x" }],
      error: null,
    });
    const result = await fetchPublicConfig("sample-company");
    expect(result.config).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it("Supabase未設定なら呼び出さずconfig:nullを返す", async () => {
    mockState.isSupabaseConfigured = false;
    const result = await fetchPublicConfig("sample-company");
    expect(result).toEqual({ config: null, publishedAt: null, error: null });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("通信例外が投げられた場合はnetworkエラーとして返す", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await fetchPublicConfig("sample-company");
    expect(result.error).toEqual({ type: "network", message: "network down" });
  });
});

describe("fetchPublicCompanies", () => {
  it("公開中の会社一覧をid/labelの形へ変換して返す", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { company_code: "sample-company", company_name: "サンプル会社" },
        { company_code: "company-a", company_name: "A株式会社" },
      ],
      error: null,
    });

    const result = await fetchPublicCompanies();

    expect(result).toEqual({
      companies: [
        { id: "sample-company", label: "サンプル会社" },
        { id: "company-a", label: "A株式会社" },
      ],
      error: null,
    });
    expect(rpcMock).toHaveBeenCalledWith("list_public_companies");
  });

  it("公開中の会社が0件でもエラーではなく空配列を返す", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await fetchPublicCompanies();
    expect(result).toEqual({ companies: [], error: null });
  });

  it("RPC自体がエラーを返した場合はerrorを返す", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await fetchPublicCompanies();
    expect(result.companies).toEqual([]);
    expect(result.error).toEqual({ type: "unknown", message: "boom" });
  });

  it("Supabase未設定なら呼び出さず空配列を返す", async () => {
    mockState.isSupabaseConfigured = false;
    const result = await fetchPublicCompanies();
    expect(result).toEqual({ companies: [], error: null });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("通信例外が投げられた場合はnetworkエラーとして返す", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await fetchPublicCompanies();
    expect(result.error).toEqual({ type: "network", message: "network down" });
  });
});
