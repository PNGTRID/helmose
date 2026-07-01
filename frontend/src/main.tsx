import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import { useThemeStore } from "./stores/theme";
import "./index.css";

// 主题外壳：订阅 theme store，antd 算法（亮/暗）随主题切换重渲染。
function ThemeShell({ children }: { children: React.ReactNode }) {
  const theme = useThemeStore((s) => s.theme);
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm:
          theme === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: "#7C3AED", borderRadius: 6 },
      }}
    >
      {children}
    </ConfigProvider>
  );
}

// Tauri 下用 HashRouter 最稳（避免 webview base 路径问题）
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeShell>
      <HashRouter>
        <App />
      </HashRouter>
    </ThemeShell>
  </React.StrictMode>
);
