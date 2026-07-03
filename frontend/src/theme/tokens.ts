// Helmose 设计 token 单一来源（大海蓝主题 · 舵手叙事）。
// 三方消费：
//   1) antd ConfigProvider（main.tsx import 颜色 token）
//   2) index.css 的 :root / html.dark（值与本文件保持一致；变量名沿用 --ob-accent 兼容现有组件 .css）
//   3) 业务代码动态取色（canvas/SVG/inline import { tokens } 直读 hex，避免未来 cssVar 模式下 CSS 变量字符串失效）
// 修改流程：改这一处 → 同步 index.css 的 :root / html.dark 值（二者必须一致）。

export const tokens = {
  color: {
    // 主色 · 去饱和靛蓝（舵手叙事；对标 Linear 低饱和高级感，脱离 AI 亮蓝）
    accent: "#4A6FA5", // 去饱和钢蓝，浅色主色
    accentHover: "#385582", // 悬浮加深
    accentMod: "#EAEFF7", // 主色淡底（选中行 / 聚焦 ring 背景 / Tag 默认底）

    // 背景
    bg: "#FFFFFF",
    bgMod: "#F8F9FA",
    bgModHover: "#EEF0F3",
    bgModActive: "#E7E9EC",

    // 边框
    border: "#E5E5E5",
    borderStrong: "#D4D4D4",

    // 文字
    text: "#333333",
    textMuted: "#6B7280",
    textFaint: "#9CA3AF",

    // 语义色（info 保留标准蓝 #2563EB，与海蓝主色 #0369A1 区分）
    success: "#16A34A",
    warning: "#D97706",
    error: "#DC2626",
    info: "#2563EB",

    // 四象限（Q2 改青色，避免与海蓝主色冲突）
    q1: "#DC2626", // 重要紧急 · 红
    q2: "#0891B2", // 重要不紧急 · 青（原 #2563EB 会与主色撞）
    q3: "#D97706", // 紧急不重要 · 黄
    q4: "#16A34A", // 不重要不紧急 · 绿
  },

  // 圆角阶梯（默认 md=6，与现有 --ob-radius 对齐）
  radius: { sm: 4, md: 6, lg: 8, xl: 12, pill: 9999 },

  // 间距阶梯（4 网格）
  spacing: [0, 4, 8, 12, 16, 24, 32, 48] as const,

  // 字体
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Roboto, sans-serif',
    fontFamilyMono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    fontSizeBase: 14,
  },

  // 动效
  motion: {
    fast: "0.12s",
    base: "0.2s",
    slow: "0.32s",
    easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
    easeSpring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  },
} as const;

// 暗色 token（独立调过，非简单反色；主色提亮 sky-400，正文非纯白避免刺眼）
export const darkTokens = {
  color: {
    accent: "#7C9AC4", // 深色主色提亮（去饱和浅靛蓝，深底可读）
    accentHover: "#9DB1D4", // 悬浮
    accentMod: "#122236", // 深色主色淡底

    bg: "#1E1E1E",
    bgMod: "#252526",
    bgModHover: "#2A2D2E",
    bgModActive: "#303032",

    border: "#3C3C3C",
    borderStrong: "#4A4A4A",

    text: "#D4D4D4",
    textMuted: "#9CA3AF",
    textFaint: "#6B7280",

    success: "#4ADE80",
    warning: "#FBBF24",
    error: "#F87171",
    info: "#60A5FA",

    q1: "#F87171",
    q2: "#22D3EE",
    q3: "#FBBF24",
    q4: "#4ADE80",
  },
} as const;

/** 供 antd ConfigProvider 按主题取色（深色覆盖浅色） */
export function colorsFor(mode: "light" | "dark") {
  return mode === "dark"
    ? { ...tokens.color, ...darkTokens.color }
    : tokens.color;
}
