// journalTemplates.ts 单测（vitest）：4 模板路径规则 + 内容契约
import { describe, it, expect } from "vitest";
import dayjs from "dayjs";
import {
  dayNoteRelPath,
  dailyTemplate,
  weeklyTemplate,
  monthlyTemplate,
  reviewTemplate,
  renderJournalTemplate,
} from "./journalTemplates";

describe("dayNoteRelPath 路径规则", () => {
  it("daily：07_决策与复盘/日志/YYYY-MM/YYYY-MM-DD.md", () => {
    expect(dayNoteRelPath(dayjs("2026-07-01"))).toBe(
      "07_决策与复盘/日志/2026-07/2026-07-01.md"
    );
  });

  it("weekly：加 -周报 后缀避免覆盖日报", () => {
    expect(dayNoteRelPath(dayjs("2026-07-01"), "weekly")).toBe(
      "07_决策与复盘/日志/2026-07/2026-07-01-周报.md"
    );
  });

  it("字符串日期入参", () => {
    expect(dayNoteRelPath("2026-07-01")).toBe(
      "07_决策与复盘/日志/2026-07/2026-07-01.md"
    );
  });

  it("monthly/review 不加后缀（与 daily 同路径）", () => {
    expect(dayNoteRelPath(dayjs("2026-07-01"), "monthly")).toBe(
      "07_决策与复盘/日志/2026-07/2026-07-01.md"
    );
  });
});

describe("dailyTemplate", () => {
  it("frontmatter type:log", () => {
    const md = dailyTemplate(dayjs("2026-07-01"));
    expect(md).toContain("type: log");
    expect(md).toContain("created: 2026-07-01");
    expect(md).toContain("mood:");
    expect(md).toContain("energy:");
  });

  it("4 section 齐全", () => {
    const md = dailyTemplate(dayjs("2026-07-01"));
    expect(md).toContain("## 今日待办");
    expect(md).toContain("## 关键事件");
    expect(md).toContain("## 复盘");
    expect(md).toContain("## 明日寄语");
  });
});

describe("weeklyTemplate", () => {
  it("frontmatter type:log + week_iso", () => {
    const md = weeklyTemplate(dayjs("2026-07-01"));
    expect(md).toContain("type: log");
    expect(md).toMatch(/week_iso: \d{4}-W\d{2}/);
  });

  it("4 section 齐全", () => {
    const md = weeklyTemplate(dayjs("2026-07-01"));
    expect(md).toContain("## 本周目标");
    expect(md).toContain("## 完成情况");
    expect(md).toContain("## 关键事件");
    expect(md).toContain("## 下周计划");
  });
});

describe("monthlyTemplate", () => {
  it("frontmatter type:experience + month_iso", () => {
    const md = monthlyTemplate(dayjs("2026-07-15"));
    expect(md).toContain("type: experience");
    expect(md).toContain("month_iso: 2026-07");
  });
});

describe("reviewTemplate", () => {
  it("默认 review_type", () => {
    const md = reviewTemplate(dayjs("2026-07-01"));
    expect(md).toContain("type: experience");
    expect(md).toContain('review_type: "项目"');
  });

  it("自定义 review_type", () => {
    const md = reviewTemplate(dayjs("2026-07-01"), "季度");
    expect(md).toContain('review_type: "季度"');
  });
});

describe("renderJournalTemplate 统一入口", () => {
  it("daily 等价 dailyTemplate", () => {
    expect(renderJournalTemplate("daily", dayjs("2026-07-01"))).toBe(
      dailyTemplate(dayjs("2026-07-01"))
    );
  });

  it("review 传 reviewType", () => {
    const md = renderJournalTemplate("review", dayjs("2026-07-01"), {
      reviewType: "年度",
    });
    expect(md).toContain('review_type: "年度"');
  });
});
