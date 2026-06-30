import { describe, it, expect } from "vitest";
import { extractOutline } from "./note";

describe("extractOutline", () => {
  it("提取 H1-H3 并标注层级", () => {
    const raw = "# 一级\n## 二级\n### 三级\n正文";
    expect(extractOutline(raw)).toEqual([
      { level: 1, text: "一级" },
      { level: 2, text: "二级" },
      { level: 3, text: "三级" },
    ]);
  });

  it("忽略 H4+ 与非标题行", () => {
    const raw = "#### 四级（忽略）\n普通段落\n# 一级";
    expect(extractOutline(raw)).toEqual([{ level: 1, text: "一级" }]);
  });

  it("无标题 → 空数组", () => {
    expect(extractOutline("只有正文\n没有标题")).toEqual([]);
  });

  it("标题文本首尾空白被 trim", () => {
    expect(extractOutline("#   标题   ")).toEqual([{ level: 1, text: "标题" }]);
  });
});
