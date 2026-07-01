// 底部状态栏：当前 vault + active tab 标题 + 今日笔记数 + 主题切换 + 快捷键提示
import "./StatusBar.css";
import { Button, Tooltip } from "antd";
import { MoonOutlined, SunOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useTabsStore } from "../stores/tabs";
import { useVaultStore } from "../stores/vault";
import { useThemeStore } from "../stores/theme";
import { useAllNotesMeta } from "../hooks/useAllNotesMeta";

export default function StatusBar() {
  const vault = useVaultStore((s) => s.vault);
  const stats = useVaultStore((s) => s.stats);
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const { notes } = useAllNotesMeta();
  const active = tabs.find((t) => t.id === activeId);

  const today = dayjs().format("YYYY-MM-DD");
  const todayCount = notes.filter((n) => n.date_iso === today).length;

  return (
    <div className="ob-statusbar">
      <span>
        {vault?.name ?? ""}
        {active ? `  ·  ${active.title}` : "  ·  无打开的标签页"}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {stats && (
          <span style={{ color: "var(--ob-text-faint)" }}>
            {stats.notes} 笔记 · 今日 {todayCount}
          </span>
        )}
        <Tooltip title={theme === "dark" ? "切换到亮色" : "切换到暗色"}>
          <Button
            size="small"
            type="text"
            icon={theme === "dark" ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggleTheme}
          />
        </Tooltip>
        <span>Helmose v0.2  ·  ⌘P 搜索 · ⌘J 今日 · ⌘B 侧栏 · ? 帮助</span>
      </span>
    </div>
  );
}
