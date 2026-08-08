import { describe, it, expect, vi } from "vitest";
import { resolveQuickExpenseAuthorization } from "../supabase/functions/create-concur-quick-expense/resolveQuickExpenseAuthorization.js";

// tests/resolveOcrAuthorization.test.jsと同じ方針：Deno固有のAPI
// （Deno.serve/Deno.env/createClient）には一切依存しない純粋関数のため、
// fetchUserをモックしてNode/vitestから直接テストできる。実際のConcur API・
// Supabaseプロジェクトへは一切接続しない。
//
// 【複数社所属対応・Commit 1で変更】この関数はもうfetchCompanyMembershipを
// 呼ばない（会社所属の確認はhandleQuickExpenseRequest.js側、本文検証後に
// companyIdを渡して行う。resolveQuickExpenseAuthorization.js冒頭コメント参照）。
// そのため、このテストはfetchUserによる本人確認だけを検証する。

describe("resolveQuickExpenseAuthorization", () => {
  it("Authorizationヘッダーが無い場合はunauthorized（fetchUserは呼ばれない）", async () => {
    const fetchUser = vi.fn();

    const result = await resolveQuickExpenseAuthorization({
      authHeader: null,
      fetchUser,
    });

    expect(result).toEqual({ outcome: "unauthorized", user: null, reason: "no_auth_header" });
    expect(fetchUser).not.toHaveBeenCalled();
  });

  it("不正なJWT（fetchUserがnullを返す）の場合はunauthorized", async () => {
    const result = await resolveQuickExpenseAuthorization({
      authHeader: "Bearer invalid.jwt.here",
      fetchUser: async () => null,
    });

    expect(result).toEqual({ outcome: "unauthorized", user: null, reason: "fetch_user_null" });
  });

  it("fetchUserが例外を投げた場合もunauthorizedとして安全に扱う", async () => {
    const result = await resolveQuickExpenseAuthorization({
      authHeader: "Bearer malformed",
      fetchUser: async () => {
        throw new Error("invalid token");
      },
    });

    expect(result.outcome).toBe("unauthorized");
    expect(result.reason).toBe("fetch_user_exception");
  });

  it("有効なJWTの場合はauthorized（userをそのまま返す。所属会社の確認は行わない）", async () => {
    const user = { id: "user-1" };

    const result = await resolveQuickExpenseAuthorization({
      authHeader: "Bearer valid.jwt",
      fetchUser: async () => user,
    });

    expect(result).toEqual({ outcome: "authorized", user, reason: null });
  });

  it("戻り値にmembershipキー自体を含めない（会社所属の解決はこの関数の責務外）", async () => {
    const result = await resolveQuickExpenseAuthorization({
      authHeader: "Bearer valid.jwt",
      fetchUser: async () => ({ id: "user-1" }),
    });

    expect(result).not.toHaveProperty("membership");
    expect(Object.keys(result).sort()).toEqual(["outcome", "reason", "user"]);
  });
});
