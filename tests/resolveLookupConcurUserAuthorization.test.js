import { describe, it, expect, vi } from "vitest";
import { resolveLookupConcurUserAuthorization } from "../supabase/functions/lookup-concur-user/resolveLookupConcurUserAuthorization.js";

const VALID_USER = { id: "user-1" };

describe("resolveLookupConcurUserAuthorization", () => {
  it("Authorizationヘッダーが無い場合はunauthorized。isPlatformAdminは呼ばれない", async () => {
    const isPlatformAdmin = vi.fn();

    const result = await resolveLookupConcurUserAuthorization({
      authHeader: null,
      fetchUser: vi.fn(),
      isPlatformAdmin,
    });

    expect(result.outcome).toBe("unauthorized");
    expect(isPlatformAdmin).not.toHaveBeenCalled();
  });

  it("無効なJWT（fetchUserがnullを返す）の場合はunauthorized", async () => {
    const isPlatformAdmin = vi.fn();

    const result = await resolveLookupConcurUserAuthorization({
      authHeader: "Bearer invalid.jwt",
      fetchUser: async () => null,
      isPlatformAdmin,
    });

    expect(result.outcome).toBe("unauthorized");
    expect(isPlatformAdmin).not.toHaveBeenCalled();
  });

  it("fetchUserが例外を投げた場合もunauthorized", async () => {
    const result = await resolveLookupConcurUserAuthorization({
      authHeader: "Bearer malformed",
      fetchUser: async () => {
        throw new Error("invalid token");
      },
      isPlatformAdmin: vi.fn(),
    });

    expect(result.outcome).toBe("unauthorized");
  });

  it("一般ユーザー（isPlatformAdminがfalse）はforbidden", async () => {
    const result = await resolveLookupConcurUserAuthorization({
      authHeader: "Bearer valid.jwt",
      fetchUser: async () => VALID_USER,
      isPlatformAdmin: async () => false,
    });

    expect(result.outcome).toBe("forbidden");
    expect(result.reason).toBe("not_platform_admin");
  });

  it("company_admin（会社の管理者だがplatform_adminではない）もforbidden", async () => {
    const result = await resolveLookupConcurUserAuthorization({
      authHeader: "Bearer valid.jwt",
      fetchUser: async () => ({ ...VALID_USER, appMetadata: { companyRole: "admin" } }),
      isPlatformAdmin: async () => false,
    });

    expect(result.outcome).toBe("forbidden");
  });

  it("platform_adminはauthorized", async () => {
    const result = await resolveLookupConcurUserAuthorization({
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
      const result = await resolveLookupConcurUserAuthorization({
        authHeader: "Bearer valid.jwt",
        fetchUser: async () => VALID_USER,
        isPlatformAdmin: async () => value,
      });

      expect(result.outcome).toBe("forbidden");
    },
  );

  it("isPlatformAdminが例外を投げた場合は安全側でforbidden（fail-closed）", async () => {
    const result = await resolveLookupConcurUserAuthorization({
      authHeader: "Bearer valid.jwt",
      fetchUser: async () => VALID_USER,
      isPlatformAdmin: async () => {
        throw new Error("db error");
      },
    });

    expect(result.outcome).toBe("forbidden");
  });

  it("フロント（呼び出し元）が渡すuser相当の値・request bodyに偽のplatform_admin主張が含まれていても、実際の判定はisPlatformAdmin()の結果だけで決まる", async () => {
    const spoofedUser = { ...VALID_USER, role: "platform_admin", isPlatformAdmin: true };

    const result = await resolveLookupConcurUserAuthorization({
      authHeader: "Bearer valid.jwt",
      fetchUser: async () => spoofedUser,
      isPlatformAdmin: async () => false,
    });

    expect(result.outcome).toBe("forbidden");
  });
});
