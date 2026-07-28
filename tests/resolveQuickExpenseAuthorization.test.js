import { describe, it, expect, vi } from "vitest";
import { resolveQuickExpenseAuthorization } from "../supabase/functions/create-concur-quick-expense/resolveQuickExpenseAuthorization.js";

// tests/resolveOcrAuthorization.test.jsと同じ方針：Deno固有のAPI
// （Deno.serve/Deno.env/createClient）には一切依存しない純粋関数のため、
// fetchUser/fetchCompanyMembershipをモックしてNode/vitestから直接
// テストできる。実際のConcur API・Supabaseプロジェクトへは一切接続しない。

describe("resolveQuickExpenseAuthorization", () => {
  it("Authorizationヘッダーが無い場合はunauthorized（fetchUserは呼ばれない）", async () => {
    const fetchUser = vi.fn();
    const fetchCompanyMembership = vi.fn();

    const result = await resolveQuickExpenseAuthorization({
      authHeader: null,
      fetchUser,
      fetchCompanyMembership,
    });

    expect(result).toEqual({ outcome: "unauthorized", user: null, membership: null, reason: "no_auth_header" });
    expect(fetchUser).not.toHaveBeenCalled();
    expect(fetchCompanyMembership).not.toHaveBeenCalled();
  });

  it("不正なJWT（fetchUserがnullを返す）の場合はunauthorized", async () => {
    const fetchCompanyMembership = vi.fn();

    const result = await resolveQuickExpenseAuthorization({
      authHeader: "Bearer invalid.jwt.here",
      fetchUser: async () => null,
      fetchCompanyMembership,
    });

    expect(result).toEqual({ outcome: "unauthorized", user: null, membership: null, reason: "fetch_user_null" });
    expect(fetchCompanyMembership).not.toHaveBeenCalled();
  });

  it("fetchUserが例外を投げた場合もunauthorizedとして安全に扱う", async () => {
    const result = await resolveQuickExpenseAuthorization({
      authHeader: "Bearer malformed",
      fetchUser: async () => {
        throw new Error("invalid token");
      },
      fetchCompanyMembership: vi.fn(),
    });

    expect(result.outcome).toBe("unauthorized");
    expect(result.reason).toBe("fetch_user_exception");
  });

  it("有効なJWTだがcompany_membersに所属が無い場合はforbidden", async () => {
    const user = { id: "user-1" };

    const result = await resolveQuickExpenseAuthorization({
      authHeader: "Bearer valid.jwt",
      fetchUser: async () => user,
      fetchCompanyMembership: async () => null,
    });

    expect(result).toEqual({ outcome: "forbidden", user, membership: null, reason: "no_company_membership" });
  });

  it("fetchCompanyMembershipが例外を投げた場合はforbidden（fail-closed）", async () => {
    const user = { id: "user-1" };

    const result = await resolveQuickExpenseAuthorization({
      authHeader: "Bearer valid.jwt",
      fetchUser: async () => user,
      fetchCompanyMembership: async () => {
        throw new Error("db error");
      },
    });

    expect(result.outcome).toBe("forbidden");
    expect(result.reason).toBe("fetch_membership_exception");
  });

  it("有効なJWT + company_members所属ありの場合はauthorized（membershipをそのまま返す）", async () => {
    const user = { id: "user-1" };
    const membership = { company_id: "company-a", role: "user" };

    const result = await resolveQuickExpenseAuthorization({
      authHeader: "Bearer valid.jwt",
      fetchUser: async () => user,
      fetchCompanyMembership: async () => membership,
    });

    expect(result).toEqual({ outcome: "authorized", user, membership, reason: null });
  });

  it("別ユーザーのJWTを渡しても、そのユーザー自身のcompany_members所属で判定される（なりすまし不可）", async () => {
    // fetchUserはAuthorizationヘッダーから解決された「本人」しか返せない
    // 設計のため、他人のuser_idを直接指定して所属確認をすり抜ける経路は無い
    // ことを、fetchCompanyMembershipへ渡されるuserがfetchUserの戻り値と
    // 一致していることで確認する。
    const resolvedUser = { id: "actual-caller" };
    let receivedUser = null;

    await resolveQuickExpenseAuthorization({
      authHeader: "Bearer someones.jwt",
      fetchUser: async () => resolvedUser,
      fetchCompanyMembership: async (user) => {
        receivedUser = user;
        return { company_id: "company-a", role: "user" };
      },
    });

    expect(receivedUser).toBe(resolvedUser);
  });
});
