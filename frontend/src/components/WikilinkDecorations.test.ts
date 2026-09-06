// WikilinkDecorations 纯函数测试：parseWikilinksInText（正则 + target 解析契约）。
// 对齐后端 services/indexer/wikilinks.rs::extract_wikilinks 的 target 口径
// （split('#') 去锚点 + trim + 空 target 跳过），用例与后端 alias_and_anchor 测试同源。
// vitest node 环境；buildDecorations 涉 ProseMirror doc 构造（需 schema/DOM），靠 tauri:dev 实测。
import { describe, expect, it } from "vitest";
import { parseWikilinksInText } from "./WikilinkDecorations";

describe("parseWikilinksInText", () => {
  it("基本 [[target]] 命中且 target 正确", () => {
    const hits = parseWikilinksInText("见 [[张三]]");
    expect(hits).toHaveLength(1);
    expect(hits[0].target).toBe("张三");
  });

  it("index/length 精确覆盖 [[ ]] 全长", () => {
    const text = "见 [[张三]] 尾";
    const hits = parseWikilinksInText(text);
    expect(text.slice(hits[0].index, hits[0].index + hits[0].length)).toBe("[[张三]]");
  });

  it("别名 [[target|alias]]：target 取首段，alias 不影响 target", () => {
    expect(parseWikilinksInText("[[Picboil|出海工具]]")[0].target).toBe("Picboil");
  });

  it("锚点 [[target#anchor]]：去锚点取 target（对齐后端）", () => {
    expect(parseWikilinksInText("[[2026-04-01#概述]]")[0].target).toBe("2026-04-01");
  });

  it("target 两端空白被 trim", () => {
    expect(parseWikilinksInText("[[  spaced  ]]")[0].target).toBe("spaced");
  });

  it("[[#anchor]] target 为空 → 跳过（对齐后端 is_empty 判定）", () => {
    expect(parseWikilinksInText("[[#onlyanchor]]")).toEqual([]);
  });

  it("多个 wikilink 共存，按出现顺序返回", () => {
    const hits = parseWikilinksInText("[[a]] 中 [[b|别名]] 尾 [[c#x]]");
    expect(hits.map((h) => h.target)).toEqual(["a", "b", "c"]);
  });

  it("无 wikilink → 空数组", () => {
    expect(parseWikilinksInText("普通文本无双链")).toEqual([]);
  });

  it("单个 [ 不误匹配（需成对 [[）", () => {
    expect(parseWikilinksInText("数组 [0] 非 wikilink")).toEqual([]);
  });
});
