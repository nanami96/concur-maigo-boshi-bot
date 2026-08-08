import { describe, it, expect, beforeEach, vi } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();
const getSessionMock = vi.fn();
const mockState = { isSupabaseConfigured: true };

vi.mock("../src/lib/supabaseClient.js", () => ({
  get isSupabaseConfigured() {
    return mockState.isSupabaseConfigured;
  },
  get supabase() {
    return mockState.isSupabaseConfigured
      ? { rpc: rpcMock, from: fromMock, auth: { getSession: getSessionMock } }
      : null;
  },
}));

function makeSelectChain(result) {
  return {
    select: vi.fn(() => ({
      maybeSingle: vi.fn(() => Promise.resolve(result)),
    })),
  };
}

// fetchMyRole()専用のチェーンmock。company_idで絞り込む経路（.eq("company_id",
// ...).maybeSingle()）と、role='admin'の存在確認だけを行う経路
// （.eq("role", "admin").limit(1)）の両方を、実際に呼ばれた.eq()の引数で
// 判定して使い分ける（実装（membershipRepository.js）の分岐と1対1で対応させる）。
function makeRoleChain({ maybeSingleResult, limitResult } = {}) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn((column) => {
        if (column === "company_id") {
          return { maybeSingle: vi.fn(() => Promise.resolve(maybeSingleResult)) };
        }
        return { limit: vi.fn(() => Promise.resolve(limitResult)) };
      }),
    })),
  };
}

const {
  classifyMembershipRpcError,
  fetchMyMembership,
  fetchMyCompanies,
  redeemInviteCode,
  fetchMyCompanyMembers,
  updateMemberRole,
  removeCompanyMember,
  fetchCurrentUserId,
  fetchMyRole,
  fetchIsPlatformAdmin,
  fetchPlatformCompanies,
  createPlatformCompany,
  deletePlatformCompany,
  regenerateInviteCode,
  fetchPlatformCompanyMembers,
} = await import("../src/data/membershipRepository.js");

beforeEach(() => {
  mockState.isSupabaseConfigured = true;
  rpcMock.mockReset();
  fromMock.mockReset();
  getSessionMock.mockReset();
});

describe("classifyMembershipRpcError", () => {
  it("エラーが無ければnull", () => {
    expect(classifyMembershipRpcError(null)).toBeNull();
  });

  it.each([
    ["already belongs to a company", "already_member"],
    ["invalid invite code", "invalid_code"],
    ["cannot demote the last admin of this company", "last_admin"],
    ["cannot remove yourself from the company", "cannot_remove_self"],
    ["cannot remove the last admin of this company", "last_admin_removal"],
    ["cannot delete the last remaining company", "last_company"],
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
    expect(result).toEqual({ membership: null, error: null, ambiguous: false });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("未所属（0行）ならmembership:null・error:null", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await fetchMyMembership();
    expect(result).toEqual({ membership: null, error: null, ambiguous: false });
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
    expect(result.ambiguous).toBe(false);
  });

  describe("複数社所属対応（Commit 2：company_code省略時の2件以上・明示指定）", () => {
    it("会社コードを明示指定した場合、p_company_codeとしてRPCへ渡す", async () => {
      rpcMock.mockResolvedValue({
        data: [
          {
            company_code: "company-b",
            company_name: "B株式会社",
            role: "admin",
            config_snapshot: null,
            published_at: null,
          },
        ],
        error: null,
      });

      const result = await fetchMyMembership("company-b");

      expect(rpcMock).toHaveBeenCalledWith("get_my_public_config", { p_company_code: "company-b" });
      expect(result.membership.companyCode).toBe("company-b");
      expect(result.ambiguous).toBe(false);
    });

    it("会社コード省略・所属2件以上の場合、RPCのfail-closedな例外をambiguous:trueとして返す（membership/errorはnull）", async () => {
      rpcMock.mockResolvedValue({
        data: null,
        error: { message: "company must be specified" },
      });

      const result = await fetchMyMembership();

      expect(result).toEqual({ membership: null, error: null, ambiguous: true });
    });

    it("指定した会社に所属していない場合、他社情報を返さずmembership:nullになる（エラーでもambiguousでもない）", async () => {
      rpcMock.mockResolvedValue({ data: [], error: null });

      const result = await fetchMyMembership("company-not-mine");

      expect(result).toEqual({ membership: null, error: null, ambiguous: false });
      expect(rpcMock).toHaveBeenCalledWith("get_my_public_config", { p_company_code: "company-not-mine" });
    });

    it("空文字のcompanyCodeは未指定として扱う（p_company_codeを渡さない）", async () => {
      rpcMock.mockResolvedValue({ data: [], error: null });

      await fetchMyMembership("");

      expect(rpcMock).toHaveBeenCalledWith("get_my_public_config");
    });
  });
});

describe("fetchMyCompanies（Commit 3：本人の所属会社一覧）", () => {
  it("Supabase未設定なら呼び出さず空配列を返す", async () => {
    mockState.isSupabaseConfigured = false;
    const result = await fetchMyCompanies();
    expect(result).toEqual({ companies: [], error: null });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("所属0件なら空配列（エラーではない）", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await fetchMyCompanies();
    expect(result).toEqual({ companies: [], error: null });
    expect(rpcMock).toHaveBeenCalledWith("list_my_companies");
  });

  it("所属1件なら1件をそのまま返す", async () => {
    rpcMock.mockResolvedValue({
      data: [{ company_code: "company-a", company_name: "A株式会社", role: "user" }],
      error: null,
    });
    const result = await fetchMyCompanies();
    expect(result).toEqual({
      companies: [{ companyCode: "company-a", companyName: "A株式会社", role: "user" }],
      error: null,
    });
  });

  it("所属複数件なら、勝手に1件へ絞り込まず全件を会社ごとのroleと共に返す", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { company_code: "company-a", company_name: "A株式会社", role: "admin" },
        { company_code: "company-b", company_name: "B株式会社", role: "user" },
      ],
      error: null,
    });
    const result = await fetchMyCompanies();
    expect(result.companies).toEqual([
      { companyCode: "company-a", companyName: "A株式会社", role: "admin" },
      { companyCode: "company-b", companyName: "B株式会社", role: "user" },
    ]);
  });

  it("RPCエラー時は空配列とエラーを返す（生のSupabaseエラーをそのまま露出しない）", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await fetchMyCompanies();
    expect(result.companies).toEqual([]);
    expect(result.error).toEqual({ type: "unknown", message: "boom" });
  });

  it("通信例外時はnetworkエラーを返す", async () => {
    rpcMock.mockImplementation(() => {
      throw new Error("network down");
    });
    const result = await fetchMyCompanies();
    expect(result.companies).toEqual([]);
    expect(result.error.type).toBe("network");
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

  it("companyId省略時は引数無しでlist_my_company_members()を呼ぶ（既存1社adminとの後方互換）", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await fetchMyCompanyMembers();
    expect(rpcMock).toHaveBeenCalledWith("list_my_company_members");
  });

  it("【複数社所属対応・Commit 6】companyIdを指定した場合、p_company_idとしてRPCへ渡す", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          member_id: "m1",
          user_id: "u1",
          email: "admin@example.com",
          role: "admin",
          created_at: "2026-07-01T00:00:00Z",
        },
      ],
      error: null,
    });

    const result = await fetchMyCompanyMembers("company-a-uuid");

    expect(rpcMock).toHaveBeenCalledWith("list_my_company_members", { p_company_id: "company-a-uuid" });
    expect(result.members).toEqual([
      { memberId: "m1", userId: "u1", email: "admin@example.com", role: "admin", createdAt: "2026-07-01T00:00:00Z" },
    ]);
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

