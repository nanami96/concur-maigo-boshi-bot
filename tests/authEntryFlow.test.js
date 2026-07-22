import { describe, it, expect } from "vitest";
import { initialAuthEntryMode, modeAfterSignUpSwitch } from "../src/admin/authEntryFlow";

describe("initialAuthEntryMode", () => {
  it("startWithInviteCode=trueの場合、最初にinvite（会社へ参加）画面から始まる（一般利用者Botの新規登録導線）", () => {
    expect(initialAuthEntryMode(true)).toBe("invite");
  });

  it("startWithInviteCode=falseの場合、従来通りlogin画面から始まる（管理画面の既存導線を維持）", () => {
    expect(initialAuthEntryMode(false)).toBe("login");
  });
});

describe("modeAfterSignUpSwitch", () => {
  it("startWithInviteCode=trueの場合、「アカウントを作成」はinvite（招待コード入力）へ進む", () => {
    expect(modeAfterSignUpSwitch(true)).toBe("invite");
  });

  it("startWithInviteCode=falseの場合、「アカウントを作成」は従来通りsignupへ直接進む", () => {
    expect(modeAfterSignUpSwitch(false)).toBe("signup");
  });
});
