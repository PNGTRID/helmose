// 底部状态栏：当前 vault + active tab 标题 + 版本提示
import { useTabsStore } from "../stores/tabs";
import { useVaultStore } from "../stores/vault";

export default function StatusBar() {
  const vault = useVaultStore((s) => s.vault);
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const active = tabs.find((t) => t.id === activeId);

  return (
    <div className="ob-statusbar">
      <span>
        {vault?.name ?? ""}
        {active ? `  ·  ${active.title}` : "  ·  无打开的标签页"}
      </span>
      <span>Helmose v0.2  ·  Ctrl/⌘+P 命令面板</span>
    </div>
  );
}
