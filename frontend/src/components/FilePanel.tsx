// 左面板：Obsidian 式「目录+文件混合树」（完整树，一次构建）+ 全库搜索 + 标签
// 一次拉取所有 NoteMeta（无正文）+ 全部目录，前端构建完整嵌套树。
// 任意目录展开即可见其子文件夹与文件（无需按需加载，避免"看不到深层 md"）。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Empty, Input, Spin, Tree, Typography } from "antd";
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
import type { NoteMeta, SearchResult, TagCount } from "../types";

const { Text } = Typography;

interface TreeNode {
  key: string; // "dir:<path>" 或 "file:<id>"
  title: ReactNode;
  isLeaf?: boolean;
  children?: TreeNode[];
}

/** 按扩展名返回文件图标 */
function fileIcon(name: string): ReactNode {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "md" || ext === "markdown")
    return <FileTextOutlined style={{ marginRight: 6, color: "#8b5cf6" }} />;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext ?? ""))
    return <FileImageOutlined style={{ marginRight: 6, color: "#10b981" }} />;
  return <FileOutlined style={{ marginRight: 6, color: "var(--ob-text-faint)" }} />;
}

/** 某目录的直接子目录（从扁平 dirs 列表） */
function childDirs(dir: string, dirs: string[]): string[] {
  return dirs.filter((d) => {
    if (dir === "") return d !== "" && !d.includes("/");
    return d.startsWith(dir + "/") && !d.slice(dir.length + 1).includes("/");
  });
}

/** 判断 dir 是否在 expandedKeys 中（含祖先链）——用于目录开/合图标 */
function isOpen(dir: string, expanded: string[]): boolean {
  return expanded.includes("dir:" + dir);
}

export default function FilePanel() {
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const openNote = useTabsStore((s) => s.openNote);

  const [tags, setTags] = useState<TagCount[]>([]);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>(["dir:"]);
  const [loading, setLoading] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const isSearch = query.trim().length > 0;

  const fileMap = useRef<Map<string, NoteMeta>>(new Map());

  // 一次拉取目录 + 全部笔记元数据 + 标签，构建完整树
  useEffect(() => {
    if (!vault) return;
    setLoading(true);
    Promise.all([
      api.listDirs(vault.id),
      api.listAllNotesMeta(vault.id),
      api.getTagsStats(vault.id).catch(() => []),
    ])
      .then(([dirs, notes, tg]) => {
        setTags(tg);
        fileMap.current.clear();

        // 按父目录分组文件
        const notesByDir = new Map<string, NoteMeta[]>();
        for (const n of notes) {
          const d = n.rel_path.includes("/")
            ? n.rel_path.slice(0, n.rel_path.lastIndexOf("/"))
            : "";
          if (!notesByDir.has(d)) notesByDir.set(d, []);
          notesByDir.get(d)!.push(n);
        }

        // 递归构建完整树
        const build = (dir: string): TreeNode => {
          const subs = childDirs(dir, dirs);
          const dirChildren = subs.map(build);
          const fileNodes: TreeNode[] = (notesByDir.get(dir) ?? []).map((n) => {
            const k = "file:" + n.id;
            fileMap.current.set(k, n);
            return {
              key: k,
              title: (
                <span>
                  {fileIcon(n.file_name)}
                  {n.file_name}
                </span>
              ),
              isLeaf: true,
            };
          });
          const isRoot = dir === "";
          const name = isRoot ? <strong>{vault.name}</strong> : dir.split("/").pop() ?? dir;
          return {
            key: "dir:" + dir,
            title: (
              <span>
                {(isRoot || isOpen(dir, expandedKeys)) ? (
                  <FolderOpenOutlined style={{ marginRight: 6, color: "#eab308" }} />
                ) : (
                  <FolderOutlined style={{ marginRight: 6, color: "#eab308" }} />
                )}
                {name}
              </span>
            ),
            isLeaf: false,
            children: [...dirChildren, ...fileNodes],
          };
        };
        setTreeData([build("")]);
      })
      .catch(() => setTreeData([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, watcherTick]);

  // 搜索（FTS）
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
    <div className="ob-file-panel">
      <div className="ob-panel-header">
        <span>资源管理器</span>
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
          <>
            <div className="ob-tree">
              <Tree
                treeData={treeData}
                expandedKeys={expandedKeys}
                onExpand={(keys) => setExpandedKeys(keys.map(String))}
                onSelect={onSelect}
                blockNode
              />
            </div>

            <div
              style={{
                marginTop: 14,
                marginBottom: 4,
                fontSize: 11,
                color: "var(--ob-text-faint)",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              标签
            </div>
            <div>
              {tags.length === 0 ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  无标签
                </Text>
              ) : (
                tags.slice(0, 40).map(([t, c]) => (
                  <span key={t} className="ob-tag" onClick={() => setQuery(t)}>
                    {t} · {c}
                  </span>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
