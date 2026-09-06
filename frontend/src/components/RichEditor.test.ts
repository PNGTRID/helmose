// RichEditor 纯函数测试：unescapeWikilink（P0-1 回归防护）。
// vitest node 环境（Tiptap 编辑器实例需 DOM，故只测抽出的纯函数；编辑器集成靠 tauri:dev 实测）。
import { describe, expect, it } from "vitest";
import { unescapeWikilink } from "./RichEditor";

describe("unescapeWikilink", () => {
  it("还原单个双链的成对转义括号", () => {
    expect(unescapeWikilink("见 \\[\\[张三\\]\\]")).toBe("见 [[张三]]");
  });

  it("还原带 alias 的双链（| 不被转义，原样保留）", () => {
    expect(unescapeWikilink("\\[\\[Picboil|出海工具\\]\\]")).toBe("[[Picboil|出海工具]]");
  });

  it("还原多个连续双链", () => {
    expect(unescapeWikilink("\\[\\[a\\]\\]\\[\\[b\\]\\]")).toBe("[[a]][[b]]");
  });

  it("不误伤单个转义方括号（如字面数组 \\[0\\]）", () => {
    // 单个 \[ 不匹配 \[\[（需两个连续转义括号），保持原样
    expect(unescapeWikilink("数组 \\[0\\]")).toBe("数组 \\[0\\]");
  });

  it("混合：双链 + 字面方括号共存，只还原双链", () => {
    expect(unescapeWikilink("\\[\\[x\\]\\] 和 \\[0\\]")).toBe("[[x]] 和 \\[0\\]");
  });

  it("无转义内容原样返回", () => {
    expect(unescapeWikilink("普通文本 [[已是原文]] 结束")).toBe("普通文本 [[已是原文]] 结束");
  });
});
