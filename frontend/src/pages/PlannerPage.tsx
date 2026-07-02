// 今日计划页：三栏（收集箱/分类/迷你日历 + 四象限+输入条 + 详情面板）。
// 视觉/交互照搬项目根 task-planner-preview.html，用 antd + 现有数据层重写。
//
// 选中锚点（关键）：vault 写回会使 note content_hash 变 → note_id / task_id 漂移，
// 但 vault 文件路径 + 行号 + 子任务归属稳定。故用 (relPath, sourceLine) 锚点驱动选中：
//   selected = tasks 里按锚点 resolve 的当前 task。id 漂移时自动跟上，详情面板永不卸载
//   （输入框焦点不丢、添加子计划无闪烁）。
//
// 四象限只显示顶层 checkbox 任务（parent_task_id == null && source_line != null）：
//   子任务只在父任务详情的「子计划」列表显示，父任务作为「合集」停在象限。
//
// 数据复用（无新增 schema；仅后端 insert_line_after 一条行级插入命令）：
//   · getTasks（未完成，limit 500）+ useAllNotesMeta + useActiveProjects
//   · 勾选 toggleTask / 象限 set_task_priority+set_task_urgency / 标题·期限·重复·项目 updateLine 重组
//   · 创建 createTodayNote + buildTaskBullet + appendBullet
//   · 子计划新增 insertLineAfter / 子计划·描述删除 deleteLine / 描述改 updateLine
//
// 分类（cat 软方案）：stores/plannerCategories，自定义分类 + 项目/文件夹/tag 映射，存 localStorage。
// 描述：Obsidian Tasks 缩进行惯例（任务行下方缩进纯文本），indexer 不提取，不污染 task.text。
//
// 图标统一走 AppIcon（@ant-design/icons），UI 禁用 emoji；vault bullet 内的 emoji 标记是解析契约，不在本页管辖。

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, App, Dropdown, Modal, Popconfirm } from "antd";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import dayjs from "dayjs";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useAllNotesMeta } from "../hooks/useAllNotesMeta";
import { useActiveProjects } from "../hooks/useActiveProjects";
import {
  usePlannerCategoryStore,
  classifyTask,
  SYS_ALL,
  SYS_INBOX,
  type PlannerCategory,
} from "../stores/plannerCategories";
import { genId } from "../utils/id";
import { parseDesc, rebuildTaskLine } from "../utils/taskLine";
import { buildTaskBullet } from "../utils/quickAdd";
import { classifyQuadrant, computeUrgencyMap, effectiveUrgency, type Quadrant } from "../utils/taskGrouping";
import type { NoteMeta, Project, Task } from "../types";
import AppIcon from "../components/AppIcon";
import CategoryModal from "../components/CategoryModal";
import "./PlannerPage.css";

// ============================================================
// 四象限定义（参考图配色 + 图标 + 装饰图，照搬预览）
// ============================================================
interface QuadDef {
  key: Quadrant;
  name: string;
  icon: string; // AppIcon registry name（象限主图标）
  sub: string;
  tip: string;
  decorIcon: string; // AppIcon registry name（右下大号装饰）
  cls: string; // CSS 类名后缀（q1/q2/q3/q4）
}
const QUADS: Record<Quadrant, QuadDef> = {
  q1: { key: "q1", name: "重要且紧急", icon: "fire", sub: "立即做", tip: "立即做", decorIcon: "fire", cls: "q1" },
  q2: { key: "q2", name: "重要不紧急", icon: "bulb", sub: "规划后再做", tip: "计划做", decorIcon: "compass", cls: "q2" },
  q3: { key: "q3", name: "紧急不重要", icon: "thunder", sub: "快做", tip: "快做", decorIcon: "clock", cls: "q3" },
  q4: { key: "q4", name: "不重要不紧急", icon: "coffee", sub: "有空再做", tip: "有空做", decorIcon: "coffee", cls: "q4" },
};
// 参考图网格位置：左上 q3 / 右上 q1 / 左下 q4 / 右下 q2
const QUAD_ORDER: Quadrant[] = ["q3", "q1", "q4", "q2"];

const REPEAT_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "", label: "不重复" },
  { key: "day", label: "每天" },
  { key: "week", label: "每周" },
  { key: "month", label: "每月" },
];

const todayStr = () => dayjs().format("YYYY-MM-DD");
const tomorrowStr = () => dayjs().add(1, "day").format("YYYY-MM-DD");

// parseDesc / rebuildTaskLine 已抽到 utils/taskLine.ts（纯函数可单测）。

/** 选中锚点：vault 文件路径 + 1-based 去fm正文行号。两者跨写回稳定（id 漂移不影响）。 */
interface SelectAnchor {
  relPath: string;
  sourceLine: number;
}

