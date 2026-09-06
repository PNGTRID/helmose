// taskGrouping 纯函数单测：分组维度 / 象限归属 / 紧急度派生。
// 锁定业务规则（逾期判定、象限阈值、🔥 覆盖），避免阈值改动无回归保护。
import { describe, it, expect } from "vitest";
import {
  groupTasksByDue,
  groupTasksByStatus,
  groupTasksByPriority,
  groupTasksByProject,
  classifyQuadrant,
  computeUrgencyMap,
} from "./taskGrouping";
import type { Task, NoteMeta } from "../types";

/** 构造 Task（默认 todo / priority 0 / 无 due） */
function mkTask(partial: Partial<Task> & { id: string }): Task {
  return {
    id: partial.id,
    note_id: partial.note_id ?? "n1",
    vault_id: partial.vault_id ?? "v1",
    text: partial.text ?? "t",
    done: partial.done ?? false,
    due_date: partial.due_date ?? null,
    source: partial.source ?? "checkbox",
    source_line: partial.source_line ?? 1,
    project_id: partial.project_id ?? null,
    created_at: partial.created_at ?? "2026-01-01",
    completed_at: partial.completed_at ?? null,
    status: partial.status ?? "todo",
    priority: partial.priority ?? 0,
    urgency: partial.urgency ?? "", // 默认未设（无标记，前端 due_date 派生；三态 Blocker #1 方案 B）
    repeat_rule: partial.repeat_rule ?? null,
    parent_task_id: partial.parent_task_id ?? null,
  };
}

