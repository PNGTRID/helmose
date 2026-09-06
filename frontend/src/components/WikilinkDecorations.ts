// wikilink 可点装饰（ProseMirror Decoration 视图层）：把正文里 [[x]] / [[x|y]] 的文本区间
// 套上 helmose-wikilink class + data-target 属性的 inline 装饰，使其在可视化模式显示为彩色可点链接。
//
// 设计要点（见 spec editor-dual-mode design.md「决策 1」）：
// - **不改文档模型**：只装饰视图层，序列化/索引全不动 → unescapeWikilink 链路与 indexer 不受影响。
// - **跳过代码块**：descendants 遇 codeBlock 直接 return false 不深入，对齐后端 fenced 代码块不替换。
// - **target 解析对齐后端 extract_wikilinks**（services/indexer/wikilinks.rs）：split('#') 去锚点 + trim；
//   target 为空（[[#anchor]]）跳过——与后端 is_empty 判定一致（防装饰空 data-target 误跳转）。
// - **复用现有资产**：class 名 helmose-wikilink 命中 .md-preview .helmose-wikilink CSS（index.css:215），
//   data-target 由 useWikilinkNavigation 的 closest('.helmose-wikilink') + dataset.target 读取跳转。
// - **范围折中**：[[ ]] 符号也彩色显示（不隐藏），整体可点；Obsidian 式隐藏符号需 Decoration.widget（记 backlog）。
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PmNode } from "@tiptap/pm/model";

/** wikilink 正则：[[target]] 或 [[target|别名]]（与后端 extract_wikilinks 一致） */
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export interface WikilinkHit {
  /** 命中起点（相对文本起始的字符偏移） */
  index: number;
  /** 命中原文长度（含 [[ ]]，供装饰区间精确） */
  length: number;
  /** 解析后 target：去锚点 + trim（对齐后端 extract_wikilinks） */
  target: string;
}

/** 扫描一段文本返回所有 wikilink 命中（target 取首段去锚点 trim，空 target 跳过对齐后端）。
 *  纯函数：供 buildDecorations 与单测复用，固定正则 + target 解析契约。 */
export function parseWikilinksInText(text: string): WikilinkHit[] {
  const hits: WikilinkHit[] = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    // target 取首段并对齐后端 extract_wikilinks：split('#') 去锚点 + trim
    const target = m[1].split("#")[0].trim();
    if (!target) continue; // [[#anchor]] 等 target 空 → 跳过，对齐后端 is_empty 判定
    hits.push({ index: m.index, length: m[0].length, target });
  }
  return hits;
}

/** 扫描 doc 文本节点，对所有 wikilink 命中区间建 inline 装饰（跳过代码块子树）。
 *  仅装饰视图层，不改文档内容；target 解析复用 parseWikilinksInText。 */
function buildDecorations(doc: PmNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    // 代码块整棵子树跳过（对齐后端 fenced 代码块不替换 wikilink）
    if (node.type.name === "codeBlock") return false;
    // 非文本节点继续深入找 text
    if (!node.isText) return true;
    const text = node.text ?? "";
    for (const hit of parseWikilinksInText(text)) {
      decos.push(
        Decoration.inline(pos + hit.index, pos + hit.length, {
          class: "helmose-wikilink",
          "data-target": hit.target,
        })
      );
    }
    return false; // text 节点无子节点，停止深入
  });
  return DecorationSet.create(doc, decos);
}

/** wikilink 装饰扩展：注册 ProseMirror plugin，编辑区视图层高亮 [[x]] 为可点彩色链接。
 *  经 RichEditor 的 extensions 数组注册；点击跳转由外层 onClick 委托给 useWikilinkNavigation。 */
export const WikilinkDecorations = Extension.create({
  name: "wikilinkDecorations",
  addProseMirrorPlugins() {
    const key = new PluginKey("wikilinkDecorations");
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init(_, { doc }) {
            return buildDecorations(doc);
          },
          apply(tr, old) {
            // 文档变更才重算装饰，否则复用旧 DecorationSet（性能）
            return tr.docChanged ? buildDecorations(tr.doc) : old;
          },
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
        },
      }),
    ];
  },
});

export default WikilinkDecorations;
