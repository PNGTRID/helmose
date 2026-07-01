import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 标准配置：固定端口 14200，热重载，忽略 src-tauri
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  // CodeMirror 多实例去重：@uiw/react-codemirror 与 @codemirror/lang-markdown 各自依赖
  // @codemirror/state 等底层包，Vite dev 预构建（esbuild）可能为不同入口各打一份，
  // 运行时出现两份实例 → instanceof 检查失效 → "Unrecognized extension value in
  // extension set ([object Object])"，编辑器 tab 渲染失败。
  // dedupe 强制这些包的所有 import 解析到同一物理实例（CodeMirror 官方推荐解法）。
  resolve: {
    dedupe: [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
      "@codemirror/commands",
      "@codemirror/autocomplete",
      "@codemirror/lint",
      "@codemirror/search",
      "@codemirror/theme-one-dark",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/lr",
    ],
  },
  server: {
    port: 14200,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // 拆 vendor chunk：react / antd / tiptap(含 prosemirror) / tauri / utils 分离，
    // 主应用 chunk 更小、长期缓存友好。用函数形式按 module id 匹配——
    // 对象形式会对每个包名 resolve 主 entry，而 @tiptap/pm 无主 entry（子路径导出）会报错。
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@tiptap/") || id.includes("node_modules/prosemirror")) {
            return "tiptap";
          }
          if (
            id.includes("node_modules/react-dom") ||
            id.includes("node_modules/react-router") ||
            id.includes("node_modules/scheduler")
          ) {
            return "react";
          }
          if (id.includes("node_modules/react/")) {
            return "react";
          }
          if (id.includes("node_modules/antd") || id.includes("node_modules/@ant-design")) {
            return "antd";
          }
          if (id.includes("node_modules/@tauri-apps/")) {
            return "tauri";
          }
          if (
            id.includes("node_modules/zustand") ||
            id.includes("node_modules/dayjs") ||
            id.includes("node_modules/marked")
          ) {
            return "utils";
          }
          return undefined;
        },
      },
    },
  },
}));