function todayIso(): string {
  const t = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

describe("groupTasksByDue", () => {
  it("逾期/今天/本周/之后/无日期 各自分桶", () => {
    const tasks = [
      mkTask({ id: "1", due_date: "2020-01-01" }), // 逾期
      mkTask({ id: "2", due_date: todayIso() }), // 今天
      mkTask({ id: "3", due_date: "2099-12-31" }), // 之后
      mkTask({ id: "4" }), // 无日期
    ];
    const groups = groupTasksByDue(tasks);
    const labels = groups.map((g) => g.label);
    expect(labels.some((l) => l.startsWith("逾期"))).toBe(true);
    expect(labels.some((l) => l.startsWith("今天"))).toBe(true);
    expect(labels.some((l) => l.startsWith("之后"))).toBe(true);
    expect(labels.some((l) => l.startsWith("无到期日"))).toBe(true);
  });

  it("无效 due_date 归入无日期", () => {
    const groups = groupTasksByDue([mkTask({ id: "x", due_date: "not-a-date" })]);
    expect(groups[0].label.startsWith("无到期日")).toBe(true);
  });
});

describe("groupTasksByStatus", () => {
  it("待办/进行中/已完成 三桶", () => {
    const groups = groupTasksByStatus([
      mkTask({ id: "1", status: "todo" }),
      mkTask({ id: "2", status: "doing" }),
      mkTask({ id: "3", status: "done" }),
      // 旧字段 done=true（无 status='done'）也应归已完成
      mkTask({ id: "4", status: "todo", done: true }),
    ]);
    const byLabel = new Map(groups.map((g) => [g.label, g.items.length]));
    expect(byLabel.get("待办（1）")).toBe(1);
    expect(byLabel.get("进行中（1）")).toBe(1);
    expect(byLabel.get("已完成（2）")).toBe(2); // status=done + done=true
  });
});

describe("groupTasksByPriority", () => {
  it("P1/P2/P3/未设 按 priority 阈值分桶", () => {
    const groups = groupTasksByPriority([
      mkTask({ id: "1", priority: 3 }), // P1
      mkTask({ id: "2", priority: 4 }), // P1（>=3）
      mkTask({ id: "3", priority: 2 }), // P2
      mkTask({ id: "4", priority: 1 }), // P3
      mkTask({ id: "5", priority: 0 }), // 未设
    ]);
    const byLabel = new Map(groups.map((g) => [g.label, g.items.length]));
    expect(byLabel.get("P1（2）")).toBe(2);
    expect(byLabel.get("P2（1）")).toBe(1);
    expect(byLabel.get("P3（1）")).toBe(1);
    expect(byLabel.get("未设优先级（1）")).toBe(1);
  });
});

describe("groupTasksByProject", () => {
  it("project_id null 归未关联，其余按 id 聚合（file_name 兜底）", () => {
    const noteById = new Map<string, NoteMeta>([
      ["n1", { id: "n1", file_name: "项目A.md" } as NoteMeta],
    ]);
    const groups = groupTasksByProject(
      [
        mkTask({ id: "1", project_id: "p1", note_id: "n1" }),
        mkTask({ id: "2", project_id: "p1", note_id: "n1" }),
        mkTask({ id: "3", project_id: null }),
      ],
      noteById
    );
    const none = groups.find((g) => g.label.startsWith("未关联"));
    const named = groups.find((g) => g.label.startsWith("项目A"));
    expect(none?.items.length).toBe(1);
    expect(named?.items.length).toBe(2);
  });
});

describe("classifyQuadrant", () => {
  it("priority>=2 为重要，urgency high 为紧急 → 四象限", () => {
    const important = mkTask({ id: "1", priority: 2 });
    const notImportant = mkTask({ id: "2", priority: 1 });
    expect(classifyQuadrant(important, "high")).toBe("q1");
    expect(classifyQuadrant(important, "mid")).toBe("q2");
    expect(classifyQuadrant(notImportant, "high")).toBe("q3");
    expect(classifyQuadrant(notImportant, "low")).toBe("q4");
  });

  it("priority 阈值边界：1 不重要，2 重要", () => {
    expect(classifyQuadrant(mkTask({ id: "x", priority: 1 }), "low")).toBe("q4");
    expect(classifyQuadrant(mkTask({ id: "x", priority: 2 }), "low")).toBe("q2");
  });
});

describe("computeUrgencyMap", () => {
  it("手动 🔥 (urgency=high) 覆盖 due_date 推导", () => {
    const m = computeUrgencyMap([
      mkTask({ id: "1", urgency: "high", due_date: "2099-12-31" }), // 手动 high，即使 due 很远也 high
    ]);
    expect(m.get("1")).toBe("high");
  });

  it("无手动 🔥：逾期/今天=high，本周=mid，之后/无=low", () => {
    const future = new Date(Date.now() + 3 * 86400000); // 3 天后（本周内）
    const pad = (n: number) => String(n).padStart(2, "0");
    const futureIso = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}`;
    const m = computeUrgencyMap([
      mkTask({ id: "1", due_date: "2020-01-01" }), // 逾期 → high
      mkTask({ id: "2", due_date: todayIso() }), // 今天 → high
      mkTask({ id: "3", due_date: futureIso }), // 本周 → mid
      mkTask({ id: "4", due_date: "2099-12-31" }), // 之后 → low
      mkTask({ id: "5" }), // 无 → low
    ]);
    expect(m.get("1")).toBe("high");
    expect(m.get("2")).toBe("high");
    expect(m.get("3")).toBe("mid");
    expect(m.get("4")).toBe("low");
    expect(m.get("5")).toBe("low");
  });

  it("三态：显式 low 压制 due_date 派生 high（Blocker #1 方案 B 根治）", () => {
    const m = computeUrgencyMap([
      mkTask({ id: "1", urgency: "low", due_date: "2020-01-01" }), // 显式 low + 逾期 → low（压制）
      mkTask({ id: "2", urgency: "low", due_date: todayIso() }), // 显式 low + 今天 → low（关键修复点）
      mkTask({ id: "3", urgency: "", due_date: todayIso() }), // 未设 + 今天 → high（派生）
      mkTask({ id: "4", urgency: "high", due_date: "2099-12-31" }), // 显式 high + 远期 → high（强制）
    ]);
    expect(m.get("1")).toBe("low");
    expect(m.get("2")).toBe("low"); // 修前派生 high 拖不进 q4；修后显式 low 压制，留在「不紧急」象限
    expect(m.get("3")).toBe("high");
    expect(m.get("4")).toBe("high");
  });
});
