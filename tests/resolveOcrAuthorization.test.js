import { describe, it, expect, vi } from "vitest";
import { resolveOcrAuthorization } from "../supabase/functions/ocr-receipt/resolveOcrAuthorization.js";

// Deno固有のAPI（Deno.serve/Deno.env/createClient）には一切依存しない
// 純粋関数のため、fetchUser/hasCompanyMembershipをモックしてNode/vitestから
// 直接テストできる。Azure実APIはこのファイルの範囲外（呼ばれない）。

describe("resolveOcrAuthorization", () => {
  it("Authorizationヘッダーが無い場合はunauthorized（fetchUserは呼ばれない）", async () => {
    const fetchUser = vi.fn();
    const hasCompanyMembership = vi.fn();

    const result = await resolveOcrAuthorization({
      authHeader: null,
      fetchUser,
      hasCompanyMembership,
    });

    expect(result).toEqual({ outcome: "unauthorized", user: null });
    expect(fetchUser).not.toHaveBeenCalled();
    expect(hasCompanyMembership).not.toHaveBeenCalled();
  });

  it("不正なJWT（fetchUserがnullを返す）の場合はunauthorized", async () => {
    const hasCompanyMembership = vi.fn();

    const result = await resolveOcrAuthorization({
      authHeader: "Bearer invalid.jwt.here",
      fetchUser: async () => null,
      hasCompanyMembership,
    });

    expect(result).toEqual({ outcome: "unauthorized", user: null });
    expect(hasCompanyMembership).not.toHaveBeenCalled();
  });

  it("fetchUserが例外を投げた場合もunauthorizedとして安全に扱う", async () => {
    const result = await resolveOcrAuthorization({
      authHeader: "Bearer malformed",
      fetchUser: async () => {
        throw new Error("invalid token");
      },
      hasCompanyMembership: vi.fn(),
    });

    expect(result.outcome).toBe("unauthorized");
  });

  it("有効なJWTだがcompany_membersに所属が無い場合はforbidden", async () => {
    const user = { id: "user-1" };

    const result = await resolveOcrAuthorization({
      authHeader: "Bearer valid.jwt",
      fetchUser: async () => user,
      hasCompanyMembership: async () => false,
    });

    expect(result).toEqual({ outcome: "forbidden", user });
  });

  it("hasCompanyMembershipが例外を投げた場合はforbidden（fail-closed）", async () => {
    const user = { id: "user-1" };

    const result = await resolveOcrAuthorization({
      authHeader: "Bearer valid.jwt",
      fetchUser: async () => user,
      hasCompanyMembership: async () => {
        throw new Error("db error");
      },
    });

    expect(result.outcome).toBe("forbidden");
  });

  it("有効なJWT + company_members所属ありの場合はauthorized", async () => {
    const user = { id: "user-1" };

    const result = await resolveOcrAuthorization({
      authHeader: "Bearer valid.jwt",
      fetchUser: async () => user,
      hasCompanyMembership: async () => true,
    });

    expect(result).toEqual({ outcome: "authorized", user });
  });

  it("別ユーザーのJWTを渡しても、そのユーザー自身のcompany_members所属で判定される（なりすまし不可）", async () => {
    // fetchUserはAuthorizationヘッダーから解決された「本人」しか返せない
    // 設計のため、他人のuser_idを直接指定して所属確認をすり抜ける経路は無い
    // ことを、hasCompanyMembershipへ渡されるuserがfetchUserの戻り値と
    // 一致していることで確認する。
    const resolvedUser = { id: "actual-caller" };
    let receivedUser = null;

    await resolveOcrAuthorization({
      authHeader: "Bearer someones.jwt",
      fetchUser: async () => resolvedUser,
      hasCompanyMembership: async (user) => {
        receivedUser = user;
        return true;
      },
    });

    expect(receivedUser).toBe(resolvedUser);
  });
});
