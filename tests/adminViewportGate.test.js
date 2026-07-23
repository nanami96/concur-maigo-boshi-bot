import { describe, it, expect } from "vitest";
import { ADMIN_MIN_VIEWPORT_WIDTH, resolveAdminViewportView } from "../src/admin/adminViewportGate";

describe("resolveAdminViewportView", () => {
  it("採用中の閾値(1024px)未満はblocked", () => {
    expect(resolveAdminViewportView({ viewportWidth: 320 })).toBe("blocked");
    expect(resolveAdminViewportView({ viewportWidth: 768 })).toBe("blocked");
    expect(resolveAdminViewportView({ viewportWidth: 1023 })).toBe("blocked");
  });

  it("採用中の閾値(1024px)以上はallowed", () => {
    expect(resolveAdminViewportView({ viewportWidth: 1024 })).toBe("allowed");
    expect(resolveAdminViewportView({ viewportWidth: 1280 })).toBe("allowed");
  });

  it("minWidthを明示指定すればそちらを使う", () => {
    expect(resolveAdminViewportView({ viewportWidth: 900, minWidth: 800 })).toBe("allowed");
    expect(resolveAdminViewportView({ viewportWidth: 700, minWidth: 800 })).toBe("blocked");
  });

  it("既定のminWidthはADMIN_MIN_VIEWPORT_WIDTHと一致する", () => {
    expect(ADMIN_MIN_VIEWPORT_WIDTH).toBe(1024);
  });
});