export default function PlannerPage() {
  const { message: msg } = App.useApp();
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const { notes } = useAllNotesMeta();
  const { projects } = useActiveProjects();

  const categories = usePlannerCategoryStore((s) => s.categories);
  const activeCat = usePlannerCategoryStore((s) => s.activeCat);
  const setActiveCat = usePlannerCategoryStore((s) => s.setActiveCat);
  const removeCategory = usePlannerCategoryStore((s) => s.removeCategory);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedAnchor, setSelectedAnchor] = useState<SelectAnchor | null>(null);
  // 响应式：监听 PlannerPage 自身宽度（= ob-content 宽，已扣 Ribbon/FilePanel），而非 window.innerWidth——
  // 后者会误判（FilePanel 占一大块，窗口够大但页面实际很窄，三栏挤没四象限）。
  // 三栏固定占 250+320+gap+padding ≈ 660，中栏四象限 2×2 至少 ~400 → 自身宽度 < 1000 切两栏 + 详情弹窗。
  const [isNarrow, setIsNarrow] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setIsNarrow(entries[0].contentRect.width < 1000);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [viewMonth, setViewMonth] = useState(() => dayjs());
  const [quickText, setQuickText] = useState("");
  // 输入条挂起的日期（日期选择器 / 迷你日历点日期预填），回车提交时带上
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<PlannerCategory | null>(null); // CategoryModal 编辑目标（null=新建）
  const [writing, setWriting] = useState(false);
  const [loadError, setLoadError] = useState(false); // 首次加载失败标志（错误三态，High #8）
  const hasLoadedOnce = useRef(false); // 区分首次加载 vs 后续静默刷新

  const noteById = useMemo(() => {
    const m = new Map<string, NoteMeta>();
    for (const n of notes) m.set(n.id, n);
    return m;
  }, [notes]);

  const projectById = useMemo(() => {
    const m = new Map<string, Project>();
    for (const p of projects) m.set(p.id, p);
    return m;
  }, [projects]);

  // 顶层任务（parent_task_id == null）：四象限/收集箱/分类计数只看这些；
  // 子任务只在父任务详情的子计划列表。聚合 section 任务（source_line=null）与乐观临时任务也在此，
  // 卡片对 source_line=null 不显勾选框/不可拖（PlannerTaskCard 内已守卫）。
  const topLevelTasks = useMemo(
    () => tasks.filter((t) => t.parent_task_id == null),
    [tasks]
  );

  // 任务 → 分类 id（自定义 or 收集箱）。子任务也归类（用于父详情内展示，但不进象限计数）
  const taskCat = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) {
      m.set(t.id, classifyTask(t, categories, noteById));
    }
    return m;
  }, [tasks, categories, noteById]);

  const urgencyMap = useMemo(() => computeUrgencyMap(tasks), [tasks]);

  // 每个顶层任务的子计划数（任务卡显示「合集」标记 + 子计划数）
  const childCountByTask = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) {
      if (t.parent_task_id != null) {
        m.set(t.parent_task_id, (m.get(t.parent_task_id) ?? 0) + 1);
      }
    }
    return m;
  }, [tasks]);

  // 有任务的日期集合（迷你日历打点；顶层 + 子任务都算）
  const dueDateSet = useMemo(() => {
    const s = new Set<string>();
    for (const t of tasks) if (t.due_date) s.add(t.due_date);
    return s;
  }, [tasks]);

  const refresh = async () => {
    if (!vault) return;
    // 静默刷新：不 setLoading（避免四象限 Spin 闪现造成跳动）。真空态由「暂无任务」兜底。
    try {
      const data = await api.getTasks(vault.id, false, 500);
      setTasks(data);
      setLoadError(false);
    } catch (e) {
      setTasks([]);
      console.error("[PlannerPage] 加载任务失败", e);
      // 首次加载失败 → 显示错误占位（区分「加载失败」与「真空」，High #8）；后续静默刷新失败不重复打扰
      if (!hasLoadedOnce.current) setLoadError(true);
    } finally {
      hasLoadedOnce.current = true;
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, watcherTick]);

  // 选中任务 = 按锚点在最新 tasks 里 resolve（id 漂移自动跟上，无空态间隙）
  const selected = useMemo(() => {
    if (!selectedAnchor) return null;
    const note = notes.find((n) => n.rel_path === selectedAnchor.relPath);
    if (!note) return null;
    return (
      tasks.find(
        (t) => t.note_id === note.id && t.source_line === selectedAnchor.sourceLine
      ) ?? null
    );
  }, [selectedAnchor, tasks, notes]);

  // 跨月选中态：选中任务后迷你日历自动翻到该任务 due_date 所在月（修跨月看不到高亮）
  useEffect(() => {
    if (selected?.due_date) setViewMonth(dayjs(selected.due_date));
  }, [selected?.due_date]);

  // 收集箱计数（只算顶层任务）
  const inboxCount = useMemo(
    () => topLevelTasks.filter((t) => taskCat.get(t.id) === SYS_INBOX).length,
    [topLevelTasks, taskCat]
  );

  // —— 写回：全部乐观更新（本地 setTasks 立即生效）+ 不手动 await refresh。
  //    vault 文件变 → watcher 增量索引 → watcherTick 变 → refresh 自动拉真数据兜底/替换临时。
  //    失败时 refresh 回滚（拿真数据覆盖乐观）。操作瞬间不再 await 全量 IPC，不卡。
  const onToggle = async (t: Task, done: boolean) => {
    if (t.source_line == null || writing) return;
    const newStatus = done ? "done" : "todo";
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, done, status: newStatus } : x)));
    setWriting(true);
    try {
      await api.toggleTask(t.note_id, t.source_line, done);
    } catch (e) {
      msg.error(`勾选失败：${e}`);
      refresh();
    } finally {
      setWriting(false);
    }
  };

  // 象限拖拽 / 属性行改象限（三态写回，Blocker #1 方案 B 根治：manual low 可压制派生 high）
  const onQuadChange = async (t: Task, target: Quadrant) => {
    if (t.source_line == null || writing) return;
    const newPriority = target === "q1" || target === "q2" ? 2 : 1;
    const targetUrgency: "high" | "low" = target === "q1" || target === "q3" ? "high" : "low";
    // 三态后 urgency 字段与 effective 同口径：乐观同时覆盖 priority + urgency 不打架，象限立即正确无闪烁。
    // watcher refresh 仍为最终真值来源。
    setTasks((prev) =>
      prev.map((x) =>
        x.id === t.id ? { ...x, priority: newPriority, urgency: targetUrgency } : x
      )
    );
    setWriting(true);
    try {
      if (t.priority !== newPriority) {
        await api.setTaskPriority(t.note_id, t.source_line, newPriority);
      }
      // 三态写回：拖紧急象限且当前非 high → 写 high；拖不紧急象限且当前非 low → 写 low。
      // 关键修复：派生 high（今天到期未标记）拖入 q4 时 eff!=="low" 成立 → 写 urgency:low 压制，refresh 后留在 q4 不再跳回。
      const eff = urgencyMap.get(t.id) ?? "low";
      if (targetUrgency === "high" && eff !== "high") {
        await api.setTaskUrgency(t.note_id, t.source_line, "high");
      } else if (targetUrgency === "low" && eff !== "low") {
        await api.setTaskUrgency(t.note_id, t.source_line, "low");
      }
      msg.success(`已移到「${QUADS[target].name}」`);
    } catch (e) {
      msg.error(`改优先级失败：${e}`);
      refresh();
    } finally {
      setWriting(false);
    }
  };

  // 重组写回（标题/期限/重复/项目）—— updateLine 整行重写
  // 乐观改简单字段（text/due/repeat）；project 改归类因 project_id 反查复杂，留给 watcher 刷新。
  const onRebuild = async (
    t: Task,
    overrides: {
      text?: string;
      dueDate?: string | null;
      repeatRule?: string | null;
      projectName?: string | null;
    }
  ) => {
    if (t.source_line == null || writing) return;
    const currentName = t.project_id ? projectById.get(t.project_id)?.name ?? null : null;
    const line = rebuildTaskLine(t, overrides, currentName);
    setTasks((prev) =>
      prev.map((x) => {
        if (x.id !== t.id) return x;
        return {
          ...x,
          text: overrides.text ?? x.text,
          due_date:
            overrides.dueDate !== undefined ? overrides.dueDate || null : x.due_date,
          repeat_rule:
            overrides.repeatRule !== undefined ? overrides.repeatRule || null : x.repeat_rule,
        };
      })
    );
    setWriting(true);
    try {
      await api.updateLine(t.note_id, t.source_line, line);
    } catch (e) {
      msg.error(`保存失败：${e}`);
      refresh();
    } finally {
      setWriting(false);
    }
  };

  // 描述编辑（newDesc 空=删；非空=update 或 insert）。描述不进 tasks 表，无需 refresh tasks。
  // 描述行号变化由 watcher refresh → selected.id 变 → 详情面板描述 useEffect 重解析兜底。
  const onDescChange = async (t: Task, newDesc: string, descLineNo: number | null) => {
    if (t.source_line == null || writing) return;
    setWriting(true);
    try {
      const trimmed = newDesc.trim();
      if (!trimmed) {
        if (descLineNo != null) await api.deleteLine(t.note_id, descLineNo);
      } else {
        const line = "  " + trimmed;
        if (descLineNo != null) await api.updateLine(t.note_id, descLineNo, line);
        else await api.insertLineAfter(t.note_id, t.source_line, line);
      }
    } catch (e) {
      msg.error(`描述保存失败：${e}`);
      refresh();
    } finally {
      setWriting(false);
    }
  };

  // 子计划新增（父任务/描述行后插缩进 checkbox）
  // 乐观更新：回车瞬间立即把临时子任务插入本地（不阻塞、不闪），不手动 refresh——
  // vault 文件变 → watcher 增量索引 → watcherTick 变 → refresh 自动拉真数据替换临时。
  // 返回是否成功（失败回滚临时，调用方据此决定清空输入）。
  const onAddChild = async (
    t: Task,
    childText: string,
    afterLine: number
  ): Promise<boolean> => {
    if (t.source_line == null || writing) return false;
    const c = childText.trim();
    if (!c) {
      msg.warning("请输入子计划内容");
      return false;
    }
    // 乐观：临时子任务（source_line=null 临时不可编辑/删，watcher 替换后变真）
    const tempId = `temp-${genId()}`;
    const tempChild: Task = {
      id: tempId,
      note_id: t.note_id,
      vault_id: t.vault_id,
      text: c,
      done: false,
      due_date: null,
      source: "checkbox",
      source_line: null,
      project_id: null,
      created_at: new Date().toISOString(),
      completed_at: null,
      status: "todo",
      priority: 0,
      urgency: "", // 未设（无标记，子任务默认不表态，由 due_date 派生）
      repeat_rule: null,
      parent_task_id: t.id,
    };
    setTasks((prev) => [...prev, tempChild]);
    setWriting(true);
    try {
      await api.insertLineAfter(t.note_id, afterLine, `  - [ ] ${c}`);
      msg.success("已添加子计划");
      return true;
    } catch (e) {
      setTasks((prev) => prev.filter((x) => x.id !== tempId)); // 写失败回滚临时
      msg.error(`添加子计划失败：${e}`);
      return false;
    } finally {
      setWriting(false);
    }
  };

  // 删除任务（deleteLine，删前已备份）。父任务删除时，其子计划（同笔记缩进行）一并跟随删除——
  // 否则 vault 里子行残留，watcher 重新索引后会以「最近非缩进父」漂移归属到别的任务。
  const onDelete = async (t: Task) => {
    if (t.source_line == null) {
      msg.warning("聚合 section 任务不支持删除");
      return;
    }
    if (writing) return;
    // 收集父 + 子的行号（同笔记），按行号降序删（先删大行号，避免删后行号漂移影响后续）
    const children = tasks.filter(
      (x) => x.parent_task_id === t.id && x.source_line != null
    );
    const lines = [...children.map((c) => c.source_line!), t.source_line].sort(
      (a, b) => b - a
    );
    // 乐观移除：父 + 子
    const removeIds = new Set([t.id, ...children.map((c) => c.id)]);
    setTasks((prev) => prev.filter((x) => !removeIds.has(x.id)));
    setSelectedAnchor(null);
    setWriting(true);
    try {
      // deleteLine 写回后 note content_hash 变 → note_id 漂移；用返回的新 id 做下一次，否则 not found。
      let curNoteId = t.note_id;
      for (const ln of lines) {
        const nc = await api.deleteLine(curNoteId, ln);
        curNoteId = nc.id;
      }
      msg.success(children.length ? `已删除（含 ${children.length} 个子计划）` : "已删除");
    } catch (e) {
      msg.error(`删除失败：${e}`);
      refresh(); // 回滚
    } finally {
      setWriting(false);
    }
  };

  // 删除子计划（独立 task 行，deleteLine 可靠）
  const onDeleteChild = async (c: Task) => {
    if (c.source_line == null || writing) return;
    setTasks((prev) => prev.filter((x) => x.id !== c.id));
    setWriting(true);
    try {
      await api.deleteLine(c.note_id, c.source_line);
    } catch (e) {
      msg.error(`删除子计划失败：${e}`);
      refresh(); // 回滚
    } finally {
      setWriting(false);
    }
  };

  // 复制任务（父 + 子任务链式复制到今日待办；顺带修 onDuplicate 双前缀 bug——appendBullet asTask=true 会加 `- [ ]`）
  const onDuplicate = async (t: Task) => {
    if (!vault || writing) return;
    const currentName = t.project_id ? projectById.get(t.project_id)?.name ?? null : null;
    // 剥行首 checkbox 前缀（rebuildTaskLine 含 `- [ ]`，appendBullet 会重新加，不剥则双前缀）
    const stripPrefix = (line: string) => line.replace(/^-\s\[[ xX/]\]\s+/, "");
    setWriting(true);
    try {
      const note = await api.createTodayNote(vault.id);
      // 父任务 → 追加到「今日待办」section 末尾
      let cur = await api.appendBullet(
        note.id,
        "今日待办",
        stripPrefix(rebuildTaskLine(t, {}, currentName)),
        true
      );
      // 从返回正文反查父任务行号（去 fm 正文 1-based，与 insertLineAfter afterLine 同口径）
      const bodyLines = cur.raw_content.split("\n");
      let parentLine = -1;
      for (let i = bodyLines.length - 1; i >= 0; i--) {
        if (bodyLines[i].includes(t.text)) {
          parentLine = i + 1;
          break;
        }
      }
      // 子任务 → 链式 insertLineAfter（带 2 空格缩进挂父下，与 onAddChild 子计划写法一致）
      const kids = tasks.filter((x) => x.parent_task_id === t.id && x.source_line != null);
      let after = parentLine;
      for (const kid of kids) {
        if (after < 0) break;
        const kidBody = stripPrefix(rebuildTaskLine(kid, {}, currentName));
        cur = await api.insertLineAfter(cur.id, after, `  - [ ] ${kidBody}`);
        after++;
      }
      msg.success(
        kids.length > 0 ? `已复制到今日待办（含 ${kids.length} 个子任务）` : "已复制到今日待办"
      );
    } catch (e) {
      msg.error(`复制失败：${e}`);
    } finally {
      setWriting(false);
    }
  };

  // 底部输入条 / 日历点日期 → 新建任务到今日笔记「今日待办」section
  // 乐观：临时顶层任务立即进 q3（默认紧急不重要：urgency=high），watcher refresh 后替换为真。
  // bullet 经 buildTaskBullet 拼装（写侧唯一源，尊重全局 markingStyle）；已含 `- [ ]` 前缀 → asTask=false 避免双前缀。
  const quickAdd = async (text: string, due: string | null) => {
    if (!vault) return;
    const t = text.trim();
    if (!t) return;
    const tempId = `temp-${genId()}`;
    const tempTask: Task = {
      id: tempId,
      note_id: "",
      vault_id: vault.id,
      text: t,
      done: false,
      due_date: due,
      source: "checkbox",
      source_line: null,
      project_id: null,
      created_at: new Date().toISOString(),
      completed_at: null,
      status: "todo",
      priority: 0,
      urgency: "high", // 默认 q3（紧急不重要）：新建带 🔥，左上象限显眼
      repeat_rule: null,
      parent_task_id: null,
    };
    setTasks((prev) => [...prev, tempTask]);
    setQuickText("");
    setPendingDate(null);
    setWriting(true);
    try {
      const nc = await api.createTodayNote(vault.id);
      // 复用 buildTaskBullet（写侧唯一拼装源；旧代码硬编码 🔥/📅 绕过它，切 obsidian 风格后输出不一致）
      const bullet = buildTaskBullet({ text: t, dueDate: due, urgency: "high" });
      await api.appendBullet(nc.id, "今日待办", bullet, false);
      msg.success(due ? `已添加（期限 ${due}）` : "已添加");
    } catch (e) {
      setTasks((prev) => prev.filter((x) => x.id !== tempId));
      msg.error(`添加失败：${e}`);
    } finally {
      setWriting(false);
    }
  };

  // 选中任务（由 task id 反查锚点）—— 仅顶层可选中（子任务不进象限，不在卡片点选）
  const onSelect = (id: string) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const path = noteById.get(t.note_id)?.rel_path;
    if (path && t.source_line != null) setSelectedAnchor({ relPath: path, sourceLine: t.source_line });
  };

  // 当前分类筛选后的顶层任务（all=全部 / inbox=收集箱 / 自定义=命中）
  const filteredTop = useMemo(() => {
    if (activeCat === SYS_ALL) return topLevelTasks;
    return topLevelTasks.filter((t) => taskCat.get(t.id) === activeCat);
  }, [topLevelTasks, activeCat, taskCat]);

  // 四象限分桶（仅顶层任务）
  const buckets = useMemo(() => {
    const out: Record<Quadrant, Task[]> = { q1: [], q2: [], q3: [], q4: [] };
    for (const t of filteredTop) {
      const eff = urgencyMap.get(t.id) ?? "low";
      out[classifyQuadrant(t, eff)].push(t);
    }
    return out;
  }, [filteredTop, urgencyMap]);

  if (!vault) return null;

  // 详情面板 JSX（宽屏右栏 / 窄屏弹窗共用，避免重复写一长串 props）
  const detailPanel = (
    <DetailPanel
      task={selected}
      categories={categories}
      taskCat={taskCat}
      childTasks={selected ? tasks.filter((t) => t.parent_task_id === selected.id) : []}
      projectName={
        selected?.project_id ? projectById.get(selected.project_id)?.name ?? null : null
      }
      projectById={projectById}
      onClose={() => setSelectedAnchor(null)}
      onToggle={onToggle}
      onQuadChange={onQuadChange}
      onRebuild={onRebuild}
      onDescChange={onDescChange}
      onAddChild={onAddChild}
      onSetProject={(name) => selected && onRebuild(selected, { projectName: name })}
      onDelete={() => selected && onDelete(selected)}
      onDeleteChild={onDeleteChild}
      onDuplicate={() => selected && onDuplicate(selected)}
    />
  );

  return (
    <div
      className="planner-page"
      ref={rootRef}
      style={isNarrow ? { gridTemplateColumns: "200px 1fr" } : undefined}
    >
      {/* ============ 左栏：收集箱 → 分类 → 迷你日历 ============ */}
      <aside className="planner-col planner-left">
        <div className="planner-inbox">
          <div className="planner-inbox-row">
            <div className="planner-inbox-title">
              <AppIcon name="inbox" size={14} /> 收集箱
            </div>
            <div className="planner-inbox-count">{inboxCount}</div>
          </div>
          <div className="planner-inbox-foot">未归类临时任务</div>
        </div>

        <div className="planner-panel">
          <div className="planner-panel-title">
            <AppIcon name="apps" size={13} /> 任务分类
          </div>
          <div className="planner-cat-list">
            <div
              className={`planner-cat-item ${activeCat === SYS_ALL ? "active" : ""}`}
              onClick={() => setActiveCat(SYS_ALL)}
            >
              <span className="planner-cat-emoji">
                <AppIcon name="apps" size={14} />
              </span>
              <span className="planner-cat-name">全部</span>
              <span className="planner-cat-count">{topLevelTasks.length}</span>
            </div>
            <div
              className={`planner-cat-item ${activeCat === SYS_INBOX ? "active" : ""}`}
              onClick={() => setActiveCat(SYS_INBOX)}
            >
              <span className="planner-cat-emoji">
                <AppIcon name="inbox" size={14} />
              </span>
              <span className="planner-cat-name">收集箱</span>
              <span className="planner-cat-count">{inboxCount}</span>
            </div>
            {categories.map((c) => {
              const count = topLevelTasks.filter((t) => taskCat.get(t.id) === c.id).length;
              return (
                <div
                  key={c.id}
                  className={`planner-cat-item ${activeCat === c.id ? "active" : ""}`}
                  onClick={() => setActiveCat(c.id)}
                >
                  <span className="planner-cat-emoji">
                    <AppIcon name={c.icon} size={14} />
                  </span>
                  <span className="planner-cat-name">{c.name}</span>
                  <span className="planner-cat-count">{count}</span>
                  <button
                    className="planner-cat-del"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingCat(c);
                      setCatModalOpen(true);
                    }}
                    title="编辑分类"
                  >
                    <AppIcon name="edit" size={10} />
                  </button>
                  <Popconfirm
                    title={`删除分类「${c.name}」？`}
                    description="任务不删除，自动落回收集箱。"
                    onConfirm={() => removeCategory(c.id)}
                    okText="删除"
                    cancelText="取消"
                  >
                    <button
                      className="planner-cat-del"
                      onClick={(e) => e.stopPropagation()}
                      title="删除分类"
                    >
                      <AppIcon name="close" size={10} />
                    </button>
                  </Popconfirm>
                </div>
              );
            })}
          </div>
          <button
            className="planner-new-cat"
            onClick={() => {
              setEditingCat(null);
              setCatModalOpen(true);
            }}
          >
            <AppIcon name="plus" size={12} /> 新建分类
          </button>
        </div>

        <MiniCalendar
          viewMonth={viewMonth}
          onPrev={() => setViewMonth(viewMonth.subtract(1, "month"))}
          onNext={() => setViewMonth(viewMonth.add(1, "month"))}
          dueDateSet={dueDateSet}
          selectedDue={selected?.due_date ?? null}
          onPickDate={(d) => setPendingDate(d)}
        />
      </aside>

      {/* ============ 中栏：四象限 + 底部输入条 ============ */}
      <section className="planner-col planner-center">
        {loadError && (
          <Alert
            type="error"
            showIcon
            message="任务加载失败"
            description="无法读取任务列表，可能是后端未就绪或 vault 异常。"
            action={
              <button className="planner-retry-btn" onClick={() => refresh()}>
                重试
              </button>
            }
            style={{ marginBottom: 8 }}
          />
        )}
        <QuadrantArea
          buckets={buckets}
          selectedId={selected?.id ?? null}
          onSelect={onSelect}
          onToggle={onToggle}
          onDragEnd={onQuadChange}
          taskCat={taskCat}
          categories={categories}
          childCountByTask={childCountByTask}
        />
        <div className="planner-quickadd">
          <button
            className="planner-qa-plus"
            onClick={() => quickAdd(quickText, pendingDate)}
            title="添加"
          >
            <AppIcon name="plus" size={14} color="#fff" />
          </button>
          <input
            className="planner-qa-input"
            placeholder={
              pendingDate
                ? `添加计划（期限 ${pendingDate}），回车保存`
                : "添加计划到「收集箱」，回车即可保存"
            }
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void quickAdd(quickText, pendingDate);
            }}
          />
          <div className="planner-qa-tools">
            <span className="planner-qa-tool" title="灵感">
              <AppIcon name="bulb" size={14} />
            </span>
            <input
              className="planner-qa-date"
              type="date"
              title="选日期"
              value={pendingDate ?? ""}
              onChange={(e) => setPendingDate(e.target.value || null)}
            />
            {pendingDate && (
              <button
                className="planner-qa-clear"
                onClick={() => setPendingDate(null)}
                title="清除日期"
              >
                <AppIcon name="close" size={10} />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ============ 右栏：计划详情 ============ */}
      {/* 右栏：计划详情。宽屏常驻；窄屏走弹窗（保证四象限完整显示） */}
      {!isNarrow && <aside className="planner-col planner-right">{detailPanel}</aside>}
      {isNarrow && (
        <Modal
          open={!!selected}
          onCancel={() => setSelectedAnchor(null)}
          footer={null}
          width={400}
          title="计划详情"
          styles={{ body: { padding: 0 } }}
          destroyOnHidden
        >
          {detailPanel}
        </Modal>
      )}

      <CategoryModal
        open={catModalOpen}
        editing={editingCat}
        onCancel={() => {
          setCatModalOpen(false);
          setEditingCat(null);
        }}
      />
    </div>
  );
}

