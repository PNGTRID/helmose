// 右面板：大纲 + 反向链接（仅 active note tab 时填充）
import { useTabsStore } from "../stores/tabs";

export default function SidePanel() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const outline = useTabsStore((s) => s.activeOutline);
  const backlinks = useTabsStore((s) => s.activeBacklinks);
  const openNote = useTabsStore((s) => s.openNote);
  const active = tabs.find((t) => t.id === activeId);

  if (!active || active.type !== "note") {
    return (
      <div className="ob-side-panel">
        <div className="ob-side-scroll">
          <div className="ob-side-title">大纲 / 反向链接</div>
          <div style={{ padding: "4px 12px", color: "var(--ob-text-faint)", fontSize: 12 }}>
            打开一篇笔记后，此处显示其大纲与反向链接。
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ob-side-panel">
      <div className="ob-side-scroll">
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
                onClick={() =>
                  openNote({
                    id: b.source.id,
                    title: b.source.title,
                    file_name: b.source.file_name,
                    rel_path: b.source.rel_path,
                  })
                }
              >
                {b.source.title ?? b.source.file_name}
                <div className="ob-side-sub">{b.source.rel_path}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
