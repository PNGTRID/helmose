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

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Modal, Popconfirm } from "antd";
import dayjs from "dayjs";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
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
import { rebuildTaskLine } from "../utils/taskLine";
import { buildTaskBullet } from "../utils/quickAdd";
import { classifyQuadrant, computeUrgencyMap, type DropTarget, type Quadrant } from "../utils/taskGrouping";
import type { NoteMeta, Project, Task } from "../types";
import AppIcon from "../components/AppIcon";
import CategoryModal from "../components/CategoryModal";
import QuickAddTaskModal from "../components/QuickAddTaskModal";
// 阶段 3a/3b 拆分：常量 / 子组件（含 DetailPanel）抽到 components/planner/
import { QUADS } from "../components/planner/constants";
import MiniCalendar from "../components/planner/MiniCalendar";
import QuadrantArea from "../components/planner/QuadrantArea";
import DetailPanel from "../components/planner/DetailPanel";
import { usePlannerTasksStore } from "../stores/plannerTasks";
import "./PlannerPage.css";

// 常量（QUADS/QUAD_ORDER/REPEAT_OPTIONS/todayStr/tomorrowStr/SelectAnchor）已抽到 components/planner/constants.ts。
// parseDesc / rebuildTaskLine 已抽到 utils/taskLine.ts（纯函数可单测）。

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

  // 阶段 3b：tasks/selectedAnchor/writing/loadError 迁到 Zustand store（跨子组件共享，避开 props 链爆炸）。
  // setter 签名与 useState 兼容（接受值或 (prev)=>next），下方写回回调内部代码零改动。
  const tasks = usePlannerTasksStore((s) => s.tasks);
  const setTasks = usePlannerTasksStore((s) => s.setTasks);
  const selectedAnchor = usePlannerTasksStore((s) => s.selectedAnchor);
  const setSelectedAnchor = usePlannerTasksStore((s) => s.setSelectedAnchor);
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
  // 日历选中日期（点击日期显示当日计划；区别于 pendingDate=输入条新任务日期）
  const [selectedCalDate, setSelectedCalDate] = useState<string | null>(null);
  const [quickText, setQuickText] = useState("");
  // 输入条挂起的日期（日期选择器 / 迷你日历点日期预填），回车提交时带上
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  // 快速添加详情弹窗（输入条「配置」按钮打开，复用 QuickAddTaskModal 设日期/紧急/项目/重复/子任务）
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<PlannerCategory | null>(null); // CategoryModal 编辑目标（null=新建）
  const writing = usePlannerTasksStore((s) => s.writing);
  const setWriting = usePlannerTasksStore((s) => s.setWriting);
  const loadError = usePlannerTasksStore((s) => s.loadError);
  const setLoadError = usePlannerTasksStore((s) => s.setLoadError);
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

  // 象限拖拽 / 属性行改象限 / 拖回收集箱（三态写回，Blocker #1 方案 B 根治：manual low 可压制派生 high）
  const onQuadChange = async (t: Task, target: DropTarget) => {
    if (t.source_line == null || writing) return;
    // 拖回收集箱：清 priority + urgency（due_date 不动；有 due 的任务因 isInbox 需 due 空才进收集箱）
    if (target === "inbox") {
      setTasks((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, priority: 0, urgency: "" } : x))
      );
      setWriting(true);
      try {
        await api.setTaskPriority(t.note_id, t.source_line, 0);
        await api.setTaskUrgency(t.note_id, t.source_line, "");
        msg.success("已移回收集箱");
      } catch (e) {
        msg.error(`移回收集箱失败：${e}`);
        refresh();
      } finally {
        setWriting(false);
      }
      return;
    }
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
      // 加严：必须是以 `- [ ]`/`- [x]` 等 checkbox 开头的 bullet 行，且含任务文本——
      // 裸 includes(t.text) 会把任务文本作为子串误匹配到标题/正文段落，定位错父行。
      const bodyLines = cur.raw_content.split("\n");
      let parentLine = -1;
      for (let i = bodyLines.length - 1; i >= 0; i--) {
        const ln = bodyLines[i];
        if (/^\s*-\s\[[ xX/]\]\s+/.test(ln) && ln.includes(t.text)) {
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
  // 乐观：临时顶层任务立即进收集箱（温和版 GTD：新建不带 urgency → 完全未表态 → isInbox），
  // watcher refresh 后替换为真。用户拖入象限或设 due 才算「排程」出收集箱。
  // bullet 经 buildTaskBullet 拼装（写侧唯一源，尊重全局 markingStyle）；已含 `- [ ]` 前缀 → asTask=false 避免双前缀。
  const quickAdd = async (text: string, due: string | null) => {
    if (!vault) return;
    const t = text.trim();
    if (!t) return;
    // 默认当天 + 紧急（q3 紧急不重要：priority=0 + urgency=high + due=today，当天紧急任务显眼）。
    // due 参数预留（输入条已去日期选择器，恒 null → 默认 today）。
    const finalDue = due ?? dayjs().format("YYYY-MM-DD");
    const tempId = `temp-${genId()}`;
    const tempTask: Task = {
      id: tempId,
      note_id: "",
      vault_id: vault.id,
      text: t,
      done: false,
      due_date: finalDue,
      source: "checkbox",
      source_line: null,
      project_id: null,
      created_at: new Date().toISOString(),
      completed_at: null,
      status: "todo",
      priority: 0,
      urgency: "high", // 默认 q3（紧急不重要）：当天紧急任务显眼
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
      const bullet = buildTaskBullet({ text: t, dueDate: finalDue, urgency: "high" });
      await api.appendBullet(nc.id, "今日待办", bullet, false);
      msg.success("已添加到今日待办（紧急不重要）");
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

  // 四象限分桶（仅顶层任务，按 effective urgency 分 q1-q4）
  const buckets = useMemo(() => {
    const out: Record<Quadrant, Task[]> = { q1: [], q2: [], q3: [], q4: [] };
    for (const t of filteredTop) {
      const eff = urgencyMap.get(t.id) ?? "low";
      out[classifyQuadrant(t, eff)].push(t);
    }
    return out;
  }, [filteredTop, urgencyMap]);

  // —— DnD 架构（阶段四 GTD）：DndContext 提升到本页顶层，包裹左栏收集箱 + 中栏四象限，
  // 使收集箱↔象限可互拖。sensors / handleDragEnd / DragOverlay / activeTask 从原 QuadrantArea 提升。
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [activeId, setActiveId] = useState<string | null>(null);
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
      // over.id 为象限 key（q1-q4）或 "inbox"，统一走 onQuadChange 写回（含拖回收集箱清标记）
      if (task && task.source_line != null) void onQuadChange(task, over.id as DropTarget);
    }
    // 延迟一帧重置：让拖拽松手后的 click 先被 PlannerTaskCard 守卫挡掉（防误开详情）
    setTimeout(() => {
      draggingRef.current = false;
    }, 0);
  };
  // 拖拽中的任务（DragOverlay 克隆用）：从全部任务找 activeId（收集箱 + 象限任一处）
  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null;

  if (!vault) return null;

  // 详情面板 JSX（宽屏右栏 / 窄屏弹窗共用，避免重复写一长串 props）
  const detailPanel = (
    <DetailPanel
      task={selected}
      categories={categories}
      taskCat={taskCat}
      projectById={projectById}
      noteById={noteById}
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
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={handleDragEnd}>
    <div
      className="planner-page"
      ref={rootRef}
      style={isNarrow ? { gridTemplateColumns: "200px 1fr" } : undefined}
    >
      {/* ============ 左栏：任务分类 → 迷你日历 ============ */}
      <aside className="planner-col planner-left">
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
          selectedDue={selectedCalDate}
          onPickDate={setSelectedCalDate}
        />
        {/* 当日计划：点击日期后显示该日 due 的任务（紧凑列表 + 象限色点，点击选中进详情）*/}
        {selectedCalDate && (
          <div className="planner-cal-tasks">
            <div className="planner-cal-tasks-head">
              <span>{selectedCalDate} 的计划</span>
              <button className="planner-cal-tasks-close" title="关闭" onClick={() => setSelectedCalDate(null)}>
                <AppIcon name="close" size={10} />
              </button>
            </div>
            {(() => {
              const dayTasks = topLevelTasks.filter((t) => t.due_date === selectedCalDate);
              if (dayTasks.length === 0) return <div className="planner-empty-tip">当日无计划</div>;
              return dayTasks.map((t) => {
                const q = classifyQuadrant(t, urgencyMap.get(t.id) ?? "low");
                return (
                  <div key={t.id} className="planner-cal-task" onClick={() => onSelect(t.id)}>
                    <span className={`planner-cal-task-dot ${q}`} />
                    <span className={`planner-cal-task-text ${t.done ? "done" : ""}`}>{t.text}</span>
                  </div>
                );
              });
            })()}
          </div>
        )}
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
          taskCat={taskCat}
          categories={categories}
          childCountByTask={childCountByTask}
          draggingRef={draggingRef}
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
            placeholder="添加今日计划（紧急不重要），回车保存"
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void quickAdd(quickText, pendingDate);
            }}
          />
          <div className="planner-qa-tools">
            <button
              className="planner-qa-tool"
              title="详情配置（日期/紧急/项目/重复）"
              onClick={() => setQuickAddOpen(true)}
            >
              <AppIcon name="setting" size={14} />
            </button>
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

      <QuickAddTaskModal open={quickAddOpen} onCancel={() => setQuickAddOpen(false)} />
      <CategoryModal
        open={catModalOpen}
        editing={editingCat}
        onCancel={() => {
          setCatModalOpen(false);
          setEditingCat(null);
        }}
      />
    </div>
      {/* DragOverlay 克隆任务卡（rotate 2° + e4 阴影；spring 缓动消除「啪」感）。
          原在 QuadrantArea 内，DndContext 提升后随之上提到本页顶层。 */}
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