// ============================================================
// 四象限区（DnD + 4 桶，视觉照搬预览：左上q3/右上q1/左下q4/右下q2 + 右下装饰大图标）
// ============================================================
function QuadrantArea({
  buckets,
  selectedId,
  onSelect,
  onToggle,
  onDragEnd,
  taskCat,
  categories,
  childCountByTask,
}: {
  buckets: Record<Quadrant, Task[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (t: Task, done: boolean) => void;
  onDragEnd: (t: Task, target: Quadrant) => void;
  taskCat: Map<string, string>;
  categories: PlannerCategory[];
  childCountByTask: Map<string, number>;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  // 拖拽进行中标志（ref，跨渲染不触发重渲）：松手后延迟一帧重置，让 click 守卫挡掉误触（防拖拽误开详情）
  const draggingRef = useRef(false);

  const onDragStart = (e: DragStartEvent) => {
    draggingRef.current = true;
    setActiveId(String(e.active.id));
  };
  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (over) {
      const task = active.data.current?.task as Task | undefined;
      if (task && task.source_line != null) onDragEnd(task, over.id as Quadrant);
    }
    // 延迟一帧重置：让本次拖拽松手后的 click 先被 PlannerTaskCard 守卫挡掉
    setTimeout(() => {
      draggingRef.current = false;
    }, 0);
  };

  // 拖拽中的任务（DragOverlay 克隆用）：从 buckets 找 activeId 对应 task
  const activeTask = activeId
    ? (Object.values(buckets).flat() as Task[]).find((t) => t.id === activeId) ?? null
    : null;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={handleDragEnd}>
      <div className="planner-quads">
        {QUAD_ORDER.map((key) => (
          <QuadBox
            key={key}
            def={QUADS[key]}
            tasks={buckets[key]}
            selectedId={selectedId}
            onSelect={onSelect}
            onToggle={onToggle}
            taskCat={taskCat}
            categories={categories}
            childCountByTask={childCountByTask}
            draggingRef={draggingRef}
          />
        ))}
      </div>
      {/* DragOverlay 克隆任务卡（rotate 2° + e4 阴影，可见所拖对象；spring 缓动消除"啪"感） */}
      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
        {activeTask ? (
          <div className="planner-card-overlay">
            <AppIcon name="ellipsis" size={10} />
            <span className="planner-card-overlay-text">{activeTask.text}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function QuadBox({
  def,
  tasks,
  selectedId,
  onSelect,
  onToggle,
  taskCat,
  categories,
  childCountByTask,
  draggingRef,
}: {
  def: QuadDef;
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (t: Task, done: boolean) => void;
  taskCat: Map<string, string>;
  categories: PlannerCategory[];
  childCountByTask: Map<string, number>;
  draggingRef: { current: boolean };
}) {
  const { setNodeRef, isOver } = useDroppable({ id: def.key });
  return (
    <div ref={setNodeRef} className={`planner-quad ${def.cls} ${isOver ? "over" : ""}`}>
      <div className="planner-quad-head">
        <span className="planner-quad-emoji">
          <AppIcon name={def.icon} size={15} />
        </span>
        <span className="planner-quad-name">{def.name}</span>
        <span className="planner-quad-tag">
          {def.tip} · {tasks.length}
        </span>
      </div>
      <div className="planner-quad-sub">{def.sub}</div>
      <div className="planner-quad-tasks">
        {tasks.length === 0 ? (
          <div className="planner-empty-tip">暂无任务</div>
        ) : (
          tasks.map((t) => (
            <PlannerTaskCard
              key={t.id}
              task={t}
              selected={selectedId === t.id}
              childCount={childCountByTask.get(t.id) ?? 0}
              onSelect={() => onSelect(t.id)}
              onToggle={onToggle}
              catName={catName(taskCat.get(t.id), categories)}
              draggingRef={draggingRef}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** 分类 id → 分类名（用于卡片 meta 文本，不带图标） */
function catName(catId: string | undefined, categories: PlannerCategory[]): string {
  if (!catId || catId === SYS_ALL || catId === SYS_INBOX) return "";
  const c = categories.find((x) => x.id === catId);
  return c ? c.name : "";
}

// ============================================================
// 任务卡（紧凑：checkbox + 标题 + meta[分类/期限/重复/子计划数] + 选中态 + 拖拽）
// ============================================================
function PlannerTaskCard({
  task,
  selected,
  childCount,
  onSelect,
  onToggle,
  catName: catLabel,
  draggingRef,
}: {
  task: Task;
  selected: boolean;
  childCount: number;
  onSelect: () => void;
  onToggle: (t: Task, done: boolean) => void;
  catName: string;
  draggingRef: { current: boolean };
}) {
  const hasChildren = childCount > 0;
  const canDrag = task.source_line != null;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: !canDrag,
  });
  const due = task.due_date ? task.due_date.slice(5) : "无期限";
  const overdue = task.due_date ? task.due_date < todayStr() : false;
  return (
    <div
      ref={setNodeRef}
      className={`planner-task-card ${selected ? "selected" : ""} ${isDragging ? "dragging" : ""}`}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (!draggingRef.current) onSelect(); // 拖拽松手后的误触 click 抑制
      }}
    >
      {task.source_line != null && (
        <input
          type="checkbox"
          className="planner-ck"
          checked={task.done}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggle(task, e.target.checked)}
        />
      )}
      <div className="planner-task-main">
        <div className={`planner-tc-title ${task.done ? "done" : ""}`}>
          {hasChildren && (
            <span className="planner-collection-badge" title="计划合集">
              <AppIcon name="folder" size={12} />
            </span>
          )}
          {task.text}
        </div>
        <div className="planner-tc-meta">
          {catLabel && <span>{catLabel}</span>}
          <span
            className={overdue ? "overdue" : ""}
            style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
          >
            {overdue && <AppIcon name="warning" size={11} color="var(--q1)" />}
            <AppIcon name="calendar" size={11} />
            {due}
          </span>
          {task.repeat_rule && <AppIcon name="reload" size={11} />}
          {hasChildren && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
              <AppIcon name="apps" size={11} />
              {childCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 迷你月历（周一首日，有任务日期带点，今天高亮，点日期预填输入条）
// ============================================================
function MiniCalendar({
  viewMonth,
  onPrev,
  onNext,
  dueDateSet,
  selectedDue,
  onPickDate,
}: {
  viewMonth: dayjs.Dayjs;
  onPrev: () => void;
  onNext: () => void;
  dueDateSet: Set<string>;
  selectedDue: string | null;
  onPickDate: (d: string) => void;
}) {
  const today = todayStr();
  const startOfMonth = viewMonth.startOf("month");
  const daysInMonth = viewMonth.daysInMonth();
  const firstWeekday = (startOfMonth.day() + 6) % 7; // 周一首：周一=0...周日=6
  const prevMonth = viewMonth.subtract(1, "month");
  const prevDaysInMonth = prevMonth.daysInMonth();

  const heads = ["一", "二", "三", "四", "五", "六", "日"];
  type Cell = { day: number; dateStr: string; other: boolean };
  const cells: Cell[] = [];
  for (let i = firstWeekday - 1; i >= 0; i--) {
    const d = prevDaysInMonth - i;
    cells.push({ day: d, dateStr: prevMonth.date(d).format("YYYY-MM-DD"), other: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, dateStr: viewMonth.date(d).format("YYYY-MM-DD"), other: false });
  }
  const nextMonth = viewMonth.add(1, "month");
  let n = 1;
  while (cells.length < 42) {
    cells.push({ day: n, dateStr: nextMonth.date(n).format("YYYY-MM-DD"), other: true });
    n++;
  }

  return (
    <div className="planner-panel planner-cal">
      <div className="planner-cal-head">
        <div className="planner-cal-month">{viewMonth.format("YYYY年MM月")}</div>
        <div className="planner-cal-nav">
          <button onClick={onPrev}>
            <AppIcon name="left" size={11} />
          </button>
          <button onClick={onNext}>
            <AppIcon name="right" size={11} />
          </button>
        </div>
      </div>
      <div className="planner-cal-grid">
        {heads.map((h, i) => (
          <div key={h} className={`planner-cal-wk ${i >= 5 ? "weekend" : ""}`}>
            {h}
          </div>
        ))}
        {cells.map((c, i) => {
          const isToday = c.dateStr === today;
          const isSelected = selectedDue === c.dateStr;
          const hasTask = dueDateSet.has(c.dateStr);
          const cls = [
            "planner-cal-day",
            c.other ? "other" : "",
            isToday ? "today" : "",
            isSelected ? "selected" : "",
          ].join(" ").trim();
          return (
            <div key={i} className={cls} onClick={() => onPickDate(c.dateStr)}>
              {c.day}
              {hasTask && <span className="planner-cal-dot" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// 右栏：计划详情（标题/描述/子计划/期限快捷/属性行▶可展开 / 底部保存+删除+更多）
// ============================================================
function DetailPanel({
  task,
  categories,
  taskCat,
  childTasks,
  projectName,
  projectById,
  onClose,
  onToggle,
  onQuadChange,
  onRebuild,
  onDescChange,
  onAddChild,
  onSetProject,
  onDelete,
  onDeleteChild,
  onDuplicate,
}: {
  task: Task | null;
  categories: PlannerCategory[];
  taskCat: Map<string, string>;
  childTasks: Task[];
  projectName: string | null;
  projectById: Map<string, Project>;
  onClose: () => void;
  onToggle: (t: Task, done: boolean) => void;
  onQuadChange: (t: Task, q: Quadrant) => void;
  onRebuild: (
    t: Task,
    overrides: {
      text?: string;
      dueDate?: string | null;
      repeatRule?: string | null;
      projectName?: string | null;
    }
  ) => void;
  onDescChange: (t: Task, newDesc: string, descLineNo: number | null) => void;
  onAddChild: (t: Task, childText: string, afterLine: number) => Promise<boolean>;
  onSetProject: (name: string | null) => void;
  onDelete: () => void;
  onDeleteChild: (c: Task) => void;
  onDuplicate: () => void;
}) {
  const [openAttr, setOpenAttr] = useState<string | null>(null);
  // 描述：从源笔记正文解析任务下一行的缩进纯文本（Obsidian Tasks 惯例）
  const [desc, setDesc] = useState<{ text: string; lineNo: number | null }>({
    text: "",
    lineNo: null,
  });
  const [descDraft, setDescDraft] = useState(""); // 输入中的草稿（失焦才写回）
  const [titleDraft, setTitleDraft] = useState(""); // 标题草稿（失焦写回，避免每键 IPC，Blocker #2）
  const newChildRef = useRef<HTMLInputElement>(null);
  const [newChild, setNewChild] = useState(""); // 子计划新增输入

  // 切任务 → 拉源笔记解析描述
  useEffect(() => {
    if (!task || task.source_line == null) {
      setDesc({ text: "", lineNo: null });
      setDescDraft("");
      return;
    }
    let cancelled = false;
    const sl = task.source_line;
    api
      .getNoteContent(task.note_id)
      .then((nc) => {
        if (cancelled) return;
        const d = parseDesc(nc.raw_content, sl);
        const next = d ? { text: d.text, lineNo: d.lineNo } : { text: "", lineNo: null };
        setDesc(next);
        setDescDraft(next.text);
      })
      .catch(() => {
        if (cancelled) return;
        setDesc({ text: "", lineNo: null });
        setDescDraft("");
      });
    return () => {
      cancelled = true;
    };
  }, [task?.id, task?.source_line]);

  // 标题草稿：切任务（task.id 变）时重置。输入只改 draft，失焦才写回 vault（Blocker #2：
  // 原 onChange 每键 onRebuild → 每键写盘 + 触发 watcher 全量索引，1.9 万 vault 卡死 + input value 跳变光标跑末尾）
  useEffect(() => {
    setTitleDraft(task?.text ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  if (!task) {
    return (
      <div className="planner-panel planner-detail-empty">
        <div className="planner-detail-empty-inner">
          <div className="planner-detail-big">
            <AppIcon name="note" size={40} />
          </div>
          <div>点击任务查看详情</div>
          <div className="planner-detail-hint">或在顶部输入框添加计划</div>
        </div>
      </div>
    );
  }

  const isAgg = task.source_line == null;
  const effUrgency = effectiveUrgency(task); // 三态口径（与矩阵/列表同源，Blocker #1 方案 B）
  const quad = classifyQuadrant(task, effUrgency);
  const qDef = QUADS[quad];
  const catId = taskCat.get(task.id);
  const curCat = categories.find((c) => c.id === catId);
  const catLabel = catName(catId, categories) || "收集箱";
  const due = task.due_date ?? "";

  // 描述失焦写回（草稿与已加载描述不同才写，避免无谓 IPC）
  const commitDesc = () => {
    if (descDraft.trim() === desc.text.trim()) return;
    onDescChange(task, descDraft, desc.lineNo);
  };

  // 子计划回车：乐观插入 + 焦点保持。写回中或失败不清空输入（不丢字）。
  const onChildEnter = async () => {
    // 显式守卫聚合任务（source_line=null）：去掉非空断言，避免未来移除 !isAgg 守卫时崩溃（High #7）
    const afterLine = desc.lineNo ?? task.source_line;
    if (afterLine == null) return;
    const ok = await onAddChild(task, newChild, afterLine);
    if (ok) setNewChild("");
    requestAnimationFrame(() => newChildRef.current?.focus());
  };

  // 「更多」下拉菜单（label 带 AppIcon，统一图标，无 emoji）
  const moreMenu = {
    items: [
      { key: "today", label: (<><AppIcon name="calendar" size={12} /> 标为今日</>) },
      { key: "clear", label: (<><AppIcon name="close" size={12} /> 清除期限</>) },
      { type: "divider" as const },
      { key: "dup", label: (<><AppIcon name="copy" size={12} /> 复制任务到今日待办</>) },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "today") onRebuild(task, { dueDate: todayStr() });
      else if (key === "clear") onRebuild(task, { dueDate: "" });
      else if (key === "dup") onDuplicate();
    },
  };

  return (
    <div className="planner-panel planner-detail">
      <div className="planner-detail">
        <div className="planner-detail-head">
          <span className="planner-detail-emoji">
            <AppIcon name={qDef.icon} size={18} />
          </span>
          <div className="planner-detail-main">
            <div className="planner-detail-title-row">
              <input
                className="planner-field-input planner-detail-title"
                value={titleDraft}
                disabled={isAgg}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  // 失焦写回：草稿与原 text 不同才写，避免无谓 IPC（与描述 textarea 同模式）
                  if (titleDraft.trim() !== task.text.trim()) {
                    onRebuild(task, { text: titleDraft.trim() });
                  }
                }}
                placeholder={isAgg ? "聚合任务（不可编辑）" : "计划标题"}
              />
              <span className={`planner-quad-badge ${qDef.cls}`}>{quad.toUpperCase()}</span>
            </div>
            <div className="planner-detail-sub">
              {qDef.name} · {qDef.tip}
              {projectName && (
                <span>
                  {" · "}
                  <AppIcon name="folder" size={12} /> {projectName}
                </span>
              )}
              {childTasks.length > 0 && (
                <span>
                  {" · "}
                  <AppIcon name="folder" size={12} /> 计划合集（{childTasks.length} 子计划）
                </span>
              )}
            </div>
          </div>
          <button className="planner-detail-close" onClick={onClose} title="关闭">
            <AppIcon name="close" size={16} />
          </button>
        </div>

        <div className="planner-detail-body">
          {/* 子计划：读 + 删 + 新增（insertLineAfter 父任务行后，缩进 checkbox 归属父） */}
          <div className="planner-field">
            <label className="planner-field-label">
              <AppIcon name="apps" size={12} /> 子计划（{childTasks.length}）
            </label>
            <div className="planner-sub-list">
              {childTasks.length === 0 && !isAgg && (
                <div className="planner-sub-empty">暂无子计划</div>
              )}
              {childTasks.map((c) => (
                <div key={c.id} className="planner-sub-row">
                  <input
                    type="checkbox"
                    className="planner-ck"
                    checked={c.done}
                    onChange={(e) => onToggle(c, e.target.checked)}
                  />
                  <span className={`planner-sub-text ${c.done ? "done" : ""}`}>{c.text}</span>
                  <button
                    className="planner-sub-del"
                    title="删除子计划"
                    onClick={() => onDeleteChild(c)}
                  >
                    <AppIcon name="close" size={10} />
                  </button>
                </div>
              ))}
            </div>
            {!isAgg && (
              <div className="planner-add-sub-row">
                <input
                  ref={newChildRef}
                  className="planner-add-sub-input"
                  placeholder="添加子计划，回车保存"
                  value={newChild}
                  onChange={(e) => setNewChild(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onChildEnter();
                    }
                  }}
                />
              </div>
            )}
          </div>

          {/* 描述：任务行下方的缩进纯文本（Obsidian Tasks 惯例），失焦写回。
              parseDesc 扫描跳过子任务 bullet，描述无论在子计划前/后都能解析到。 */}
          <div className="planner-field">
            <label className="planner-field-label">
              <AppIcon name="note" size={12} /> 描述
            </label>
            <textarea
              className="planner-field-input planner-desc-input"
              placeholder={isAgg ? "聚合任务不可编辑" : "选填：补充说明（保存到任务下方缩进文本）"}
              value={descDraft}
              disabled={isAgg}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={commitDesc}
              rows={2}
            />
          </div>

          {/* 完成期限：今天/明天/选择日期/放入收集箱 → 重组写回 */}
          <div className="planner-field">
            <label className="planner-field-label">
              <AppIcon name="calendar" size={12} /> 完成期限
            </label>
            <div className="planner-date-row">
              <div
                className={`planner-date-chip ${due === todayStr() ? "active" : ""}`}
                onClick={() => !isAgg && onRebuild(task, { dueDate: todayStr() })}
              >
                今天
              </div>
              <div
                className={`planner-date-chip ${due === tomorrowStr() ? "active" : ""}`}
                onClick={() => !isAgg && onRebuild(task, { dueDate: tomorrowStr() })}
              >
                明天
              </div>
              <label className="planner-date-chip" title="选择日期">
                选择日期
                <input
                  type="date"
                  value={due}
                  disabled={isAgg}
                  onChange={(e) => onRebuild(task, { dueDate: e.target.value })}
                />
              </label>
              <div
                className={`planner-date-chip ${due === "" ? "active" : ""}`}
                onClick={() => !isAgg && onRebuild(task, { dueDate: "" })}
              >
                放入收集箱
              </div>
            </div>
          </div>

          {/* 属性行 ▶ 可展开 */}
          {/* 计划分类：推导展示 + project 类可手动改（dir/tag 类给路径提示） */}
          <AttrRow
            label={<><AppIcon name="apps" size={13} /> 计划分类</>}
            value={catLabel}
            open={openAttr === "cat"}
            onToggle={() => setOpenAttr(openAttr === "cat" ? null : "cat")}
          >
            <div className="planner-cat-current">
              {curCat
                ? `当前依据：${matcherLabel(curCat)}`
                : "未匹配任何自定义分类（落收集箱）"}
            </div>
            <div className="planner-opt-row">
              <button
                className={`planner-opt-chip ${!task.project_id ? "active" : ""}`}
                onClick={() => onSetProject(null)}
                title="清除任务的项目标记（落收集箱，若无其他匹配）"
              >
                <AppIcon name="inbox" size={13} /> 无项目
              </button>
              {categories
                .filter((c) => c.matcher.kind === "project" && c.matcher.value)
                .map((c) => {
                  const pid = c.matcher.value;
                  const active = task.project_id === pid;
                  return (
                    <button
                      key={c.id}
                      className={`planner-opt-chip ${active ? "active" : ""}`}
                      onClick={() =>
                        onSetProject(projectById.get(c.matcher.value)?.name ?? null)
                      }
                      title="关联到项目（任务加 #project 标记）"
                    >
                      <AppIcon name={c.icon} size={12} /> {c.name}
                    </button>
                  );
                })}
            </div>
            {(categories.some((c) => c.matcher.kind === "dir") ||
              categories.some((c) => c.matcher.kind === "tag")) && (
              <div className="planner-attr-note">
                文件夹/标签类分类按源笔记位置推导：改笔记所在文件夹（文件树拖动）或笔记标签（笔记编辑器）即可改归类。
              </div>
            )}
          </AttrRow>

          {/* 重要优先级（象限）：4 chip → priority + urgency */}
          <AttrRow
            label={<><AppIcon name="thunder" size={13} /> 重要优先级</>}
            value={<><AppIcon name={qDef.icon} size={13} /> {qDef.name}</>}
            open={openAttr === "quad"}
            onToggle={() => setOpenAttr(openAttr === "quad" ? null : "quad")}
          >
            <div className="planner-opt-row">
              {QUAD_ORDER.map((key) => {
                const q = QUADS[key];
                return (
                  <button
                    key={key}
                    className={`planner-opt-chip ${q.cls} ${quad === key ? "active" : ""}`}
                    onClick={() => !isAgg && onQuadChange(task, key)}
                  >
                    <AppIcon name={q.icon} size={13} /> {q.name}
                  </button>
                );
              })}
            </div>
          </AttrRow>

          {/* 重复：不重复/每天/每周/每月 → 重组写回 */}
          <AttrRow
            label={<><AppIcon name="reload" size={13} /> 重复</>}
            value={REPEAT_OPTIONS.find((r) => r.key === (task.repeat_rule ?? ""))?.label ?? "无"}
            open={openAttr === "repeat"}
            onToggle={() => setOpenAttr(openAttr === "repeat" ? null : "repeat")}
          >
            <div className="planner-opt-row">
              {REPEAT_OPTIONS.map((r) => (
                <button
                  key={r.key}
                  className={`planner-opt-chip ${(task.repeat_rule ?? "") === r.key ? "active" : ""}`}
                  onClick={() => !isAgg && onRebuild(task, { repeatRule: r.key })}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </AttrRow>
        </div>

        <div className="planner-detail-foot">
          {/* 即时保存模式：无显式保存按钮（旧版"保存"onClick 只 toast 不写盘，是反模式）。
              底部细字提示让用户明确"改动已即时落盘"，避免"必须点保存才生效"的误解。 */}
          <div className="planner-detail-autosave">
            <AppIcon name="check" size={12} /> 所有改动已自动保存
          </div>
          <Popconfirm
            title="删除该计划？"
            onConfirm={onDelete}
            okText="删除"
            cancelText="取消"
            disabled={isAgg}
          >
            <button className="planner-icon-only" title="删除" disabled={isAgg}>
              <AppIcon name="delete" size={16} />
            </button>
          </Popconfirm>
          <Dropdown menu={moreMenu} trigger={["click"]} disabled={isAgg}>
            <button className="planner-icon-only" title="更多" disabled={isAgg}>
              <AppIcon name="ellipsis" size={16} />
            </button>
          </Dropdown>
        </div>
      </div>
    </div>
  );
}

/** 分类映射源的可读标签 */
function matcherLabel(c: PlannerCategory): string {
  const m = c.matcher;
  if (!m.value) return `${c.name}（未设映射源）`;
  if (m.kind === "project") return `${c.name} · 关联项目`;
  if (m.kind === "dir") return `${c.name} · 文件夹「${m.value}」`;
  return `${c.name} · 标签「${m.value}」`;
}

/** 属性行（▶ 可展开） */
function AttrRow({
  label,
  value,
  open,
  onToggle,
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="planner-field">
      <div className={`planner-attr-row ${open ? "open" : ""}`} onClick={onToggle}>
        <span className="planner-attr-label">{label}</span>
        <span className="planner-attr-value">
          {value} <span className="planner-attr-arrow"><AppIcon name="caret-right" size={9} /></span>
        </span>
      </div>
      <div className={`planner-attr-options ${open ? "show" : ""}`}>{children}</div>
    </div>
  );
}
