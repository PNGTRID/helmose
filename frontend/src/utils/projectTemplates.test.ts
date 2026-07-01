// projectTemplates.ts 单测（vitest）：4 模板正文结构
import { describe, it, expect } from "vitest";
import {
  projectTemplateBody,
  PROJECT_TEMPLATE_OPTIONS,
  type ProjectTemplate,
} from "./projectTemplates";

describe("projectTemplateBody", () => {
  it("blank：含 H1 + 相关链接", () => {
    const body = projectTemplateBody("blank", "Test");
    expect(body).toContain("# Test");
    expect(body).toContain("## 相关链接");
    expect(body).toContain("一句话定位");
  });

  it("tasks：含行动 + 第一项任务（带 📅）", () => {
    const body = projectTemplateBody("tasks", "Test");
    expect(body).toContain("# Test");
    expect(body).toContain("## 行动");
    expect(body).toMatch(/- \[ \] 第一项 📅 \d{4}-\d{2}-\d{2}/);
  });

  it("okr：含 目标 (O) / 关键结果 (KR) / 行动", () => {
    const body = projectTemplateBody("okr", "Test");
    expect(body).toContain("# Test");
    expect(body).toContain("## 目标 (O)");
    expect(body).toContain("## 关键结果 (KR)");
    expect(body).toContain("## 行动");
  });

  it("knowledge：含 主题 + 笔记", () => {
    const body = projectTemplateBody("knowledge", "Test");
    expect(body).toContain("# Test");
    expect(body).toContain("## 主题");
    expect(body).toContain("## 笔记");
  });

  it("PROJECT_TEMPLATE_OPTIONS 4 项齐全", () => {
    const keys: ProjectTemplate[] = ["blank", "tasks", "okr", "knowledge"];
    for (const k of keys) {
      expect(PROJECT_TEMPLATE_OPTIONS.find((o) => o.value === k)).toBeTruthy();
    }
    expect(PROJECT_TEMPLATE_OPTIONS).toHaveLength(4);
  });
});
