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

function makeSelectChain(result) {
  return {
    select: vi.fn(() => ({
      maybeSingle: vi.fn(() => Promise.resolve(result)),
    })),
  };
}

const {
  classifyMembershipRpcError,
  fetchMyMembership,
  redeemInviteCode,
  fetchMyCompanyMembers,
  updateMemberRole,
  fetchMyRole,
  fetchIsPlatformAdmin,
  fetchPlatformCompanies,
  createPlatformCompany,
  regenerateInviteCode,
  fetchPlatformCompanyMembers,
} = await import("../src/data/membershipRepository.js");

beforeEach(() => {
  mockState.isSupabaseConfigured = true;
  rpcMock.mockReset();
  fromMock.mockReset();
});

describe("classifyMembershipRpcError", () => {
  it("エラーが無ければnull", () => {
    expect(classifyMembershipRpcError(null)).toBeNull();
  });

  it.each([
    ["already belongs to a company", "already_member"],
    ["invalid invite code", "invalid_code"],
    ["cannot demote the last admin of this company", "last_admin"],
    ["admin privileges required", "forbidden"],
    ["invalid role", "invalid_role"],
    ["member not found in your company", "not_found"],
    ["authentication required", "auth"],
    ["platform admin privileges required", "platform_forbidden"],
    ["invalid company code format", "invalid_company_code"],
    ["company name required", "company_name_required"],
    ["company code already exists", "company_code_taken"],
  ])("メッセージ「%s」を%sに分類する", (message, expected) => {
    expect(classifyMembershipRpcError({ message })).toBe(expected);
  });

  it("「platform admin privileges required」は「admin privileges required」を部分文字列として含むが、より具体的なplatform_forbiddenへ分類される（forbiddenではない）", () => {
    // classifyMembershipRpcErrorの実装は「platform admin privileges required」の
    // 判定を「admin privileges required」の判定より先に行う必要がある。
    // 順序を誤ると、より一般的な"forbidden"へ先に一致してしまい、
    // platform_forbiddenへ絶対に到達できなくなる回帰を防ぐためのテスト。
    expect(classifyMembershipRpcError({ message: "platform admin privileges required" })).toBe(
      "platform_forbidden",
    );
  });

  it("ネットワークエラー（AuthRetryableFetchError）はnetworkに分類する", () => {
    expect(classifyMembershipRpcError({ name: "AuthRetryableFetchError", message: "" })).toBe(
      "network",
    );
  });

  it("未知のエラーはunknownに分類する", () => {
    expect(classifyMembershipRpcError({ message: "something else" })).toBe("unknown");
  });
});

describe("fetchMyMembership", () => {
  it("Supabase未設定なら呼び出さずmembership:nullを返す", async () => {
    mockState.isSupabaseConfigured = false;
    const result = await fetchMyMembership();
    expect(result).toEqual({ membership: null, error: null });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("未所属（0行）ならmembership:null・error:null", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await fetchMyMembership();
    expect(result).toEqual({ membership: null, error: null });
  });

  it("所属しているが未公開の場合、configSnapshotがnullで返る", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          company_code: "company-a",
          company_name: "A株式会社",
          role: "user",
          config_snapshot: null,
          published_at: null,
        },
      ],
      error: null,
    });
    const result = await fetchMyMembership();
    expect(result.membership).toEqual({
      companyCode: "company-a",
      companyName: "A株式会社",
      role: "user",
      configSnapshot: null,
      publishedAt: null,
    });
  });

  it("公開済みの場合、configSnapshotとpublishedAtが返る", async () => {
    const snapshot = { questions: [], rules: [] };
    rpcMock.mockResolvedValue({
      data: [
        {
          company_code: "sample-company",
          company_name: "サンプル会社",
          role: "admin",
          config_snapshot: snapshot,
          published_at: "2026-07-22T10:00:00Z",
        },
      ],
      error: null,
    });
    const result = await fetchMyMembership();
    expect(result.membership.configSnapshot).toBe(snapshot);
    expect(result.membership.role).toBe("admin");
    expect(rpcMock).toHaveBeenCalledWith("get_my_public_config");
  });

  it("RPCエラー時はerrorを返す", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await fetchMyMembership();
    expect(result.membership).toBeNull();
    expect(result.error).not.toBeNull();
  });
});

