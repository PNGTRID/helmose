// taskLine.ts 单测（vitest）：parseDesc 描述解析 + rebuildTaskLine 行重组
import { describe, it, expect, beforeAll } from "vitest";
import { parseDesc, rebuildTaskLine } from "./taskLine";
import type { Task } from "../types";
import { useMarkingStyleStore } from "../stores/markingStyle";

const baseTask: Task = {
  id: "t1",
  note_id: "n1",
  vault_id: "v1",
  text: "写周报",
  done: false,
  due_date: null,
  source: "checkbox",
  source_line: 3,
  project_id: null,
  created_at: "",
  completed_at: null,
  status: "todo",
  priority: 0,
  urgency: "", // 未设（无标记，三态默认；rebuildTaskLine 不落 urgency 标记）
  repeat_rule: null,
  parent_task_id: null,
};

describe("parseDesc", () => {
  it("任务行下缩进纯文本 = 描述", () => {
    const md = "## 今日待办\n- [ ] 任务\n  这是描述\n";
    // sourceLine=2（1-based）→ lines[2] 是「  这是描述」
    expect(parseDesc(md, 2)).toEqual({ text: "这是描述", lineNo: 3 });
  });

  it("跳过子任务 bullet 找到描述", () => {
    const md = "- [ ] 任务\n  - [ ] 子任务\n  描述在子后\n";
    expect(parseDesc(md, 1)).toEqual({ text: "描述在子后", lineNo: 3 });
  });

  it("非缩进顶层行 → 任务块结束，无描述", () => {
    const md = "- [ ] 任务\n## 其他章节\n  不该被扫到\n";
    expect(parseDesc(md, 1)).toBeNull();
  });

  it("任务行后 EOF / 全空行 → 无描述", () => {
    expect(parseDesc("- [ ] 任务\n", 1)).toBeNull();
    expect(parseDesc("- [ ] 任务\n\n\n", 1)).toBeNull();
  });

  it("跳过空行继续扫描", () => {
    const md = "- [ ] 任务\n\n  空行后的描述\n";
    expect(parseDesc(md, 1)).toEqual({ text: "空行后的描述", lineNo: 3 });
  });
});

describe("rebuildTaskLine", () => {
  beforeAll(() => {
    // 锁定 helmose 文字契约，避免全局 store 在其他测试中被改而漂移
    useMarkingStyleStore.setState({ style: "helmose" });
  });

  it("override dueDate 清空（'' / null）", () => {
    const t = { ...baseTask, due_date: "2026-07-01" };
    expect(rebuildTaskLine(t, { dueDate: "" }, null)).toBe("- [ ] 写周报");
    expect(rebuildTaskLine(t, { dueDate: null }, null)).toBe("- [ ] 写周报");
  });

  it("override text + dueDate", () => {
    expect(rebuildTaskLine(baseTask, { text: "改标题", dueDate: "2026-07-02" }, null)).toBe(
      "- [ ] 改标题 due:2026-07-02"
    );
  });

  it("override repeatRule", () => {
    expect(rebuildTaskLine(baseTask, { repeatRule: "week" }, null)).toBe(
      "- [ ] 写周报 repeat:week"
    );
  });

  it("override projectName", () => {
    expect(rebuildTaskLine(baseTask, { projectName: "Helmose" }, null)).toBe(
      "- [ ] 写周报 #project:Helmose"
    );
    expect(rebuildTaskLine(baseTask, { projectName: null }, "旧项目")).toBe("- [ ] 写周报");
  });

  it("保留原 priority/urgency/status", () => {
    const t = { ...baseTask, priority: 3, urgency: "high", status: "doing" };
    expect(rebuildTaskLine(t, {}, null)).toBe("- [/] 写周报 priority:3 urgency:high");
  });

  it("不传 override → 按原字段重组", () => {
    const t = { ...baseTask, due_date: "2026-07-01", priority: 2 };
    expect(rebuildTaskLine(t, {}, null)).toBe("- [ ] 写周报 due:2026-07-01 priority:2");
  });
});
