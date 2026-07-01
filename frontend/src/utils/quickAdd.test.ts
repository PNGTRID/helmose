// quickAdd.ts 单测（vitest）：bullet 拼装 + frontmatter + slugify
import { describe, it, expect } from "vitest";
import dayjs from "dayjs";
import {
  buildTaskBullet,
  buildEventBullet,
  buildProjectFrontmatter,
  priorityToValue,
  slugify,
} from "./quickAdd";

describe("buildTaskBullet", () => {
  it("仅文本：单行 [ ] 任务", () => {
    expect(buildTaskBullet("写周报")).toBe("- [ ] 写周报");
  });

  it("带 dayjs dueDate：追加 📅 YYYY-MM-DD", () => {
    const d = dayjs("2026-07-01");
    expect(buildTaskBullet("写周报", d)).toBe("- [ ] 写周报 📅 2026-07-01");
  });

  it("带字符串 dueDate", () => {
    expect(buildTaskBullet("写周报", "2026-07-01")).toBe("- [ ] 写周报 📅 2026-07-01");
  });

  it("带 high urgency：追加 🔥", () => {
    expect(buildTaskBullet("急活", null, "high")).toBe("- [ ] 急活 🔥");
  });

  it("带 mid/low urgency：不追加 emoji", () => {
    expect(buildTaskBullet("普通", null, "mid")).toBe("- [ ] 普通");
    expect(buildTaskBullet("普通", null, "low")).toBe("- [ ] 普通");
  });

  it("带 projectName：追加 #project:{name}", () => {
    expect(buildTaskBullet("任务", null, null, "Helmose")).toBe(
      "- [ ] 任务 #project:Helmose"
    );
  });

  it("全参数组合：📅 + 🔥 + #project", () => {
    expect(buildTaskBullet("v0.2 上线", "2026-07-01", "high", "Helmose")).toBe(
      "- [ ] v0.2 上线 📅 2026-07-01 🔥 #project:Helmose"
    );
  });

  it("projectName 空字符串不追加标签", () => {
    expect(buildTaskBullet("任务", null, null, "  ")).toBe("- [ ] 任务");
  });
});

describe("buildEventBullet", () => {
  it("仅开始时间：- HH:MM title", () => {
    expect(buildEventBullet("早会", "09:00")).toBe("- 09:00 早会");
  });

  it("dayjs 时间参数", () => {
    const s = dayjs("2026-07-01 09:30");
    expect(buildEventBullet("早会", s)).toBe("- 09:30 早会");
  });

  it("时间段：- HH:MM-HH:MM title", () => {
    expect(buildEventBullet("周会", "09:00", "10:00")).toBe("- 09:00-10:00 周会");
  });

  it("带备注：- time title（note）", () => {
    expect(buildEventBullet("周会", "09:00", "10:00", "讨论 v0.2")).toBe(
      "- 09:00-10:00 周会（讨论 v0.2）"
    );
  });

  it("空白备注不追加括号", () => {
    expect(buildEventBullet("周会", "09:00", "10:00", "  ")).toBe(
      "- 09:00-10:00 周会"
    );
  });
});

describe("priorityToValue", () => {
  it("P0=200", () => expect(priorityToValue("P0")).toBe(200));
  it("P1=150", () => expect(priorityToValue("P1")).toBe(150));
  it("P2=100", () => expect(priorityToValue("P2")).toBe(100));
  it("P3=50", () => expect(priorityToValue("P3")).toBe(50));
  it("null/undefined → null", () => {
    expect(priorityToValue(null)).toBeNull();
    expect(priorityToValue(undefined)).toBeNull();
  });
});

describe("buildProjectFrontmatter", () => {
  it("含 type:project（indexer projects.rs 识别契约）", () => {
    const md = buildProjectFrontmatter("Helmose", "active", "P1", false, null, null, "");
    expect(md).toContain("type: project");
    expect(md).toContain("project-status:active");
  });

  it("priority 映射 200/150/100/50", () => {
    expect(buildProjectFrontmatter("A", "active", "P0", false, null)).toContain("priority: 200");
    expect(buildProjectFrontmatter("A", "active", "P3", false, null)).toContain("priority: 50");
  });

  it("mainline=true：frontmatter + tag 双写", () => {
    const md = buildProjectFrontmatter("A", "active", null, true, null);
    expect(md).toContain("mainline: true");
    expect(md).toContain("- mainline");
  });

  it("okr 写入 frontmatter（JSON 字符串）", () => {
    expect(buildProjectFrontmatter("A", "active", null, false, "Q2 目标")).toContain(
      'okr: "Q2 目标"'
    );
  });

  it("owner 写入 frontmatter（JSON 字符串）", () => {
    expect(buildProjectFrontmatter("A", "active", null, false, null, "张三")).toContain(
      'owner: "张三"'
    );
  });

  it("默认 body：# {name}", () => {
    const md = buildProjectFrontmatter("Test", "active", null, false, null);
    expect(md.endsWith("# Test\n")).toBe(true);
  });

  it("自定义 body 拼接", () => {
    const md = buildProjectFrontmatter("A", "active", null, false, null, null, "## 行动\n");
    expect(md).toContain("## 行动");
  });

  it("title 用 JSON 字符串转义（项目名含冒号/特殊字符不破坏 YAML）", () => {
    const md = buildProjectFrontmatter("v0.2: 出海", "active", null, false, null);
    expect(md).toContain('title: "v0.2: 出海"');
  });

  it("title 含换行被转义（防 YAML 折叠破坏）", () => {
    const md = buildProjectFrontmatter("a\nb", "active", null, false, null);
    // JSON.stringify 把 \n 转义为字面 \n 两字符
    expect(md).toContain('title: "a\\nb"');
  });
});

describe("slugify", () => {
  it("空格 → 下划线", () => {
    expect(slugify("Helmose v0.2 规划")).toBe("Helmose_v0.2_规划");
  });

  it("非法字符（\\/:*?\"<>|）→ 下划线", () => {
    expect(slugify('a/b:c*d?e"f<g>h|i')).toBe("a_b_c_d_e_f_g_h_i");
  });

  it("首尾空格 + 首尾下划线去除", () => {
    expect(slugify("  hello  ")).toBe("hello");
    expect(slugify("__abc__")).toBe("abc");
  });

  it("中文保留（不 transliterate）", () => {
    expect(slugify("舵手计划")).toBe("舵手计划");
  });
});
