// 右面板：大纲 + 反向链接 + 标签（可折叠，置底）。
// 大纲/反链仅 active note tab 时填充；标签全库始终显示，可折叠。宽度由 App 传入（可拖拽）。
import { useEffect, useRef, useState } from "react";
import { Spin } from "antd";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useTabsStore } from "../stores/tabs";
import { openNoteFromMeta } from "../utils/note";
import type { SearchResult, TagCount } from "../types";

export default function SidePanel({ width }: { width: number }) {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const outline = useTabsStore((s) => s.activeOutline);
  const backlinks = useTabsStore((s) => s.activeBacklinks);
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const active = tabs.find((t) => t.id === activeId);
  const isNote = !!active && active.type === "note";

  // 标签（全库，可折叠，置底）
  const [tags, setTags] = useState<TagCount[]>([]);
  const [tagsOpen, setTagsOpen] = useState(true); // 默认展开，点击标题收起
  const [tagQuery, setTagQuery] = useState<string | null>(null);
  const [tagResults, setTagResults] = useState<SearchResult[]>([]);
  const [tagLoading, setTagLoading] = useState(false);
  // 请求序号：仅最新一次标签搜索的回调才 setState，避免快速连点时旧响应覆盖新结果
  const tagReqIdRef = useRef(0);

  useEffect(() => {
    if (!vault) return;
    // cancelled flag：丢弃过期响应，避免竞态覆盖（与 useAllNotesMeta 一致）
    let cancelled = false;
    api
      .getTagsStats(vault.id)
      .then((res) => {
        if (!cancelled) setTags(res);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[SidePanel] 标签加载失败", e);
        setTags([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, watcherTick]);

  const onTagClick = async (t: string) => {
    if (!vault) return;
    const myId = ++tagReqIdRef.current;
    setTagQuery(t);
    setTagLoading(true);
    try {
      const res = await api.searchNotes(vault.id, t, 50);
      // 仅当本次仍是最新请求时才落库，丢弃过期响应（连点竞态守卫）
      if (tagReqIdRef.current !== myId) return;
      setTagResults(res);
    } catch (e) {
      if (tagReqIdRef.current !== myId) return;
      console.error("[SidePanel] 标签搜索失败", e);
      setTagResults([]);
    } finally {
      if (tagReqIdRef.current === myId) setTagLoading(false);
    }
  };

  return (
    <div className="ob-side-panel" style={{ width }}>
      <div className="ob-side-scroll">
        {isNote ? (
          <>
            <div className="ob-side-section">
              <div className="ob-side-title">大纲</div>
              {outline.length === 0 ? (
                <div style={{ padding: "4px 12px", color: "var(--ob-text-faint)", fontSize: 12 }}>
                  无标题
                </div>
              ) : (
                outline.map((o, i) => (
                  <div key={i} className={`ob-side-link ob-outline-${o.level}`}>
                    {o.text}
                  </div>
                ))
              )}
            </div>

            <div className="ob-side-section">
              <div className="ob-side-title">反向链接（{backlinks.length}）</div>
              {backlinks.length === 0 ? (
                <div style={{ padding: "4px 12px", color: "var(--ob-text-faint)", fontSize: 12 }}>
                  无笔记链接到本文
                </div>
              ) : (
                backlinks.map((b, i) => (
                  <div
                    key={i}
                    className="ob-side-link"
                    onClick={() => openNoteFromMeta(b.source)}
                  >
                    {b.source.title ?? b.source.file_name}
                    <div className="ob-side-sub">{b.source.rel_path}</div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="ob-side-section">
            <div className="ob-side-title">大纲 / 反向链接</div>
            <div style={{ padding: "4px 12px", color: "var(--ob-text-faint)", fontSize: 12 }}>
              打开一篇笔记后，此处显示其大纲与反向链接。
            </div>
          </div>
        )}

        {/* 标签：可折叠，置底。点击标题展开/收起 */}
        <div className="ob-side-section">
          <div
            className="ob-side-title"
            role="button"
            tabIndex={0}
            aria-expanded={tagsOpen}
            style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
            onClick={() => setTagsOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setTagsOpen((v) => !v);
              }
            }}
          >
            <span style={{ display: "inline-block", width: 10 }}>{tagsOpen ? "▾" : "▸"}</span>
            标签（{tags.length}）
          </div>
          {tagsOpen && (
            <>
              {tags.length === 0 ? (
                <div style={{ padding: "4px 12px", color: "var(--ob-text-faint)", fontSize: 12 }}>
                  无标签
                </div>
              ) : (
                <div style={{ padding: "2px 8px 8px" }}>
                  {tags.slice(0, 80).map(([t, c]) => (
                    <span
                      key={t}
                      className="ob-tag"
                      style={tagQuery === t ? { background: "var(--ob-accent)", color: "#fff" } : undefined}
                      onClick={() => onTagClick(t)}
                    >
                      {t} · {c}
                    </span>
                  ))}
                </div>
              )}
              {tagQuery && (
                <div style={{ padding: "0 4px 4px" }}>
                  <div className="ob-side-title">「{tagQuery}」的笔记</div>
                  {tagLoading ? (
                    <div style={{ padding: "4px 12px" }}>
                      <Spin size="small" />
                    </div>
                  ) : tagResults.length === 0 ? (
                    <div style={{ padding: "4px 12px", color: "var(--ob-text-faint)", fontSize: 12 }}>
                      无
                    </div>
                  ) : (
                    tagResults.map((r) => (
                      <div
                        key={r.id}
                        className="ob-file-item"
                        style={{ margin: "0 4px" }}
                        onClick={() => openNoteFromMeta(r)}
                      >
                        <div
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.title ?? r.file_name}
                        </div>
                        <div className="ob-file-sub">{r.rel_path}</div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
