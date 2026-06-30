// 树/文件域纯函数：排序比较、子目录计算、文件图标（从 FilePanel 迁入，逻辑/签名不变）
// 注：fileIcon 返回 JSX（图标组件），故本文件用 .tsx 而非 .ts。
import type { ReactNode } from "react";
import { FileImageOutlined, FileOutlined, FileTextOutlined } from "@ant-design/icons";

export type SortMode = "natural" | "name";

/** 按文件名给出图标（md / 图片 / 其他） */
export function fileIcon(name: string): ReactNode {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "md" || ext === "markdown")
    return <FileTextOutlined style={{ marginRight: 6, color: "#8b5cf6", flexShrink: 0 }} />;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext ?? ""))
    return <FileImageOutlined style={{ marginRight: 6, color: "#10b981", flexShrink: 0 }} />;
  return <FileOutlined style={{ marginRight: 6, color: "var(--ob-text-faint)", flexShrink: 0 }} />;
}

/** 构造排序比较器：name=纯字典序，natural=数字感知（如 2 < 10） */
export function makeCompare(mode: SortMode) {
  if (mode === "name") {
    return (a: string, b: string) => a.localeCompare(b, "zh-Hans", { sensitivity: "base" });
  }
  return (a: string, b: string) =>
    a.localeCompare(b, "zh-Hans", { numeric: true, sensitivity: "base" });
}

/** 取某目录的直接子目录（不含更深层级） */
export function childDirs(dir: string, dirs: string[]): string[] {
  return dirs.filter((d) => {
    if (dir === "") return d !== "" && !d.includes("/");
    return d.startsWith(dir + "/") && !d.slice(dir.length + 1).includes("/");
  });
}