describe("removeCompanyMember", () => {
  it("成功時は削除されたメンバー情報を返す", async () => {
    rpcMock.mockResolvedValue({ data: { id: "m1", role: "user" }, error: null });
    const result = await removeCompanyMember("m1");
    expect(result).toEqual({ member: { id: "m1", role: "user" }, error: null });
    expect(rpcMock).toHaveBeenCalledWith("remove_company_member", { p_member_id: "m1" });
  });

  it("最後のadminを削除しようとした場合、last_admin_removalとして分類されたエラーを返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "cannot remove the last admin of this company" },
    });
    const result = await removeCompanyMember("m1");
    expect(result.member).toBeNull();
    expect(result.error.type).toBe("last_admin_removal");
  });

  it("自分自身を削除しようとした場合、cannot_remove_selfとして分類されたエラーを返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "cannot remove yourself from the company" },
    });
    const result = await removeCompanyMember("m1");
    expect(result.error.type).toBe("cannot_remove_self");
  });

  it("admin権限が無い場合、forbiddenとして分類されたエラーを返す", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "admin privileges required" } });
    const result = await removeCompanyMember("m1");
    expect(result.error.type).toBe("forbidden");
  });

  it("他社のmember_idを渡す等、対象が見つからない場合、not_foundとして分類されたエラーを返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "member not found in your company" },
    });
    const result = await removeCompanyMember("missing-id");
    expect(result.error.type).toBe("not_found");
  });

  it("Supabase未設定なら呼び出さずエラーを返す", async () => {
    mockState.isSupabaseConfigured = false;
    const result = await removeCompanyMember("m1");
    expect(result.member).toBeNull();
    expect(result.error).not.toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("fetchCurrentUserId", () => {
  it("Supabase未設定ならuserId:nullを返す（呼び出さない）", async () => {
    mockState.isSupabaseConfigured = false;
    const result = await fetchCurrentUserId();
    expect(result).toEqual({ userId: null, error: null });
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("ログイン中ならセッションのuser.idを返す", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "current-user-id" } } },
      error: null,
    });
    const result = await fetchCurrentUserId();
    expect(result).toEqual({ userId: "current-user-id", error: null });
  });

  it("セッションが無い場合はuserId:nullを返す", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    const result = await fetchCurrentUserId();
    expect(result).toEqual({ userId: null, error: null });
  });

  it("エラー時はerrorを返す", async () => {
    getSessionMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await fetchCurrentUserId();
    expect(result.userId).toBeNull();
    expect(result.error).not.toBeNull();
  });
});

