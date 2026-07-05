// HTML 净化（防存储型 XSS）：所有 dangerouslySetInnerHTML 注入前必经此函数。
//
// 风险链：vault md 经后端 pulldown-cmark 渲染为 HTML，pulldown-cmark 默认透传 inline HTML
// （<script>/<iframe>/<img onerror>）。在 Tauri webview（tauri:// 源）下，注入的脚本可调
// window.__TAURI__ 触发 IPC（删 vault / 读 config.json 明文 key）——存储型 XSS 直达系统权限。
//
// 显式白名单（防 DOMPurify 升级语义漂移）+ 禁 style 属性（防 CSS 数据外泄）。
// data-target 必须保留（wikilink 渲染依赖）。
// 后端 pulldown-cmark 无「关闭 raw HTML」的 option，故前端净化是主防线；CSP script-src 'self' 是纵深。
import DOMPurify from "dompurify";

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "del", "code", "pre", "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "th", "td",
  "a", "img", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "hr", "span", "div", "input", "sup", "sub",
];

const ALLOWED_ATTR = [
  "href", "src", "alt", "title", "class",
  "data-target", // wikilink 跳转依赖（后端 render_wikilinks 生成）
  "checked", "disabled", "type", // 任务列表 checkbox
  "colspan", "rowspan", // 表格
];

/** 净化 HTML：显式白名单剥危险标签/属性，禁 style 防 CSS 注入 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: true, // 允许 data-*（data-target 已在白名单；其他 data-* 无害）
    FORBID_ATTR: ["style"],
  });
}
