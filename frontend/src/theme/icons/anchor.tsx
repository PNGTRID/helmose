// Helmose 品牌锚形图标（舵手 / helm 叙事）。
// 替换 AppIcon REGISTRY 中 anchor: LinkOutlined 的语义错位（链式图标冒充锚）。
// 注册到 CUSTOM_REGISTRY 后 <AppIcon name="anchor" /> 自动优先匹配（优先级高于内置 REGISTRY）。
// 设计约束：viewBox 0 0 1024 1024（与 antd 图标画布一致）· width/height=1em（跟随 AppIcon 外层 fontSize）·
//           strokeWidth 56（视觉权重接近 antd outlined）· currentColor（自动跟随深浅主题）。
import type { ReactNode } from "react";
import { registerIcon } from "../../components/AppIcon";

function AnchorSvg(): ReactNode {
  return (
    <svg
      viewBox="0 0 1024 1024"
      width="1em"
      height="1em"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* 顶部锚环 */}
      <circle cx="512" cy="160" r="64" stroke="currentColor" strokeWidth="56" />
      {/* 横杆 */}
      <path
        d="M304 288 L720 288"
        stroke="currentColor"
        strokeWidth="56"
        strokeLinecap="round"
      />
      {/* 主干 */}
      <path
        d="M512 288 L512 832"
        stroke="currentColor"
        strokeWidth="56"
        strokeLinecap="round"
      />
      {/* 左右锚爪弧 */}
      <path
        d="M272 576 Q272 816 512 848 Q752 816 752 576"
        stroke="currentColor"
        strokeWidth="56"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

// 模块 import 即注册（main.tsx 顶部 import "./theme/icons/anchor"）
registerIcon("anchor", <AnchorSvg />);