describe("redeemInviteCode", () => {
  it("成功時は会社情報を返す", async () => {
    rpcMock.mockResolvedValue({
      data: [{ company_code: "company-a", company_name: "A株式会社" }],
      error: null,
    });
    const result = await redeemInviteCode("secret-code");
    expect(result).toEqual({
      company: { companyCode: "company-a", companyName: "A株式会社" },
      error: null,
    });
    expect(rpcMock).toHaveBeenCalledWith("redeem_invite_code", { p_code: "secret-code" });
  });

  it("既に所属済みの場合、already_memberとして分類されたエラーを返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "already belongs to a company" },
    });
    const result = await redeemInviteCode("secret-code");
    expect(result.company).toBeNull();
    expect(result.error.type).toBe("already_member");
  });

  it("不正なコードの場合、invalid_codeとして分類されたエラーを返す", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "invalid invite code" } });
    const result = await redeemInviteCode("wrong-code");
    expect(result.error.type).toBe("invalid_code");
  });
});

describe("fetchMyCompanyMembers", () => {
  it("adminの場合、自社メンバー一覧をid/label形式へ変換して返す", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          member_id: "m1",
          user_id: "u1",
          email: "admin@example.com",
          role: "admin",
          created_at: "2026-07-01T00:00:00Z",
        },
        {
          member_id: "m2",
          user_id: "u2",
          email: "user@example.com",
          role: "user",
          created_at: "2026-07-02T00:00:00Z",
        },
      ],
      error: null,
    });

    const result = await fetchMyCompanyMembers();
    expect(result.members).toEqual([
      { memberId: "m1", userId: "u1", email: "admin@example.com", role: "admin", createdAt: "2026-07-01T00:00:00Z" },
      { memberId: "m2", userId: "u2", email: "user@example.com", role: "user", createdAt: "2026-07-02T00:00:00Z" },
    ]);
  });

  it("admin以外・未所属の場合は空配列（エラーではない）", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await fetchMyCompanyMembers();
    expect(result).toEqual({ members: [], error: null });
  });
});

describe("updateMemberRole", () => {
  it("成功時は更新後のメンバー情報を返す", async () => {
    rpcMock.mockResolvedValue({ data: { id: "m1", role: "admin" }, error: null });
    const result = await updateMemberRole("m1", "admin");
    expect(result.member).toEqual({ id: "m1", role: "admin" });
    expect(rpcMock).toHaveBeenCalledWith("update_company_member_role", {
      p_member_id: "m1",
      p_new_role: "admin",
    });
  });

  it("最後のadminを降格しようとした場合、last_adminとして分類されたエラーを返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "cannot demote the last admin of this company" },
    });
    const result = await updateMemberRole("m1", "user");
    expect(result.error.type).toBe("last_admin");
  });

  it("admin権限が無い場合、forbiddenとして分類されたエラーを返す", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "admin privileges required" } });
    const result = await updateMemberRole("m1", "admin");
    expect(result.error.type).toBe("forbidden");
  });
});

describe("fetchMyRole", () => {
  it("Supabase未設定ならrole:nullを返す", async () => {
    mockState.isSupabaseConfigured = false;
    const result = await fetchMyRole();
    expect(result).toEqual({ role: null, error: null });
  });

  it("所属している場合、自分のroleを返す（既存RLSがuser_id=auth.uid()に絞り込む）", async () => {
    fromMock.mockReturnValue(makeSelectChain({ data: { role: "admin" }, error: null }));
    const result = await fetchMyRole();
    expect(result).toEqual({ role: "admin", error: null });
    expect(fromMock).toHaveBeenCalledWith("company_members");
  });

  it("未所属の場合、role:nullを返す（エラーではない）", async () => {
    fromMock.mockReturnValue(makeSelectChain({ data: null, error: null }));
    const result = await fetchMyRole();
    expect(result).toEqual({ role: null, error: null });
  });
});

describe("fetchIsPlatformAdmin", () => {
  it("Supabase未設定ならisPlatformAdmin:falseを返す（呼び出さない）", async () => {
    mockState.isSupabaseConfigured = false;
    const result = await fetchIsPlatformAdmin();
    expect(result).toEqual({ isPlatformAdmin: false, error: null });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("is_platform_admin()がtrueを返せばisPlatformAdmin:trueになる", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const result = await fetchIsPlatformAdmin();
    expect(result).toEqual({ isPlatformAdmin: true, error: null });
    expect(rpcMock).toHaveBeenCalledWith("is_platform_admin");
  });

  it("一般user・通常adminの場合はisPlatformAdmin:falseになる", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    const result = await fetchIsPlatformAdmin();
    expect(result).toEqual({ isPlatformAdmin: false, error: null });
  });
});

