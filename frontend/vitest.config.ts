import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// 独立 vitest 配置（不碰 vite.config.ts，绕开 vite.config.js/.d.ts 冗余产物冲突）。
// utils 纯函数不需 DOM，用 node 环境；co-located 测试放各模块旁（src/**/*.test.ts）。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
