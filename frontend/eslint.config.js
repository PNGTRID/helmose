import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

// Helmose 前端 ESLint 配置（flat config）
// 策略：推荐规则集为基础，项目实际风格做少量放宽，不阻断现有代码
export default tseslint.config(
  // 忽略目录
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },

  // 基础推荐规则
  js.configs.recommended,

  // TypeScript 推荐规则（type-aware 模式太重，用非类型版本即可）
  ...tseslint.configs.recommended,

  // React hooks + refresh（Vite HMR）
  {
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // rules-of-hooks 是正确性铁律，必须 error
      ...reactHooks.configs.recommended.rules,
      // React 19 新规则：对现有代码库过于激进，降级为 warn（渐进式收紧）
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      // exhaustive-deps 保留 warn（常见且合理）
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },

  // 项目定制规则
  {
    rules: {
      // 宽松：允许 console（桌面应用调试常用）
      "no-console": "off",
      // 宽松：允许未使用变量以 _ 开头（占位参数）
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // 宽松：允许 any 但警告（渐进式收紧）
      "@typescript-eslint/no-explicit-any": "warn",
      // 宽松：允许非空断言（Rust 交互层常用）
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
