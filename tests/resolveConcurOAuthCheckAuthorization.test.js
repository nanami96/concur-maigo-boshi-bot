import { describe, it, expect, vi } from "vitest";
import { resolveConcurOAuthCheckAuthorization } from "../supabase/functions/check-concur-oauth/resolveConcurOAuthCheckAuthorization.js";

const VALID_USER = { id: "user-1" };

describe("resolveConcurOAuthCheckAuthorization", () => {
  it("Authorizationヘッダーが無い場合はunauthorized。isPlatformAdminは呼ばれない", async () => {
    const isPlatformAdmin = vi.fn();

    const result = await resolveConcurOAuthCheckAuthorization({
      authHeader: null,
      fetchUser: vi.fn(),
      isPlatformAdmin,
    });

    expect(result.outcome).toBe("unauthorized");
    expect(isPlatformAdmin).not.toHaveBeenCalled();
  });

  it("無効なJWT（fetchUserがnullを返す）の場合はunauthorized", async () => {
    const isPlatformAdmin = vi.fn();

    const result = await resolveConcurOAuthCheckAuthorization({
      authHeader: "Bearer invalid.jwt",
      fetchUser: async () => null,
      isPlatformAdmin,
    });

    expect(result.outcome).toBe("unauthorized");
    expect(isPlatformAdmin).not.toHaveBeenCalled();
  });

  it("fetchUserが例外を投げた場合もunauthorized", async () => {
    const result = await resolveConcurOAuthCheckAuthorization({
      authHeader: "Bearer malformed",
      fetchUser: async () => {
        throw new Error("invalid token");
      },
      isPlatformAdmin: vi.fn(),
    });

    expect(result.outcome).toBe("unauthorized");
  });

  it("一般ユーザー（isPlatformAdminがfalse）はforbidden", async () => {
    const result = await resolveConcurOAuthCheckAuthorization({
      authHeader: "Bearer valid.jwt",
      fetchUser: async () => VALID_USER,
      isPlatformAdmin: async () => false,
    });

    expect(result.outcome).toBe("forbidden");
    expect(result.reason).toBe("not_platform_admin");
  });

  it("company_admin（会社の管理者だがplatform_adminではない）もforbidden", async () => {
    // platform_adminはcompany_members.roleとは別軸の権限（platform_adminsテーブル）
    // のため、会社のadminであること自体はここでの許可根拠にならない。
    const result = await resolveConcurOAuthCheckAuthorization({
      authHeader: "Bearer valid.jwt",
      fetchUser: async () => ({ ...VALID_USER, appMetadata: { companyRole: "admin" } }),
      isPlatformAdmin: async () => false,
    });

    expect(result.outcome).toBe("forbidden");
  });

  it("platform_adminはauthorized", async () => {
    const result = await resolveConcurOAuthCheckAuthorization({
      authHeader: "Bearer valid.jwt",
      fetchUser: async () => VALID_USER,
      isPlatformAdmin: async () => true,
    });

    expect(result.outcome).toBe("authorized");
    expect(result.user).toEqual(VALID_USER);
  });

  it.each([null, undefined, "true", 1, {}, "yes"])(
    "isPlatformAdminが真偽値true以外の値(%s)を返した場合、truthyであってもauthorizedにしない",
    async (value) => {
      const result = await resolveConcurOAuthCheckAuthorization({
        authHeader: "Bearer valid.jwt",
        fetchUser: async () => VALID_USER,
        isPlatformAdmin: async () => value,
      });

      expect(result.outcome).toBe("forbidden");
    },
  );

  it("isPlatformAdminが例外を投げた場合は安全側でforbidden（fail-closed）", async () => {
    const result = await resolveConcurOAuthCheckAuthorization({
      authHeader: "Bearer valid.jwt",
      fetchUser: async () => VALID_USER,
      isPlatformAdmin: async () => {
        throw new Error("db error");
      },
    });

    expect(result.outcome).toBe("forbidden");
  });

  it("フロント（呼び出し元）が渡すuser相当の値に偽のplatform_admin主張が含まれていても、実際の判定はisPlatformAdmin()の結果だけで決まる", async () => {
    // ユーザーオブジェクト自体に「自称role」が混ざっていても、この関数は
    // isPlatformAdmin()の戻り値だけを信用する（roleフィールドは一切参照しない）。
    const spoofedUser = { ...VALID_USER, role: "platform_admin", isPlatformAdmin: true };

    const result = await resolveConcurOAuthCheckAuthorization({
      authHeader: "Bearer valid.jwt",
      fetchUser: async () => spoofedUser,
      isPlatformAdmin: async () => false,
    });

    expect(result.outcome).toBe("forbidden");
  });
});
