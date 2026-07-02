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
import { useMarkingStyleStore } from "../stores/markingStyle";

describe("buildTaskBullet", () => {
  // —— helmose 文字标准（默认，独立自建定位）——

  it("仅文本：单行 [ ] 任务", () => {
    expect(buildTaskBullet({ text: "写周报" })).toBe("- [ ] 写周报");
  });

  it("helmose 模式：due: 文字标记", () => {
    const d = dayjs("2026-07-01");
    expect(buildTaskBullet({ text: "写周报", dueDate: d })).toBe("- [ ] 写周报 due:2026-07-01");
    expect(buildTaskBullet({ text: "写周报", dueDate: "2026-07-01" })).toBe("- [ ] 写周报 due:2026-07-01");
  });

  it("helmose 模式：urgency:high 文字", () => {
    expect(buildTaskBullet({ text: "急活", urgency: "high" })).toBe("- [ ] 急活 urgency:high");
  });

  it("mid/未设 不追加标记（派生）；low 显式追加 urgency:low（三态 Blocker #1 方案 B）", () => {
    expect(buildTaskBullet({ text: "普通", urgency: "mid" })).toBe("- [ ] 普通"); // mid 仅派生，不入 bullet
    expect(buildTaskBullet({ text: "普通", urgency: "" })).toBe("- [ ] 普通"); // 未设，不入 bullet
    expect(buildTaskBullet({ text: "普通", urgency: "low" })).toBe("- [ ] 普通 urgency:low"); // 显式不紧急
  });

  it("helmose 模式：priority:N 文字（3=最高）", () => {
    expect(buildTaskBullet({ text: "重要", priority: 3 })).toBe("- [ ] 重要 priority:3");
    expect(buildTaskBullet({ text: "中", priority: 1 })).toBe("- [ ] 中 priority:1");
  });

  it("helmose 模式：repeat:X 文字", () => {
    expect(buildTaskBullet({ text: "周报", repeatRule: "week" })).toBe("- [ ] 周报 repeat:week");
  });

  it("带 projectName：追加 #project:{name}", () => {
    expect(buildTaskBullet({ text: "任务", projectName: "Helmose" })).toBe(
      "- [ ] 任务 #project:Helmose"
    );
  });

  it("helmose 全参数组合：due: + priority: + urgency: + #project", () => {
    expect(
      buildTaskBullet({ text: "v0.2 上线", dueDate: "2026-07-01", urgency: "high", projectName: "Helmose", priority: 3 })
    ).toBe("- [ ] v0.2 上线 due:2026-07-01 priority:3 urgency:high #project:Helmose");
  });

  it("projectName 空字符串不追加标签", () => {
    expect(buildTaskBullet({ text: "任务", projectName: "  " })).toBe("- [ ] 任务");
  });

  // —— obsidian 兼容模式（对齐 Obsidian Tasks 插件 emoji 标准）——

  it("obsidian 模式：📅 due + 🔁 repeat + ⏫ priority + 🔥 urgency + #project", () => {
    expect(
      buildTaskBullet({ text: "v0.2 上线", dueDate: "2026-07-01", urgency: "high", projectName: "Helmose", priority: 3, status: "todo", repeatRule: "week", markingStyle: "obsidian" })
    ).toBe("- [ ] v0.2 上线 📅 2026-07-01 🔁 every week ⏫ 🔥 #project:Helmose");
  });

  it("obsidian 模式 priority：3/2/1 → ⏫/🔼/🔽", () => {
    expect(buildTaskBullet({ text: "a", priority: 3, markingStyle: "obsidian" })).toBe("- [ ] a ⏫");
    expect(buildTaskBullet({ text: "a", priority: 2, markingStyle: "obsidian" })).toBe("- [ ] a 🔼");
    expect(buildTaskBullet({ text: "a", priority: 1, markingStyle: "obsidian" })).toBe("- [ ] a 🔽");
  });

  // —— 边界 + 全局 store 联动（前端 H5 回归）——

  it("priority 越界 clamp 到 3（负数/0 不加标记）", () => {
    expect(buildTaskBullet({ text: "a", priority: 99 })).toBe("- [ ] a priority:3");
    expect(buildTaskBullet({ text: "a", priority: -1 })).toBe("- [ ] a");
    expect(buildTaskBullet({ text: "a", priority: 0 })).toBe("- [ ] a");
  });

  it("repeatRule 不在白名单 → 忽略（防脏值污染 bullet）", () => {
    expect(buildTaskBullet({ text: "a", repeatRule: "weekday" })).toBe("- [ ] a");
    expect(buildTaskBullet({ text: "a", repeatRule: "" })).toBe("- [ ] a");
  });

  it("status done/doing 前缀正确", () => {
    expect(buildTaskBullet({ text: "a", status: "done" })).toBe("- [x] a");
    expect(buildTaskBullet({ text: "a", status: "doing" })).toBe("- [/] a");
  });

  it("markingStyle 参数显式传入 → 覆盖全局 store", () => {
    useMarkingStyleStore.setState({ style: "helmose" });
    expect(buildTaskBullet({ text: "a", priority: 3, markingStyle: "obsidian" })).toBe("- [ ] a ⏫");
  });

  it("不传 markingStyle → 读全局 store", () => {
    const prev = useMarkingStyleStore.getState().style;
    useMarkingStyleStore.setState({ style: "obsidian" });
    try {
      expect(buildTaskBullet({ text: "a", priority: 3 })).toBe("- [ ] a ⏫");
    } finally {
      useMarkingStyleStore.setState({ style: prev });
    }
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
