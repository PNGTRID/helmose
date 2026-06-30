import { describe, it, expect } from "vitest";
import { dateKey } from "./date";

describe("dateKey", () => {
  it("有效 ISO 日期归一化为 YYYY-MM-DD", () => {
    expect(dateKey("2026-06-30")).toBe("2026-06-30");
    expect(dateKey("2026-01-15T08:30:00")).toBe("2026-01-15");
  });

  it("斜杠/中文日期格式也能解析并归一化", () => {
    expect(dateKey("2026/06/30")).toBe("2026-06-30");
  });

  it("null / 空 / 无效 → null（跳过该笔记）", () => {
    expect(dateKey(null)).toBeNull();
    expect(dateKey("")).toBeNull();
    expect(dateKey("not-a-date")).toBeNull();
  });
});
