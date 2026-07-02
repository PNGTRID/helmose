import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App as AntdApp, ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import { useThemeStore } from "./stores/theme";
import { colorsFor, tokens } from "./theme/tokens";
import "./theme/icons/anchor"; // 注册品牌锚形 SVG（覆盖 AppIcon 内置 anchor: LinkOutlined）
import "./index.css";

// 主题外壳：订阅 theme store，antd 算法 + token 随主题切换。
// token 经 tokens.ts 单一来源（大海蓝主题）；当前不开 cssVar（待 canvas 取色修复后阶段二启用）。
function ThemeShell({ children }: { children: React.ReactNode }) {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";
  const c = colorsFor(theme);
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: c.accent,
          colorSuccess: c.success,
          colorWarning: c.warning,
          colorError: c.error,
          colorInfo: c.info,
          borderRadius: tokens.radius.md,
          borderRadiusLG: tokens.radius.lg,
          borderRadiusSM: tokens.radius.sm,
          fontSize: tokens.typography.fontSizeBase,
          controlHeight: 32,
          colorBgContainer: c.bg,
          colorBgLayout: c.bgMod,
          colorBgElevated: c.bg,
          colorBorder: c.border,
          colorBorderSecondary: c.borderStrong,
          colorText: c.text,
          colorTextSecondary: c.textMuted,
          colorTextTertiary: c.textFaint,
          fontFamily: tokens.typography.fontFamily,
        },
        components: {
          Button: { controlHeight: 32, paddingInline: 12, primaryShadow: "none", defaultShadow: "none" },
          Card: { headerHeight: 44, paddingLG: 16, boxShadowTertiary: "none" },
          Segmented: { itemSelectedBg: c.accentMod, itemSelectedColor: c.accent, controlHeight: 28 },
          Tag: { defaultBg: c.accentMod },
          Input: { activeShadow: `0 0 0 2px ${c.accentMod}` },
          InputNumber: { activeShadow: `0 0 0 2px ${c.accentMod}` },
          Menu: { itemBorderRadius: tokens.radius.sm, activeBarBorderWidth: 0 },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}

// Tauri 下用 HashRouter 最稳（避免 webview base 路径问题）
ReactDOM.createRoot(document.getElementById("root")!).render(
  // 包 antd <App>：解决 antd 6 静态方法（message/notification/Modal.confirm）不消费 ConfigProvider
  //   locale/theme context 的坑（官方 why-not-static）。现有 message.* 硬编码中文不改，
  //   未来 Modal.confirm 等经 App.useApp() 拿到 context 中文。
  <React.StrictMode>
    <ThemeShell>
      <AntdApp>
        <HashRouter>
          <App />
        </HashRouter>
      </AntdApp>
    </ThemeShell>
  </React.StrictMode>
);
