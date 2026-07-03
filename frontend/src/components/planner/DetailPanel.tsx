// 右栏：计划详情（标题/描述/子计划/期限快捷/属性行▶可展开 / 底部保存+删除+更多）。
// 从 PlannerPage 抽离（阶段 3b）。复用全局 planner- 类名（PlannerPage.css 仍全局生效）。
//
// 数据来源（plan 铁律）：
//   - tasks 来自 store（usePlannerTasksStore）→ 派生 childTasks（task.parent_task_id === task.id）
//   - projectName 从 projectById + task.project_id 自算
//   - 其余只读数据（categories/taskCat/projectById）+ 全部写回回调由父组件 props 注入
//   - 写回回调留父组件层（用 antd message + api），本组件只管交互与渲染
import { useEffect, useRef, useState } from "react";
import { Dropdown, Popconfirm } from "antd";
import * as api from "../../api";
import { parseDesc } from "../../utils/taskLine";
import { classifyQuadrant, effectiveUrgency, type Quadrant } from "../../utils/taskGrouping";
import type { NoteMeta, Project, Task } from "../../types";
import type { PlannerCategory } from "../../stores/plannerCategories";
import { openNoteFromMeta } from "../../utils/note";
import AppIcon from "../AppIcon";
import {
  QUADS,
  QUAD_ORDER,
  REPEAT_OPTIONS,
  todayStr,
  tomorrowStr,
} from "./constants";
import { catName, matcherLabel } from "./utils";
import AttrRow from "./AttrRow";
import { usePlannerTasksStore } from "../../stores/plannerTasks";

export interface DetailPanelProps {
  task: Task | null;
  categories: PlannerCategory[];
  taskCat: Map<string, string>;
  projectById: Map<string, Project>;
  /** note_id → NoteMeta，所属文档点击打开用（PlannerPage 的 noteById 传入）*/
  noteById: Map<string, NoteMeta>;
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
}

export default function DetailPanel({
  task,
  categories,
  taskCat,
  projectById,
  noteById,
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
}: DetailPanelProps) {
  // tasks 来自 store（阶段 3b）：childTasks / projectName 由 store.tasks + projectById 派生，减少父组件 props
  const tasks = usePlannerTasksStore((s) => s.tasks);
  const childTasks = task ? tasks.filter((t) => t.parent_task_id === task.id) : [];
  const projectName = task?.project_id ? projectById.get(task.project_id)?.name ?? null : null;

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
              {task.note_id && (
                <span>
                  {" · "}
                  <a
                    className="planner-doc-link"
                    title={noteById.get(task.note_id)?.rel_path}
                    onClick={() => {
                      const n = noteById.get(task.note_id);
                      if (n) openNoteFromMeta(n);
                    }}
                  >
                    <AppIcon name="note" size={12} /> {noteById.get(task.note_id)?.file_name ?? "所属文档"}
                  </a>
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
