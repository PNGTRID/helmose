// 今日计划 · 新建分类弹窗：名字 + 图标 + 映射源（项目/文件夹/tag 三选一）。
// 分类配置只写 localStorage（stores/plannerCategories），不碰 vault/DB。
// 映射源下拉：项目来自 useActiveProjects；文件夹来自 listDirs；tag 来自 getTagsStats。
// 删除分类不在此 Modal（左栏分类项 hover 出删除按钮 + Popconfirm，删后任务自然落收集箱）。
// 图标统一走 AppIcon（@ant-design/icons），禁用 emoji。

import { useEffect, useState } from "react";
import { Modal, Segmented, Select, message } from "antd";
import * as api from "../api";
import { genId } from "../utils/id";
import { useVaultStore } from "../stores/vault";
import { useActiveProjects } from "../hooks/useActiveProjects";
import AppIcon from "./AppIcon";
import {
  usePlannerCategoryStore,
  type MatcherKind,
  type PlannerCategory,
} from "../stores/plannerCategories";

interface Props {
  open: boolean;
  onCancel: () => void;
  /** 编辑目标分类（null/undefined = 新建模式） */
  editing?: PlannerCategory | null;
}

/** 分类可选图标（AppIcon registry name，覆盖工作/学习/生活常见语义） */
const ICON_CHOICES = [
  "fire", "heart", "bulb", "star", "crown", "compass", "coffee", "thunder",
  "clock", "calendar", "task", "project", "folder", "tag", "home", "apps",
];

const KIND_OPTIONS: Array<{ label: string; value: MatcherKind }> = [
  { label: "项目", value: "project" },
  { label: "文件夹", value: "dir" },
  { label: "标签", value: "tag" },
];

export default function CategoryModal({ open, onCancel, editing }: Props) {
  const vault = useVaultStore((s) => s.vault);
  const addCategory = usePlannerCategoryStore((s) => s.addCategory);
  const updateCategory = usePlannerCategoryStore((s) => s.updateCategory);
  const { projects, loading: projectsLoading } = useActiveProjects();

  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string>(ICON_CHOICES[0]);
  const [kind, setKind] = useState<MatcherKind>("project");
  const [matcherValue, setMatcherValue] = useState<string>("");

  // 文件夹 / 标签 候选（按当前 kind 懒拉，切到才拉，省 IPC）
  const [dirs, setDirs] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);

  // 关闭时重置表单
  useEffect(() => {
    if (!open) {
      setName("");
      setIcon(ICON_CHOICES[0]);
      setKind("project");
      setMatcherValue("");
    }
  }, [open]);

  // 编辑模式：open 变 true 且 editing 存在 → 预填表单（新建模式 editing=null 走默认空值）
  useEffect(() => {
    if (open && editing) {
      setName(editing.name);
      setIcon(editing.icon);
      setKind(editing.matcher.kind);
      setMatcherValue(editing.matcher.value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  // 切到文件夹 → 拉 listDirs；切到标签 → 拉 getTagsStats
  useEffect(() => {
    if (!open || !vault) return;
    if (kind === "dir" && dirs.length === 0) {
      api.listDirs(vault.id).then(setDirs).catch(() => setDirs([]));
    } else if (kind === "tag" && tags.length === 0) {
      api
        .getTagsStats(vault.id)
        .then((rows) => setTags(rows.map((r) => r[0])))
        .catch(() => setTags([]));
    }
    // 注：切 kind 清空 matcherValue 移到 Segmented onChange（用户主动切才清，编辑预填 setKind 不触发清空）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, open]);

  const onOk = () => {
    const n = name.trim();
    if (!n) {
      message.warning("请输入分类名称");
      return;
    }
    if (!matcherValue) {
      message.warning("请选择映射源（项目/文件夹/标签）");
      return;
    }
    if (editing) {
      updateCategory(editing.id, { name: n, icon, matcher: { kind, value: matcherValue } });
      message.success(`已更新分类「${n}」`);
    } else {
      addCategory({
        id: `cat-${genId()}`,
        name: n,
        icon,
        matcher: { kind, value: matcherValue },
      });
      message.success(`已新建分类「${n}」`);
    }
    onCancel();
  };

  // 映射源下拉选项（按 kind 分支）
  const matcherOptions =
    kind === "project"
      ? projects.map((p) => ({
          value: p.id,
          label: `${p.name}${p.is_mainline ? " · 主线" : ""}`,
        }))
      : kind === "dir"
      ? dirs.map((d) => ({ value: d, label: d || "（vault 根）" }))
      : tags.map((t) => ({ value: t, label: t }));

  const matcherPlaceholder =
    kind === "project"
      ? "选择项目"
      : kind === "dir"
      ? "选择文件夹"
      : "选择标签";

  return (
    <Modal
      title={editing ? "编辑分类" : "新建分类"}
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText="确定"
      cancelText="取消"
      destroyOnHidden
      width={440}
    >
      <div className="cat-modal-form">
        <div className="cat-modal-field">
          <label className="cat-modal-label">分类名称</label>
          <input
            className="cat-modal-input"
            placeholder="例如：健身 / 学习 / 副业"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        <div className="cat-modal-field">
          <label className="cat-modal-label">选择图标</label>
          <div className="cat-modal-emoji-row">
            {ICON_CHOICES.map((n) => (
              <button
                key={n}
                type="button"
                className={`cat-modal-emoji ${icon === n ? "active" : ""}`}
                onClick={() => setIcon(n)}
              >
                <AppIcon name={n} size={18} />
              </button>
            ))}
          </div>
        </div>

        <div className="cat-modal-field">
          <label className="cat-modal-label">映射源（任务按此自动归类）</label>
          <Segmented
            options={KIND_OPTIONS}
            value={kind}
            onChange={(v) => {
              setKind(v as MatcherKind);
              setMatcherValue(""); // 用户主动切 kind 清空已选值（不同 kind value 语义不同）
            }}
            block
            style={{ marginBottom: 8 }}
          />
          <Select
            showSearch
            placeholder={matcherPlaceholder}
            value={matcherValue || undefined}
            onChange={(v) => setMatcherValue(v ?? "")}
            loading={kind === "project" && projectsLoading}
            options={matcherOptions}
            style={{ width: "100%" }}
            optionFilterProp="label"
            notFoundContent={
              kind === "dir"
                ? "暂无目录"
                : kind === "tag"
                ? "暂无标签"
                : "暂无项目"
            }
          />
          <div className="cat-modal-hint">
            {kind === "project" && "该项目的任务归入此分类。"}
            {kind === "dir" && "源笔记位于该文件夹下的任务归入此分类。"}
            {kind === "tag" && "源笔记带该标签的任务归入此分类。"}
            {"都不命中的任务落入「收集箱」。"}
          </div>
        </div>
      </div>
    </Modal>
  );
}
