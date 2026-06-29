// 左面板：Obsidian 式「目录+文件混合树」+ 全库搜索 + 排序
// 一次拉取所有 NoteMeta + 目录，前端构建完整嵌套树。支持排序（数字自然/字母）。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Empty, Input, Segmented, Spin, Tree } from "antd";
import {
  FileImageOutlined,
  FileOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
} from "@ant-design/icons";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useTabsStore } from "../stores/tabs";
import type { NoteMeta, SearchResult } from "../types";

type SortMode = "natural" | "name";

interface TreeNode {
  key: string;
  title: ReactNode;
  isLeaf?: boolean;
  children?: TreeNode[];
  sortKey?: string;
}

function fileIcon(name: string): ReactNode {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "md" || ext === "markdown")
    return <FileTextOutlined style={{ marginRight: 6, color: "#8b5cf6" }} />;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext ?? ""))
    return <FileImageOutlined style={{ marginRight: 6, color: "#10b981" }} />;
  return <FileOutlined style={{ marginRight: 6, color: "var(--ob-text-faint)" }} />;
}

/** 排序比较：natural=数字感知（2 < 10），name=纯字母 */
function makeCompare(mode: SortMode) {
  if (mode === "name") {
    return (a: string, b: string) => a.localeCompare(b, "zh-Hans", { sensitivity: "base" });
  }
  return (a: string, b: string) =>
    a.localeCompare(b, "zh-Hans", { numeric: true, sensitivity: "base" });
}

function childDirs(dir: string, dirs: string[]): string[] {
  return dirs.filter((d) => {
    if (dir === "") return d !== "" && !d.includes("/");
    return d.startsWith(dir + "/") && !d.slice(dir.length + 1).includes("/");
  });
}

function isOpen(dir: string, expanded: string[]): boolean {
  return expanded.includes("dir:" + dir);
}

export default function FilePanel({ width }: { width: number }) {
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const openNote = useTabsStore((s) => s.openNote);

  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>(["dir:"]);
  const [loading, setLoading] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("natural");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const isSearch = query.trim().length > 0;

  const fileMap = useRef<Map<string, NoteMeta>>(new Map());

  useEffect(() => {
    if (!vault) return;
    setLoading(true);
    Promise.all([api.listDirs(vault.id), api.listAllNotesMeta(vault.id)])
      .then(([dirs, notes]) => {
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
        const build = (dir: string): TreeNode => {
          const subs = childDirs(dir, dirs);
          const dirNodes: TreeNode[] = subs.map((sd) => ({
            key: "dir:" + sd,
            sortKey: sd.split("/").pop() ?? sd,
            title: (
              <span>
                {(dir === "" || isOpen(dir, expandedKeys)) ? (
                  <FolderOpenOutlined style={{ marginRight: 6, color: "#eab308" }} />
                ) : (
                  <FolderOutlined style={{ marginRight: 6, color: "#eab308" }} />
                )}
                {sd.split("/").pop() ?? sd}
              </span>
            ),
            isLeaf: false,
            children: [],
          }));
          // 先递归填子目录 children
          subs.forEach((sd, i) => {
            dirNodes[i].children = build(sd).children;
          });
          const fileNodes: TreeNode[] = (notesByDir.get(dir) ?? []).map((n) => {
            const k = "file:" + n.id;
            fileMap.current.set(k, n);
            return {
              key: k,
              sortKey: n.file_name,
              title: (
                <span>
                  {fileIcon(n.file_name)}
                  {n.file_name}
                </span>
              ),
              isLeaf: true,
            };
          });
          // 混合排序（目录+文件按名，Obsidian 式）
          const all = [...dirNodes, ...fileNodes].sort((a, b) =>
            cmp(a.sortKey ?? "", b.sortKey ?? "")
          );
          const isRoot = dir === "";
          const name = isRoot ? <strong>{vault.name}</strong> : dir.split("/").pop() ?? dir;
          return {
            key: "dir:" + dir,
            sortKey: dir,
            title: (
              <span>
                {isRoot || isOpen(dir, expandedKeys) ? (
                  <FolderOpenOutlined style={{ marginRight: 6, color: "#eab308" }} />
                ) : (
                  <FolderOutlined style={{ marginRight: 6, color: "#eab308" }} />
                )}
                {name}
              </span>
            ),
            isLeaf: false,
            children: all,
          };
        };
        setTreeData([build("")]);
      })
      .catch(() => setTreeData([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, watcherTick, sortMode]);

  useEffect(() => {
    if (!vault) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    const h = setTimeout(() => {
      api
        .searchNotes(vault.id, q, 50)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, query]);

  const onSelect = (keys: React.Key[]) => {
    const k = keys[0] as string | undefined;
    if (k && k.startsWith("file:")) {
      const note = fileMap.current.get(k);
      if (note) {
        openNote({
          id: note.id,
          title: note.title,
          file_name: note.file_name,
          rel_path: note.rel_path,
        });
      }
    }
  };

  if (!vault) return null;

  return (
    <div className="ob-file-panel" style={{ width }}>
      <div className="ob-panel-header">
        <span>资源管理器</span>
        <Segmented
          size="small"
          value={sortMode}
          onChange={(v) => setSortMode(v as SortMode)}
          options={[
            { label: "123", value: "natural" },
            { label: "A-Z", value: "name" },
          ]}
        />
      </div>
      <div style={{ padding: 6 }}>
        <Input
          placeholder="搜索全库…"
          allowClear
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          size="small"
        />
      </div>
      <div className="ob-panel-body">
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
                onClick={() =>
                  openNote({
                    id: r.id,
                    title: r.title,
                    file_name: r.file_name,
                    rel_path: r.rel_path,
                  })
                }
              >
                <span style={{ display: "inline-flex", alignItems: "center" }}>
                  {fileIcon(r.file_name)}
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.file_name}
                  </span>
                </span>
                <div className="ob-file-sub">{r.rel_path}</div>
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
            />
          </div>
        )}
      </div>
    </div>
  );
}
