// 左面板：Obsidian 式「目录+文件混合树」+ 全库搜索 + 排序
// 顶部显示 Vault 名；树从根目录内容开始（顶层文件夹+根文件）；节点文字单行省略号。
// 文件节点支持右键菜单：移动 / 重命名（写回 vault，含路径型引用批量更新确认）。
import "./FilePanel.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Dropdown,
  Empty,
  Input,
  message,
  Modal,
  Segmented,
  Spin,
  Tree,
  TreeSelect,
} from "antd";
import { CaretRightOutlined, FileAddOutlined, FolderOpenOutlined, FolderOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useTabsStore } from "../stores/tabs";
import { openNoteFromMeta } from "../utils/note";
import { getRecent } from "../utils/recentlyOpened";
import { useAllNotesMeta } from "../hooks/useAllNotesMeta";
import { childDirs, fileIcon, makeCompare, type SortMode } from "../utils/tree";
import type { NoteMeta, RefLoc, SearchResult } from "../types";

interface TreeNode {
  key: string;
  title: ReactNode;
  isLeaf?: boolean;
  children?: TreeNode[];
  sortKey?: string;
}

export default function FilePanel({ width }: { width: number }) {
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);

  // 最近打开区（搜索框下方）：消费 recentlyOpened.ts 的 localStorage 记录。
  // 防 id 漂移：note_id 由 content_hash 派生（任何编辑都会变），故按 rel_path 在当前全量 meta
  // 里命中后再展示，并取最新 meta（id/title 都是当前的），点击不会跳到失效 id。
  const { notes } = useAllNotesMeta();
  const [recentTick, setRecentTick] = useState(0);
  // 最近打开折叠态（默认折叠——左栏空间紧，按需展开）
  const [recentExpanded, setRecentExpanded] = useState(false);
  const recents = useMemo(() => {
    // recentTick 仅作重算触发器：点击最近项后 localStorage 已被 pushRecent 更新（tabs.ts），
    // bump 它让本 memo 重算，把刚打开的项置顶（notes 未变，不靠它驱动）。
    const byPath = new Map<string, NoteMeta>();
    for (const n of notes) byPath.set(n.rel_path, n);
    return getRecent()
      .filter((r) => byPath.has(r.rel_path))
      .slice(0, 5)
      .map((r) => byPath.get(r.rel_path)!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, recentTick]);
  const openRecent = (n: NoteMeta) => {
    openNoteFromMeta(n);
    setRecentTick((t) => t + 1);
  };

  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  // 当前 vault 所有目录扁平数组（listDirs），供移动弹窗的 TreeSelect 用（独立于树构建，避免漂移）
  const [dirs, setDirs] = useState<string[]>([]);
  // 展开状态持久化（localStorage，下次打开恢复用户展开的目录）
  const [expandedKeys, setExpandedKeys] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("helmose-expanded-dirs") || "[]");
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("natural");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const isSearch = query.trim().length > 0;

  // 新建笔记（创建到 00_收件箱，用户后续可移动）
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  // 移动弹窗状态：moveTarget={ noteId, currentDir, fileName } 或 null
  const [moveTarget, setMoveTarget] = useState<{
    noteId: string;
    currentDir: string;
    fileName: string;
  } | null>(null);
  const [moveDestDir, setMoveDestDir] = useState<string>("");

  // 重命名弹窗状态：renameTarget={ noteId, fileName } 或 null
  const [renameTarget, setRenameTarget] = useState<{
    noteId: string;
    fileName: string;
  } | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");

  const createNoteFile = async () => {
    if (!vault) return;
    const name = newName.trim();
    if (!name) {
      message.warning("请输入笔记名");
      return;
    }
    const fileName = name.endsWith(".md") ? name : `${name}.md`;
    const relPath = `00_收件箱/${fileName}`;
    try {
      const nc = await api.createNote(vault.id, relPath, `# ${name.replace(/\.md$/, "")}\n`);
      openNoteFromMeta({ id: nc.id, title: name, file_name: fileName, rel_path: nc.rel_path });
      message.success("已创建到 00_收件箱");
      setCreateOpen(false);
      setNewName("");
      await useVaultStore.getState().index();
    } catch (e) {
      message.error(`创建失败（可能已存在）：${e}`);
    }
  };

  const fileMap = useRef<Map<string, NoteMeta>>(new Map());

  // 展开状态变化时持久化（与初始化读配对）
  useEffect(() => {
    try {
      localStorage.setItem("helmose-expanded-dirs", JSON.stringify(expandedKeys));
    } catch {
      /* ignore */
    }
  }, [expandedKeys]);
  const bodyRef = useRef<HTMLDivElement>(null);
  // 虚拟滚动高度：测面板可视区，供 antd Tree virtual 模式用（1.9 万节点只渲染可见行）
  const [treeHeight, setTreeHeight] = useState(400);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const update = () => setTreeHeight(Math.max(200, el.clientHeight - 8));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!vault) return;
    // cancelled flag：watcherTick/sortMode 快速变化或组件卸载时，丢弃过期的 fetch 响应，
    // 避免旧树覆盖新树（竞态）及卸载后无效 setState（与 useAllNotesMeta 一致）。
    let cancelled = false;
    setLoading(true);
    Promise.all([api.listDirs(vault.id), api.listAllNotesMeta(vault.id)])
      .then(([d, notes]) => {
        if (cancelled) return;
        setDirs(d);
        fileMap.current.clear();
        const notesByDir = new Map<string, NoteMeta[]>();
        for (const n of notes) {
          const dirOfN = n.rel_path.includes("/")
            ? n.rel_path.slice(0, n.rel_path.lastIndexOf("/"))
            : "";
          if (!notesByDir.has(dirOfN)) notesByDir.set(dirOfN, []);
          notesByDir.get(dirOfN)!.push(n);
        }
        const cmp = makeCompare(sortMode);

        // 构建某目录的直接子（目录 + 文件，混合排序）
        const buildChildren = (dir: string): TreeNode[] => {
          const subs = childDirs(dir, d);
          const dirNodes: TreeNode[] = subs.map((sd) => {
            const name = sd.split("/").pop() ?? sd;
            return {
              key: "dir:" + sd,
              sortKey: name,
              title: (
                <span className="ob-node-title">
                  <FolderOutlined style={{ marginRight: 6, color: "#eab308", flexShrink: 0 }} />
                  <span className="ob-node-label">{name}</span>
                </span>
              ),
              isLeaf: false,
              children: buildChildren(sd),
            };
          });
          const fileNodes: TreeNode[] = (notesByDir.get(dir) ?? []).map((n) => {
            const k = "file:" + n.id;
            fileMap.current.set(k, n);
            // 文件节点 title 包裹右键菜单（Dropdown trigger=contextMenu）
            const menuItems: MenuProps["items"] = [
              {
                key: "move",
                label: "移动到…",
                onClick: () => {
                  const curDir = n.rel_path.includes("/")
                    ? n.rel_path.slice(0, n.rel_path.lastIndexOf("/"))
                    : "";
                  setMoveDestDir(curDir); // 默认当前目录
                  setMoveTarget({ noteId: n.id, currentDir: curDir, fileName: n.file_name });
                },
              },
              {
                key: "rename",
                label: "重命名…",
                onClick: () => {
                  setRenameValue(n.file_name.replace(/\.md$/i, ""));
                  setRenameTarget({ noteId: n.id, fileName: n.file_name });
                },
              },
              { type: "divider", key: "divider" },
              {
                key: "delete",
                label: "删除（移到回收站）",
                danger: true,
                onClick: () => submitDelete(n.id, n.file_name),
              },
            ];
            return {
              key: k,
              sortKey: n.file_name,
              title: (
                <Dropdown menu={{ items: menuItems }} trigger={["contextMenu"]}>
                  <span className="ob-node-title">
                    {fileIcon(n.file_name)}
                    <span className="ob-node-label">{n.file_name}</span>
                  </span>
                </Dropdown>
              ),
              isLeaf: true,
            };
          });
          return [...dirNodes, ...fileNodes].sort((a, b) => cmp(a.sortKey ?? "", b.sortKey ?? ""));
        };

        setTreeData(buildChildren(""));
        // 首次默认展开顶层目录（之后保留用户展开状态）
        setExpandedKeys((prev) =>
          prev.length ? prev : childDirs("", d).map((x) => "dir:" + x)
        );
      })
      .catch(() => {
        if (cancelled) return;
        setTreeData([]);
        setDirs([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, watcherTick, sortMode]);

  useEffect(() => {
    if (!vault) return;
    // cancelled flag：query 快速变化或组件卸载时，丢弃过期的 fetch 响应，
    // 避免「旧 query 的慢搜索」覆盖「新 query/清空」的结果（竞态）及卸载后无效 setState。
    // 关键：then/catch/finally 都要 if(!cancelled) 守卫——尤其 finally 的 setSearching(false)，
    // 否则旧 in-flight 收尾会把新 query 的 searching 误置 false（卡 loading）。
    let cancelled = false;
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    const h = setTimeout(() => {
      api
        .searchNotes(vault.id, q, 50)
        .then((res) => {
          if (!cancelled) setResults(res);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, query]);

  // 把扁平 dirs（""=根）构建成 antd TreeSelect 的树形数据
  const dirTreeData = useMemo(() => {
    type DirNode = {
      value: string; // 目录相对路径（""=根）
      title: string;
      selectable: boolean;
      children?: DirNode[];
    };
    const build = (parent: string): DirNode[] => {
      const subs = childDirs(parent, dirs);
      return subs.map((sd) => {
        const name = sd.split("/").pop() ?? sd;
        return {
          value: sd,
          title: name,
          selectable: true,
          children: build(sd),
        };
      });
    };
    // 根节点（value=""）作为可选项；子目录递归构建
    return [
      { value: "", title: "（vault 根）", selectable: true, children: build("") },
    ];
  }, [dirs]);

  // 提交移动：moveNote → 若有路径型引用（refs_to_update 非空）弹确认 → applyRefUpdates → bumpTick 刷新。
  // 不 optimistic patch（写 vault 后 note_id 可能因 content_hash 变 → 直接 refresh 重拉，与 toggle/save 一致）
  const submitMove = async () => {
    if (!moveTarget) return;
    if (moveDestDir === moveTarget.currentDir) {
      message.info("目标目录与当前位置相同");
      return;
    }
    try {
      const result = await api.moveNote(moveTarget.noteId, moveDestDir);
      // refs_to_update 非空 → 弹确认（列出引用数 + 涉及笔记路径，用户授权才改其他笔记原文）
      if (result.refs_to_update.length > 0) {
        const ok = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: `更新 ${result.refs_to_update.length} 处路径引用？`,
            content: (
              <div style={{ fontSize: 12 }}>
                <div>移动后其他笔记中引用此文件路径的链接将失效，</div>
                <div>需同步更新以下笔记中的引用：</div>
                <ul style={{ marginTop: 4, maxHeight: 160, overflow: "auto", paddingLeft: 18 }}>
                  {result.refs_to_update.slice(0, 20).map((r, i) => (
                    <li key={i}>
                      <code>{r.old_path}</code>
                      {" → "}
                      <code>{r.new_path}</code>
                    </li>
                  ))}
                  {result.refs_to_update.length > 20 && (
                    <li>…（共 {result.refs_to_update.length} 处，仅显示前 20）</li>
                  )}
                </ul>
              </div>
            ),
            okText: "更新引用",
            cancelText: "只移动",
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
        if (ok) {
          await api.applyRefUpdates(result.refs_to_update as RefLoc[]);
          message.success(
            `已移动到「${moveDestDir || "根"}」并更新 ${result.refs_to_update.length} 处引用`
          );
        } else {
          message.success(`已移动到「${moveDestDir || "根"}」（引用未更新）`);
        }
      } else {
        message.success(`已移动到「${moveDestDir || "根"}」`);
      }
      setMoveTarget(null);
      setMoveDestDir("");
      // 刷新文件树（写 vault 后 note_id 可能变 → 重拉而非 patch）
      useVaultStore.getState().bumpTick();
    } catch (e) {
      message.error(`移动失败：${e}`);
    }
  };

  // 提交重命名：renameNote → 同 move 流程的引用更新确认 → bumpTick。
  const submitRename = async () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) {
      message.warning("请输入新文件名");
      return;
    }
    const newFileName = name.toLowerCase().endsWith(".md") ? name : `${name}.md`;
    if (newFileName === renameTarget.fileName) {
      message.info("文件名未变化");
      return;
    }
    try {
      const result = await api.renameNote(renameTarget.noteId, newFileName);
      if (result.refs_to_update.length > 0) {
        const ok = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: `更新 ${result.refs_to_update.length} 处路径引用？`,
            content: (
              <div style={{ fontSize: 12 }}>
                <div>重命名后其他笔记中引用此文件路径的链接将失效，</div>
                <div>需同步更新以下笔记中的引用：</div>
                <ul style={{ marginTop: 4, maxHeight: 160, overflow: "auto", paddingLeft: 18 }}>
                  {result.refs_to_update.slice(0, 20).map((r, i) => (
                    <li key={i}>
                      <code>{r.old_path}</code>
                      {" → "}
                      <code>{r.new_path}</code>
                    </li>
                  ))}
                  {result.refs_to_update.length > 20 && (
                    <li>…（共 {result.refs_to_update.length} 处，仅显示前 20）</li>
                  )}
                </ul>
              </div>
            ),
            okText: "更新引用",
            cancelText: "只重命名",
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
        if (ok) {
          await api.applyRefUpdates(result.refs_to_update as RefLoc[]);
          message.success(`已重命名为「${newFileName}」并更新 ${result.refs_to_update.length} 处引用`);
        } else {
          message.success(`已重命名为「${newFileName}」（引用未更新）`);
        }
      } else {
        message.success(`已重命名为「${newFileName}」`);
      }
      setRenameTarget(null);
      setRenameValue("");
      useVaultStore.getState().bumpTick();
    } catch (e) {
      message.error(`重命名失败：${e}`);
    }
  };

  // 删除笔记（移到 vault/.trash/ 可恢复）：二次确认 → moveNoteToTrash → 关对应 tab + 刷新。
  // 关 tab：避免删后留个指向已移走笔记的失效 tab；close 会自动把 active 切到相邻 tab。
  const submitDelete = async (noteId: string, fileName: string) => {
    const ok = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: "移到回收站？",
        content: `「${fileName}」将移到 vault/.trash/，可从回收站恢复，不会真正删除文件。`,
        okText: "移到回收站",
        okType: "danger",
        cancelText: "取消",
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
    try {
      const trashPath = await api.moveNoteToTrash(noteId);
      message.success(`已移到回收站：${trashPath}`);
      useTabsStore.getState().close(`note:${noteId}`);
      useVaultStore.getState().bumpTick();
    } catch (e) {
      message.error(`删除失败：${e}`);
    }
  };

  const onSelect = (keys: React.Key[]) => {
    const k = keys[0] as string | undefined;
    if (!k) return;
    if (k.startsWith("file:")) {
      const note = fileMap.current.get(k);
      if (note) openNoteFromMeta(note);
    } else if (k.startsWith("dir:")) {
      // 点击文件夹名也切换展开/折叠（不只点小三角）
      setExpandedKeys((prev) =>
        prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
      );
    }
  };

  if (!vault) return null;

  return (
    <div className="ob-file-panel" style={{ width }}>
      <div className="ob-panel-header">
        <span className="ob-vault-title">
          <FolderOpenOutlined style={{ marginRight: 6, color: "#eab308", flexShrink: 0 }} />
          <span className="ob-node-label">{vault.name}</span>
        </span>
        <Segmented
          size="small"
          value={sortMode}
          onChange={(v) => setSortMode(v as SortMode)}
          options={[
            { label: "123", value: "natural" },
            { label: "A-Z", value: "name" },
          ]}
        />
        <Button
          size="small"
          type="text"
          icon={<FileAddOutlined />}
          onClick={() => setCreateOpen(true)}
          title="新建笔记（创建到 00_收件箱）"
        />
      </div>

      <Modal
        open={createOpen}
        title="新建笔记"
        onCancel={() => setCreateOpen(false)}
        onOk={createNoteFile}
        okText="创建"
        cancelText="取消"
      >
        <Input
          autoFocus
          placeholder="笔记名（将创建 00_收件箱/<笔记名>.md）"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onPressEnter={createNoteFile}
        />
      </Modal>

      {/* 移动笔记弹窗：TreeSelect 选目标目录（含 vault 根作选项） */}
      <Modal
        open={!!moveTarget}
        title={`移动：${moveTarget?.fileName ?? ""}`}
        onCancel={() => {
          setMoveTarget(null);
          setMoveDestDir("");
        }}
        onOk={submitMove}
        okText="移动"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ fontSize: 12, color: "var(--ob-text-faint)", marginBottom: 6 }}>
          选择目标目录（移动后如检测到其他笔记引用了此文件路径，将提示是否同步更新引用）
        </div>
        <TreeSelect
          style={{ width: "100%" }}
          value={moveDestDir}
          onChange={(v) => setMoveDestDir(v ?? "")}
          treeData={dirTreeData}
          treeDefaultExpandAll
          placeholder="选择目标目录"
          showSearch
          treeNodeFilterProp="title"
        />
      </Modal>

      {/* 重命名笔记弹窗：Input 改文件名（不带 .md 自动补） */}
      <Modal
        open={!!renameTarget}
        title={`重命名：${renameTarget?.fileName ?? ""}`}
        onCancel={() => {
          setRenameTarget(null);
          setRenameValue("");
        }}
        onOk={submitRename}
        okText="重命名"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ fontSize: 12, color: "var(--ob-text-faint)", marginBottom: 6 }}>
          输入新文件名（不带 .md 会自动补全；目录不变）
        </div>
        <Input
          autoFocus
          placeholder="新文件名"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={submitRename}
        />
      </Modal>

      <div style={{ padding: 6 }}>
        <Input
          placeholder="搜索全库…"
          allowClear
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          size="small"
        />
      </div>
      {!isSearch && recents.length > 0 && (
        <div className="ob-recent">
          <div
            className={`ob-recent-title ${recentExpanded ? "expanded" : ""}`}
            onClick={() => setRecentExpanded((v) => !v)}
            title={recentExpanded ? "收起最近打开" : "展开最近打开"}
          >
            <CaretRightOutlined />
            <span>最近打开</span>
            <span className="ob-recent-count">{recents.length}</span>
          </div>
          {recentExpanded && (
            <div className="ob-recent-list">
              {recents.map((n) => (
                <div key={n.id} className="ob-file-item" onClick={() => openRecent(n)}>
                  <span style={{ display: "inline-flex", alignItems: "center", maxWidth: "100%" }}>
                    {fileIcon(n.file_name)}
                    <span className="ob-node-label">{n.file_name}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="ob-panel-body" ref={bodyRef}>
        {isSearch ? (
          <div className="ob-search-results">
            {searching ? (
              <Spin size="small" />
            ) : results.length === 0 ? (
              <Empty description="无匹配" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              results.map((r) => (
                <div
                  key={r.id}
                  className="ob-file-item"
                  onClick={() => openNoteFromMeta(r)}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", maxWidth: "100%" }}>
                    {fileIcon(r.file_name)}
                    <span className="ob-node-label">{r.file_name}</span>
                  </span>
                  <div className="ob-file-sub ob-node-label">{r.rel_path}</div>
                </div>
              ))
            )}
          </div>
        ) : loading && treeData.length === 0 ? (
          <Spin size="small" />
        ) : (
          <div className="ob-tree">
            <Tree
              treeData={treeData}
              expandedKeys={expandedKeys}
              onExpand={(keys) => setExpandedKeys(keys.map(String))}
              onSelect={onSelect}
              blockNode
              virtual
              height={treeHeight}
            />
          </div>
        )}
      </div>
    </div>
  );
}
