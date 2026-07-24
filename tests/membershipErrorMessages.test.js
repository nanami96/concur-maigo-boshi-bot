import { describe, it, expect } from "vitest";
import { resolveMembershipErrorMessage } from "../src/admin/membershipErrorMessages";

describe("resolveMembershipErrorMessage", () => {
  it("エラーが無ければnull", () => {
    expect(resolveMembershipErrorMessage(null)).toBeNull();
  });

  it.each([
    "already_member",
    "invalid_code",
    "platform_forbidden",
    "forbidden",
    "last_admin",
    "last_admin_removal",
    "cannot_remove_self",
    "invalid_role",
    "invalid_company_code",
    "company_name_required",
    "company_code_taken",
    "not_found",
    "auth",
    "network",
  ])("種別「%s」に対して空でない日本語メッセージを返す", (type) => {
    const message = resolveMembershipErrorMessage(type);
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
  });

  it("platform_forbiddenとforbiddenは異なるメッセージを返す（サービス運営者権限と会社管理者権限の混同を防ぐ）", () => {
    expect(resolveMembershipErrorMessage("platform_forbidden")).not.toBe(
      resolveMembershipErrorMessage("forbidden"),
    );
  });

  it("未知の種別はunknown向けメッセージにフォールバックする", () => {
    expect(resolveMembershipErrorMessage("something-else")).toBe(
      resolveMembershipErrorMessage("unknown"),
    );
  });
});
