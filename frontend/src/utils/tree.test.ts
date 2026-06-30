import { describe, it, expect } from "vitest";
import React from "react";
import { makeCompare, childDirs, fileIcon } from "./tree";
import {
  FileTextOutlined,
  FileImageOutlined,
  FileOutlined,
} from "@ant-design/icons";

describe("makeCompare", () => {
  it("natural 模式：数字感知（file2 < file10）", () => {
    const cmp = makeCompare("natural");
    const arr = ["file10", "file2", "file1"];
    expect([...arr].sort(cmp)).toEqual(["file1", "file2", "file10"]);
  });

  it("name 模式：纯字典序（file10 < file2，按字符）", () => {
    const cmp = makeCompare("name");
    const arr = ["file10", "file2", "file1"];
    expect([...arr].sort(cmp)).toEqual(["file1", "file10", "file2"]);
  });
});

describe("childDirs", () => {
  it("根目录（''）：返回所有顶层目录（不含 /）", () => {
    expect(childDirs("", ["a", "a/b", "c", "a/b/c"])).toEqual(["a", "c"]);
  });

  it("子目录：只返回直接子（深一层）", () => {
    expect(childDirs("a", ["a", "a/b", "a/b/c", "a/d"])).toEqual(["a/b", "a/d"]);
  });

  it("无子目录 → 空数组", () => {
    expect(childDirs("a/b", ["a", "a/b"])).toEqual([]);
  });
});

describe("fileIcon", () => {
  it("md / markdown → FileTextOutlined", () => {
    expect(fileIcon("note.md").type).toBe(FileTextOutlined);
    expect(fileIcon("note.markdown").type).toBe(FileTextOutlined);
  });

  it("图片（大小写不敏感）→ FileImageOutlined", () => {
    expect(fileIcon("pic.PNG").type).toBe(FileImageOutlined);
    expect(fileIcon("pic.jpg").type).toBe(FileImageOutlined);
  });

  it("其他类型 → FileOutlined", () => {
    expect(fileIcon("file.pdf").type).toBe(FileOutlined);
    expect(fileIcon("noext").type).toBe(FileOutlined);
  });
});

// 占位引用，避免 React 未用告警（fileIcon 返回 ReactNode，本文件为 .tsx）
void React;