describe("fetchMyRole", () => {
  it("Supabase未設定ならrole:nullを返す", async () => {
    mockState.isSupabaseConfigured = false;
    const result = await fetchMyRole();
    expect(result).toEqual({ role: null, error: null });
  });

  describe("companyId省略時（AuthGate.jsxの粗い入室可否判定用：どこか1社でもadminか）", () => {
    it("どこか1社でrole='admin'の行があれば、role:'admin'を返す", async () => {
      fromMock.mockReturnValue(makeRoleChain({ limitResult: { data: [{ role: "admin" }], error: null } }));
      const result = await fetchMyRole();
      expect(result).toEqual({ role: "admin", error: null });
      expect(fromMock).toHaveBeenCalledWith("company_members");
    });

    it("【複数社所属対応】2社以上でrole='admin'の行があっても、.maybeSingle()の複数行エラーにならない", async () => {
      fromMock.mockReturnValue(
        makeRoleChain({ limitResult: { data: [{ role: "admin" }, { role: "admin" }], error: null } }),
      );
      const result = await fetchMyRole();
      expect(result).toEqual({ role: "admin", error: null });
    });

    it("role='admin'の行が無ければ、role:nullを返す（未所属・一般ユーザーのみの所属いずれも含む）", async () => {
      fromMock.mockReturnValue(makeRoleChain({ limitResult: { data: [], error: null } }));
      const result = await fetchMyRole();
      expect(result).toEqual({ role: null, error: null });
    });

    it("取得エラー時はerrorを返す", async () => {
      fromMock.mockReturnValue(makeRoleChain({ limitResult: { data: null, error: { message: "boom" } } }));
      const result = await fetchMyRole();
      expect(result.role).toBeNull();
      expect(result.error).toEqual({ type: "unknown", message: "boom" });
    });
  });

  describe("companyId指定時（Commit 6：会社を明示してroleを取得する）", () => {
    it("指定した会社での自分のroleを返す（unique(company_id, user_id)によりmaybeSingle()が安全）", async () => {
      fromMock.mockReturnValue(makeRoleChain({ maybeSingleResult: { data: { role: "admin" }, error: null } }));
      const result = await fetchMyRole("company-a-uuid");
      expect(result).toEqual({ role: "admin", error: null });
      expect(fromMock).toHaveBeenCalledWith("company_members");
    });

    it("指定した会社に所属していない場合、role:nullを返す（他社でadminでも漏れない）", async () => {
      fromMock.mockReturnValue(makeRoleChain({ maybeSingleResult: { data: null, error: null } }));
      const result = await fetchMyRole("company-b-uuid");
      expect(result).toEqual({ role: null, error: null });
    });

    it("取得エラー時はerrorを返す", async () => {
      fromMock.mockReturnValue(makeRoleChain({ maybeSingleResult: { data: null, error: { message: "boom" } } }));
      const result = await fetchMyRole("company-a-uuid");
      expect(result.role).toBeNull();
      expect(result.error).toEqual({ type: "unknown", message: "boom" });
    });
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

describe("deletePlatformCompany", () => {
  it("成功時は削除した会社情報を返す", async () => {
    rpcMock.mockResolvedValue({
      data: [{ company_id: "uuid-1", company_code: "test", company_name: "テスト会社" }],
      error: null,
    });

    const result = await deletePlatformCompany("uuid-1");
    expect(result).toEqual({
      company: { companyDbId: "uuid-1", companyCode: "test", companyName: "テスト会社" },
      error: null,
    });
    expect(rpcMock).toHaveBeenCalledWith("delete_platform_company", { p_company_id: "uuid-1" });
  });

  it("platform_admin権限が無い場合、platform_forbiddenとして分類されたエラーを返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "platform admin privileges required" },
    });
    const result = await deletePlatformCompany("uuid-1");
    expect(result.company).toBeNull();
    expect(result.error.type).toBe("platform_forbidden");
  });

  it("対象の会社が存在しない場合、not_foundとして分類されたエラーを返す", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "company not found" } });
    const result = await deletePlatformCompany("uuid-missing");
    expect(result.error.type).toBe("not_found");
  });

  it("会社が1件しか無い場合、last_companyとして分類されたエラーを返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "cannot delete the last remaining company" },
    });
    const result = await deletePlatformCompany("uuid-only");
    expect(result.error.type).toBe("last_company");
  });

  it("Supabase未設定なら呼び出さずエラーを返す", async () => {
    mockState.isSupabaseConfigured = false;
    const result = await deletePlatformCompany("uuid-1");
    expect(result.company).toBeNull();
    expect(result.error).not.toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
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
