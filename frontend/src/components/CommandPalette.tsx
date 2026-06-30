// 命令面板：Ctrl/⌘+P 触发，全库搜索（FTS5）→ 跳转。从 App.tsx 拆出，自管状态。
import { useEffect, useState } from "react";
import { Input, List, Modal, Typography } from "antd";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useTabsStore } from "../stores/tabs";
import { openNoteFromMeta } from "../utils/note";
import type { SearchResult } from "../types";

const { Text } = Typography;

export default function CommandPalette() {
  const open = useTabsStore((s) => s.paletteOpen);
  const setPalette = useTabsStore((s) => s.setPalette);
  const vault = useVaultStore((s) => s.vault);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    if (!open) {
      setQ("");
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (!vault) return;
    const kw = q.trim();
    if (!kw) {
      setResults([]);
      return;
    }
    const h = setTimeout(() => {
      api.searchNotes(vault.id, kw, 20).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, vault?.id, open]);

  const pick = (r: SearchResult) => {
    openNoteFromMeta(r);
    setPalette(false);
  };

  return (
    <Modal
      open={open}
      onCancel={() => setPalette(false)}
      footer={null}
      closable={false}
      width={560}
      styles={{ body: { padding: 12 } }}
    >
      <Input.Search
        autoFocus
        placeholder="跳转到笔记…（输入关键词，复用 FTS5 全库搜索）"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <List
        style={{ maxHeight: 360, overflow: "auto" }}
        size="small"
        dataSource={results}
        locale={{ emptyText: q.trim() ? "无匹配" : "输入关键词搜索笔记" }}
        renderItem={(r) => (
          <List.Item style={{ cursor: "pointer" }} onClick={() => pick(r)}>
            <List.Item.Meta
              title={<Text ellipsis>{r.title ?? r.file_name}</Text>}
              description={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {r.rel_path}
                </Text>
              }
            />
          </List.Item>
        )}
      />
    </Modal>
  );
}