describe("fetchPlatformCompanies", () => {
  it("platform_adminの場合、全社の一覧をid(=company_code)/companyDbId/label形式へ変換して返す", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { company_id: "uuid-1", company_code: "sample-company", company_name: "サンプル会社" },
        { company_id: "uuid-2", company_code: "company-a", company_name: "A株式会社" },
      ],
      error: null,
    });

    const result = await fetchPlatformCompanies();
    expect(result.companies).toEqual([
      { id: "sample-company", companyDbId: "uuid-1", label: "サンプル会社" },
      { id: "company-a", companyDbId: "uuid-2", label: "A株式会社" },
    ]);
    expect(rpcMock).toHaveBeenCalledWith("list_platform_companies");
  });

  it("platform_admin以外（一般user・通常admin）の場合は空配列（list_platform_companies()側で0行、エラーではない）", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await fetchPlatformCompanies();
    expect(result).toEqual({ companies: [], error: null });
  });
});

describe("createPlatformCompany", () => {
  it("成功時は会社情報と平文の招待コードを返す", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          company_id: "uuid-new",
          company_code: "new-company",
          company_name: "新会社株式会社",
          invite_code: "abcdef123456",
        },
      ],
      error: null,
    });

    const result = await createPlatformCompany({ companyCode: "new-company", companyName: "新会社株式会社" });
    expect(result).toEqual({
      company: {
        companyDbId: "uuid-new",
        companyCode: "new-company",
        companyName: "新会社株式会社",
        inviteCode: "abcdef123456",
      },
      error: null,
    });
    expect(rpcMock).toHaveBeenCalledWith("create_platform_company", {
      p_company_code: "new-company",
      p_company_name: "新会社株式会社",
    });
  });

  it("platform_admin権限が無い場合、platform_forbiddenとして分類されたエラーを返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "platform admin privileges required" },
    });
    const result = await createPlatformCompany({ companyCode: "x", companyName: "y" });
    expect(result.company).toBeNull();
    expect(result.error.type).toBe("platform_forbidden");
  });

  it("会社コードが重複している場合、company_code_takenとして分類されたエラーを返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "company code already exists" },
    });
    const result = await createPlatformCompany({ companyCode: "sample-company", companyName: "重複" });
    expect(result.error.type).toBe("company_code_taken");
  });

  it("会社コードの形式が不正な場合、invalid_company_codeとして分類されたエラーを返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "invalid company code format" },
    });
    const result = await createPlatformCompany({ companyCode: "Invalid Code!", companyName: "x" });
    expect(result.error.type).toBe("invalid_company_code");
  });
});

describe("regenerateInviteCode", () => {
  it("成功時は新しい平文の招待コードを返す", async () => {
    rpcMock.mockResolvedValue({ data: [{ invite_code: "new-code-789" }], error: null });
    const result = await regenerateInviteCode("uuid-1");
    expect(result).toEqual({ inviteCode: "new-code-789", error: null });
    expect(rpcMock).toHaveBeenCalledWith("regenerate_invite_code", { p_company_id: "uuid-1" });
  });

  it("platform_admin権限が無い場合、platform_forbiddenとして分類されたエラーを返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "platform admin privileges required" },
    });
    const result = await regenerateInviteCode("uuid-1");
    expect(result.inviteCode).toBeNull();
    expect(result.error.type).toBe("platform_forbidden");
  });

  it("対象の会社が存在しない場合、not_foundとして分類されたエラーを返す", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "company not found" } });
    const result = await regenerateInviteCode("uuid-missing");
    expect(result.error.type).toBe("not_found");
  });
});

describe("fetchPlatformCompanyMembers", () => {
  it("指定した会社のメンバー一覧をメール付きで返す", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          member_id: "m1",
          user_id: "u1",
          email: "other-admin@example.com",
          role: "admin",
          created_at: "2026-07-01T00:00:00Z",
        },
      ],
      error: null,
    });

    const result = await fetchPlatformCompanyMembers("uuid-1");
    expect(result.members).toEqual([
      {
        memberId: "m1",
        userId: "u1",
        email: "other-admin@example.com",
        role: "admin",
        createdAt: "2026-07-01T00:00:00Z",
      },
    ]);
    expect(rpcMock).toHaveBeenCalledWith("list_platform_company_members", { p_company_id: "uuid-1" });
  });

  it("platform_admin以外の場合は空配列（RPC側で0行、エラーではない）", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await fetchPlatformCompanyMembers("uuid-1");
    expect(result).toEqual({ members: [], error: null });
  });
});
