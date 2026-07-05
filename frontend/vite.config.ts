import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 标准配置：固定端口 14200，热重载，忽略 src-tauri
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
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
    // antd 单 chunk 1.15MB 触发 rollup 默认 500KB 警告；桌面应用本地加载可接受
    // (CLAUDE.md backlog 已背书)，调高阈值消噪音(真正瘦身见 backlog §1 antd 按需评估)。
    chunkSizeWarningLimit: 1500,
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
