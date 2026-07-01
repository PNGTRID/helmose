// 左面板：Obsidian 式「目录+文件混合树」+ 全库搜索 + 排序
// 顶部显示 Vault 名；树从根目录内容开始（顶层文件夹+根文件）；节点文字单行省略号。
import "./FilePanel.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Empty, Input, message, Modal, Segmented, Spin, Tree } from "antd";
import { FileAddOutlined, FolderOpenOutlined, FolderOutlined } from "@ant-design/icons";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { openNoteFromMeta } from "../utils/note";
import { childDirs, fileIcon, makeCompare, type SortMode } from "../utils/tree";
import type { NoteMeta, SearchResult } from "../types";

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

  const [treeData, setTreeData] = useState<TreeNode[]>([]);
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
      .then(([dirs, notes]) => {
        if (cancelled) return;
        fileMap.current.clear();
        const notesByDir = new Map<string, NoteMeta[]>();
        for (const n of notes) {
          const d = n.rel_path.includes("/")
            ? n.rel_path.slice(0, n.rel_path.lastIndexOf("/"))
            : "";
          if (!notesByDir.has(d)) notesByDir.set(d, []);
          notesByDir.get(d)!.push(n);
        }
        const cmp = makeCompare(sortMode);

        // 构建某目录的直接子（目录 + 文件，混合排序）
        const buildChildren = (dir: string): TreeNode[] => {
          const subs = childDirs(dir, dirs);
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
            return {
              key: k,
              sortKey: n.file_name,
              title: (
                <span className="ob-node-title">
                  {fileIcon(n.file_name)}
                  <span className="ob-node-label">{n.file_name}</span>
                </span>
              ),
              isLeaf: true,
            };
          });
          return [...dirNodes, ...fileNodes].sort((a, b) => cmp(a.sortKey ?? "", b.sortKey ?? ""));
        };

        setTreeData(buildChildren(""));
        // 首次默认展开顶层目录（之后保留用户展开状态）
        setExpandedKeys((prev) =>
          prev.length ? prev : childDirs("", dirs).map((d) => "dir:" + d)
        );
      })
      .catch(() => {
        if (cancelled) return;
        setTreeData([]);
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
      <div style={{ padding: 6 }}>
        <Input
          placeholder="搜索全库…"
          allowClear
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          size="small"
        />
      </div>
      <div className="ob-panel-body" ref={bodyRef}>
        {isSearch ? (
          searching ? (
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
          )
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
