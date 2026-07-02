# Helmose UI 升级方案 · 专家团整合版

> **版本**：v1.0 · 2026-07-02
> **状态**：已决策，可直接分阶段实施
> **方法**：4 位专家（桌面工具UX交互 / antd视觉设计 / Tauri+React前端落地 / 人生OS产品顾问）独立产出 → 交叉校验 → 冲突裁决 → 整合
> **范围**：纯前端样式基础设施升级 + 交互反模式修复 + GTD 动线补齐；零 Rust 业务改动（仅 GTD 迁移工具碰 vault 原文，强制 dry-run+备份）

---

## 〇、交叉校验与关键决策裁决

### 强共识（直接采纳）

| 共识点 | 提出方 |
|---|---|
| ① 删除 PlannerPage "保存"假按钮（onClick 只 toast，反模式） | 交互专家，三方无异议 |
| ② 设计 token 单一来源，消除 7 种紫色变体散落 | 视觉 + 工程 + 产品三方一致 |
| ③ AI 卡片统一语言（克制→鲜明反差 + 来源角标 + 独立样式） | 产品顾问首创，交互专家补缓存复用 |
| ④ 品牌锚形 SVG 替换 LinkOutlined（当前 anchor 映射到链条图标，语义错位） | 三方一致 |
| ⑤ 补 mount/unmount/拖拽落位动效 | 视觉 + 交互一致 |
| ⑥ 空态品牌化（替换 antd 默认 Empty，空态=下一步行动） | 产品 + 交互一致 |

### 冲突裁决

**冲突 1 · 主色色值** → ✅ 采纳 `#6D28D9`（浅）/ `#A78BFA`（深）
- 视觉师与产品顾问独立收敛到同一值，交叉验证
- 现有 `#7C3AED` 在深色背景偏暗发闷，提亮后对比度更好
- "比 Obsidian 更克制"符合差异化定位
- 同时采纳产品顾问的深海墨蓝 `#0b1f3a→#11274a` 作为 AI 卡暗色渐变底（叙事记忆点）

**冲突 2 · antd v6 cssVar 模式** → ✅ 分两阶段
- 阶段一（P0）：**不开 cssVar**，用 `tokens.ts` 单一来源驱动 antd token + CSS 变量（双轨同源）。零风险
- 阶段二（P1）：先修复 canvas 取色（ForceGraph/TimelineView 改读 `tokens.color.brand` 直取 hex），再试点 cssVar 全量开启
- 理由：cssVar 模式下 `token.colorPrimary` 变 CSS 变量字符串，canvas/SVG `fill` 不解析会取色错乱；cssVar 收益（主题切换零重渲染）在桌面端非瓶颈

**冲突 3 · AppIcon 收敛范围** → ✅ 务实派
- P0 强制收敛：Ribbon / TabBar / StatusBar（导航品牌核心，3 文件）
- 保留直 import：antd 组件原生 `icon` prop 场景（Button/Menu，主题已跟随）
- P2 可选：其余装饰性直 import（收益递减，靠 code review 兜底）

**冲突 4 · 圆角默认值** → ✅ 采纳 sm4/md8/lg12 体系
- 视觉师论证：6px 是"不圆不方的尴尬值"
- token 化后改一处，可回退

---

## 一、问题诊断

### 1.1 设计系统缺位（根因）
- antd ConfigProvider 形同虚设：仅 `colorPrimary` + `borderRadius` 两个 token（[main.tsx:19](frontend/src/main.tsx#L19)）
- 双轨漂移：antd token 与 `--ob-*` CSS 变量各自维护，`#7C3AED`（token）与 `#7c3aed`（CSS）大小写都不一致
- 无 spacing / radius / typography / elevation / motion scale：散点 `gap:6/8/12/14/16`、`border-radius:4/6/8/10`、`fontSize:10~40` 混用

### 1.2 视觉质感粗糙（最伤付费意愿）
- 无 elevation 体系：14 处 box-shadow 都是 hover 微影，卡片/弹层缺层级感
- 动效稀薄：仅 16 处 transition 都是极短色变，无 mount/unmount/拖拽/页面切换动效
- 品牌识别弱：anchor 映射到 LinkOutlined（链条非锚），无 Logo 体系、无启动屏品牌化
- 空态粗糙：全用 antd 默认 Empty，无品牌化、无引导动作

### 1.3 交互反模式与 bug（高频路径）
- **PlannerPage "保存"假按钮**（[PlannerPage.tsx:1391-1397](frontend/src/pages/PlannerPage.tsx#L1391-L1397)）：onClick 只 toast 不写盘
- **quickAdd 硬编码 emoji 拼装**（[PlannerPage.tsx:481-483](frontend/src/pages/PlannerPage.tsx#L481-L483)）：绕过 `buildTaskBullet`，破坏 CLAUDE.md 契约
- **DragOverlay 只显"移动中…"文字**（[PlannerPage.tsx:781-783](frontend/src/pages/PlannerPage.tsx#L781-L783)）
- **AI 教练每次进页空白**：后端有 `ai_generations` 缓存表前端不读
- **TaskCard 拖拽热区与点击冲突**（[TaskCard.tsx:54-59](frontend/src/components/tasks/TaskCard.tsx#L54-L59)）

### 1.4 Obsidian 式工作台能力缺口
- 键盘流薄弱：仅 5 个快捷键（P/J/B/\/?）
- TabBar 缺标准能力：无拖拽重排、无溢出滚动、无中键关闭、无 reopen closed tab
- FilePanel 缺口：无删除文件、无"最近打开"、1.9 万 md 一次性入内存建树
- 收集箱动线断裂：GTD "收集箱→四象限流转"根本不存在

### 1.5 商业化与留存准备不足
- AI 模块无视觉区分度，未来 Pro 分层无视觉地基
- Onboarding 是冷启动配置而非价值展示
- 无差异化记忆点

---

## 二、设计规范（裁决后统一版）

### 2.1 色彩

| 类别 | Token | 浅色 | 深色 | 备注 |
|---|---|---|---|---|
| **主色** | `--ob-primary` | `#6D28D9` | `#A78BFA` | 替换所有紫色变体 |
| | `--ob-primary-hover` | `#5B21B6` | `#C4B5FD` | |
| | `--ob-primary-bg` | `#F5F3FF` | `#2A2440` | 选中底、AI 卡淡底、focus ring |
| **背景** | `--ob-app-bg` | `#FAFAFA` | `#1A1A1E` | 应用底层 |
| | `--ob-surface` | `#FFFFFF` | `#1F1F24` | 卡片面 |
| | `--ob-overlay` | `#FFFFFF` | `#131316` | 弹窗/抽屉（最深） |
| **文本** | `--ob-text` | `#3A3B3F` | `#CECED5` | 正文（非纯黑/纯白） |
| | `--ob-text-strong` | `#222326` | `#EEEEF1` | 标题 |
| | `--ob-text-muted` | `#5F6066` | `#9C9CA5` | 次要 |
| | `--ob-text-faint` | `#8E8F94` | `#5C5C66` | 三级 |
| **边框** | `--ob-border` | `#DCDDE0` | `#2E2E35` | |
| | `--ob-border-strong` | `#C4C5C9` | `#3D3D45` | |
| **四象限** | q1/q2/q3/q4 | `#DC2626`/`#2563EB`/`#D97706`/`#16A34A` | `#F87171`/`#60A5FA`/`#FBBF24`/`#4ADE80` | 与 error/info/warning/success 复用，提升为全局 token |
| **AI 叙事** | `--ob-ai-grad-dark` | — | `#0b1f3a→#11274a` | 深海墨蓝渐变（记忆点） |

**强制收口清单**（grep 替换为 `var(--ob-primary*)`）：
`#7C3AED`(main.tsx) / `#722ED1`(GridView.css) / `#8B5CF6`(tree.tsx) / `#9D7CF0`(ForceGraph) / `#B394F5` / `#6D28D9` 各处散落。

### 2.2 间距 / 圆角 / 字体

```
间距：--ob-space-2xs(4) / xs(8) / sm(12) / md(16) / lg(24) / xl(32) / 2xl(48)
圆角：--ob-radius-sm(4) / md(8) / lg(12) / xl(16) / full(9999)   ← 默认 md=8
字号：2xs(11) / xs(12) / sm(13) / base(14) / md(15) / lg(16) / xl(18) / 2xl(22) / 3xl(28)
字体栈：-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei UI", "Segoe UI", sans-serif
等宽：ui-monospace, "SF Mono", Menlo, Consolas, monospace（统计/日期用，配 tabular-nums）
```

### 2.3 Elevation（5 级，深色更重）

```
浅色：e1(0 1px 2px/.04) → e2(hover) → e3(模态/抽屉) → e4(大模态/命令面板) → e5(全屏)
深色：阴影 rgba 黑度递增（0.20→0.60），因深色背景吸光
focus ring：--ob-ring-focus: 0 0 0 3px var(--ob-primary-bg)   ← 修复 4 处硬编码 rgba(124,58,237,.x)
```

### 2.4 Motion

```
fast(120ms hover) / base(200ms 默认) / slow(320ms 模态) / slower(480ms 页面切换)
ease-out(默认出场) / ease-in(销毁) / ease-spring(拖拽归位，消除"啪"感)
```

### 2.5 图标规范
- 导航核心强制 AppIcon：Ribbon / TabBar / StatusBar
- antd 原生 icon prop 保留：Button / Menu 等
- AI 自定义 SVG：viewBox `0 0 1024 1024`、strokeWidth 32-48、`currentColor`、`registerIcon("ai-*", <SVG/>)`
- 品牌 anchor 真锚 SVG（停泊/归处语义）

---

## 三、核心页面改版思路

### 3.1 Ribbon + 整体外壳
- Ribbon 56-72px，背景 `--ob-surface`，按钮 40×40，active 用**左侧 2px 主色 indicator + primary-bg 底**
- 原生 `title` → antd Tooltip 带快捷键（`mouseEnterDelay={0.3}`）
- 品牌 anchor 做可点全局菜单（关于/检查更新/重置/退出）
- Tauri 窗口融合：标题栏色与 Ribbon 同色

### 3.2 PlannerPage（视觉重心）· 四项必改
1. 删假保存按钮 → 底部细字"所有改动已自动保存"
2. DragOverlay 克隆任务卡 + `rotate(2deg)` + e3 阴影；isOver 按象限原色加深 + inset 3px；加 KeyboardSensor
3. quickAdd 复用 buildTaskBullet（修复契约）+ Esc 清草稿 + inline 标记（`task @明天 !2 #项目`）+ antd DatePicker 替换原生 date input
4. 收集箱动线：方向 A 真 GTD 流转（见 §七）

### 3.3 TodayPage（AI 教练）· aha moment
- 挂载先读 `ai_generations` 缓存作 initial（消除每次空白等待）
- AI 卡首句强化"**我读了你的 1,847 篇笔记**"——与 Notion AI 的根本差异
- 4 统计卡用 `--ob-font-mono` + `tabular-nums`，逾期用 `--ob-error`
- AI 卡独立语言：3px 主色左边框 + primary-bg 底 + 来源角标（AI 紫/Heuristic 灰/Cache 蓝）+ "克制→鲜明"入场动效

### 3.4 OnboardingPage · 30 秒感受价值
- 三段式：品牌承诺帧 → 三路径卡（我有 vault / 从 Life OS 模板 / 体验 Demo vault）→ 主界面内联气泡引导
- 主 CTA 用 primary + e2 hover 抬升

### 3.5 空态品牌化
新建 `EmptyState` 组件，5 场景（无笔记/无任务/无项目/无反链/AI 无结果），统一线性几何插画 + 下一步行动按钮。

### 3.6 差异化记忆点（长线）
1. 四象限重力视觉（v0.2 可做）：重要紧急象限淡红底 + 完成收束动画
2. AI 卡片反差动效（v0.2 P1）：placeholder shimmer → 产出内发光收敛
3. "航线"主线视觉（v0.3，依赖主线判定稳定）

---

## 四、前端落地代码（精选 P0 必做片段）

### 4.1 `frontend/src/theme/tokens.ts`（单一来源）

```ts
export const tokens = {
  color: {
    brand: "#6D28D9", brandHover: "#5B21B6",
    accent: "#6D28D9", accentMod: "#F5F3FF",
    bg: "#FFFFFF", bgMod: "#FAFAFA", bgModHover: "#F4F4F5",
    border: "#DCDDE0", borderStrong: "#C4C5C9",
    text: "#3A3B3F", textMuted: "#5F6066", textFaint: "#8E8F94",
    success: "#16A34A", warning: "#D97706", error: "#DC2626", info: "#2563EB",
    q1: "#DC2626", q2: "#2563EB", q3: "#D97706", q4: "#16A34A",
  },
  spacing: [0, 4, 8, 12, 16, 24, 32, 48, 64] as const,
  radius: { sm: 4, md: 8, lg: 12, xl: 16, pill: 999 },
  typography: {
    fontFamilyBase: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei UI", "Segoe UI", sans-serif',
    fontFamilyMono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    fontSize: { xs: 11, sm: 12, base: 14, lg: 16, xl: 20, xxl: 24, display: 28 },
  },
  elevation: {
    sm: "0 1px 2px rgba(15,16,18,0.04)",
    md: "0 2px 8px rgba(15,16,18,0.08)",
    lg: "0 6px 24px rgba(15,16,18,0.12)",
  },
  motion: { fast: "0.12s", base: "0.2s", slow: "0.32s",
            easeOut: "cubic-bezier(0.16,1,0.3,1)", easeSpring: "cubic-bezier(0.34,1.56,0.64,1)" },
} as const;

export const darkTokens = {
  color: {
    brand: "#A78BFA", brandHover: "#C4B5FD", accent: "#A78BFA", accentMod: "#2A2440",
    bg: "#1A1A1E", bgMod: "#1F1F24", bgModHover: "#26262C",
    border: "#2E2E35", borderStrong: "#3D3D45",
    text: "#CECED5", textMuted: "#9C9CA5", textFaint: "#5C5C66",
    success: "#4ADE80", warning: "#FBBF24", error: "#F87171", info: "#60A5FA",
    q1: "#F87171", q2: "#60A5FA", q3: "#FBBF24", q4: "#4ADE80",
  },
} as const;
```

### 4.2 ConfigProvider 接入（不开 cssVar）

```tsx
// main.tsx —— ThemeShell 内
function ThemeShell({ children }: { children: React.ReactNode }) {
  const mode = useThemeStore((s) => s.theme);
  const isDark = mode === "dark";
  const t = isDark ? darkTokens.color : tokens.color;
  return (
    <ConfigProvider locale={zhCN} theme={{
      algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: t.brand, colorSuccess: t.success, colorWarning: t.warning,
        colorError: t.error, colorInfo: t.info,
        borderRadius: tokens.radius.md, borderRadiusLG: tokens.radius.lg, borderRadiusSM: tokens.radius.sm,
        fontSize: tokens.typography.fontSize.base, controlHeight: 32,
        colorBgContainer: t.bg, colorBgLayout: t.bgMod, colorBgElevated: t.bg,
        colorBorder: t.border, colorBorderSecondary: t.borderStrong,
        colorText: t.text, colorTextSecondary: t.textMuted, colorTextTertiary: t.textFaint,
        fontFamily: tokens.typography.fontFamilyBase,
      },
      components: {
        Card: { headerHeight: 44, paddingLG: tokens.spacing[4], boxShadowTertiary: "none" },
        Button: { controlHeight: 32, paddingInline: tokens.spacing[3], primaryShadow: "none" },
        Segmented: { itemSelectedBg: t.accentMod, itemSelectedColor: t.brand, controlHeight: 28 },
        Tag: { defaultBg: t.accentMod },
        Input: { activeShadow: `0 0 0 2px ${t.accentMod}` },
      },
      // 不开 cssVar —— 待 canvas 取色修复后阶段二开启
    }}>
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}
```

### 4.3 假保存按钮修复

```tsx
// 删除原 L1391-1397 的假保存按钮，替换为底部细字提示
<div style={{ textAlign: "center", color: "var(--ob-text-faint)", fontSize: 12, padding: "8px 0" }}>
  <AppIcon name="check" size={12} /> 所有改动已自动保存
</div>
```

### 4.4 quickAdd 复用 buildTaskBullet

```ts
import { buildTaskBullet } from "../utils/quickAdd";
import { getMarkingStyle } from "../stores/markingStyle";

const bullet = buildTaskBullet({
  text: quickText,
  due: pendingDate,
  urgency: "high",
  markingStyle: getMarkingStyle(),   // 尊重用户标记风格（helmose/obsidian）
});
await api.appendBullet(nc.id, "今日待办", bullet, true);
```

### 4.5 DragOverlay 克隆任务卡

```tsx
<DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.34,1.56,0.64,1)" }}>
  {activeTask ? (
    <div className="planner-card planner-card--dragging">
      <AppIcon name="drag" size={12} />
      <span>{activeTask.text}</span>
    </div>
  ) : null}
</DragOverlay>
```

```css
.planner-card--dragging { transform: rotate(2deg); box-shadow: var(--shadow-lg); cursor: grabbing; }
.planner-quad.q1.is-over { box-shadow: inset 0 0 0 3px var(--ob-q1); background: var(--ob-q1-bg); }
.planner-quad.q2.is-over { box-shadow: inset 0 0 0 3px var(--ob-q2); background: var(--ob-q2-bg); }
/* q3/q4 同理 */
```

### 4.6 品牌 anchor 真锚 SVG

```tsx
// frontend/src/theme/icons/anchor.tsx
import { registerIcon } from "../../components/AppIcon";
registerIcon("anchor", (
  <svg viewBox="0 0 1024 1024" width="16" height="16" fill="none">
    <circle cx="512" cy="160" r="64" stroke="currentColor" strokeWidth="48"/>
    <path d="M320 288 L704 288 M512 288 L512 832" stroke="currentColor" strokeWidth="48" strokeLinecap="round"/>
    <path d="M288 576 Q288 800 512 832 Q736 800 736 576" stroke="currentColor" strokeWidth="48" fill="none" strokeLinecap="round"/>
  </svg>
));
// main.tsx import "./theme/icons/anchor";  并删除 AppIcon.tsx 中 anchor: LinkOutlined 一行
```

### 4.7 全局动效工具类（index.css 增量）

```css
.ob-fade-in  { animation: ob-fade-in  var(--motion-base) var(--ease-out); }
.ob-slide-up { animation: ob-slide-up var(--motion-base) var(--ease-out); }
@keyframes ob-slide-up { from { opacity:0; transform: translateY(8px);} to { opacity:1; transform:none;} }
@media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation-duration:.01ms!important; } }
```

---

## 五、决策结果（已拍板）

| 决策项 | 选择 |
|---|---|
| 主色 | `#6D28D9` / `#A78BFA` |
| 收集箱动线 | 方向 A 真 GTD 流转（见 §七） |
| 实施范围 | 分阶段文档驱动，按 §八 清单推进 |
| cssVar | 两阶段（P0 不开，P1 修 canvas 后全量） |

---

## 六、PlannerPage 收集箱交互优化（高优低成本补充）

| 问题 | 优化 | 工作量 |
|---|---|---|
| 四象限 isOver 高亮紫色与原色不协调 | 按象限原色加深 + inset shadow | 1d |
| 拖拽无 KeyboardSensor | 加 KeyboardSensor + aria-label | 1d |
| 详情面板属性行单展开 | 改独立 toggle Set 模式 | 0.5d |
| 期限 chips 只 2 快捷 | 扩到 5 个（今天/明天/本周末/下周一/下周五）+ DatePicker 替换原生 input | 1d |
| 迷你月历只设日期不联动 | dot 用象限色 + hover Popover 显示当天任务 | 1.5d |

---

## 七、方向 A：收集箱 → 四象限 真 GTD 流转设计

### 7.1 思路
把"收集箱"从只读计数卡升级为真正的 GTD 收件箱：新捕获的任务默认**未排程**（不进任何象限），用户必须主动拖入象限才算"排程"。解决当前"新任务默认进 q3 带🔥"导致用户从不排程的问题。

### 7.2 数据口径
**收集箱任务定义**：`priority IS NULL/0 AND urgency = mid（未手动标记）AND parent_task_id IS NULL`

**象限映射**（拖拽落位时通过 `set_task_priority` + `set_task_urgency` 写回，复用 M3 已实现命令，零后端改动）：

| 落位象限 | 写入 priority | 写入 urgency |
|---|---|---|
| q1 重要紧急 | high（3） | high |
| q2 重要不紧急 | high（3） | low |
| q3 紧急不重要 | low（1） | high |
| q4 不重要不紧急 | low（1） | low |
| 收集箱（拖回） | 0（清除） | mid（清除） |

### 7.3 ⚠️ 存量迁移坑
**问题**：现有 vault 里大量历史任务 priority/urgency 都是默认值（0/mid），按 7.2 口径会全部被算作收集箱任务，从四象限消失。

**对策（三选一，推荐 a）**：
- **a. 一次性存量标记**（推荐）：上线时跑一次迁移——对所有"已在四象限视图出现过的任务"补写 priority/urgency（按当前象限反推）。复用 `migrate_task_markers`（dry-run + 备份 + 用户手动触发）。**碰 vault 原文，强制 dry-run + 备份 + 全量回滚**。
- **b. 时间分界**：只对"上线后新建"任务套用收集箱口径，老任务维持原状。零迁移风险，口径割裂。
- **c. 双口径并存**：过渡期方案。

### 7.4 UI 改造（PlannerPage 左栏）
- 收集箱区改可拖拽列表（`useDraggable({ id, data: { task, from: 'inbox' } })`）
- 四象限 droppable 的 `handleDragEnd` 增加 `from === 'inbox'` 分支，按 7.2 映射写回
- 任务卡支持"拖回收集箱"（剥除标记）
- 超过 5 条折叠

### 7.5 quickAdd 默认行为变更
```ts
// 不再默认带🔥进 q3，改为纯文本 bullet → 自动进收集箱
const bullet = buildTaskBullet({
  text: quickText,
  due: pendingDate,
  // urgency 不传 → 不写紧急标记 → 进收集箱
  markingStyle: getMarkingStyle(),
});
```
用户想直接排到 q1 的需求，由 inline 标记支持：`task !1` / `!2` / `!3` / `!4`，或拖拽。

### 7.6 工作量
| 文件 | 改动 | 工作量 |
|---|---|---|
| `PlannerPage.tsx` | 收集箱可拖拽列表 + handleDragEnd inbox 分支 + quickAding 不带🔥 | 3d |
| store / selector | 收集箱筛选口径 | 1d |
| `commands/library.rs` | `migrate_task_markers`（backlog 转正，dry-run+备份） | 2d |
| `PlannerPage.css` | 收集箱列表项 + 拖拽热区 | 1d |
| SettingsPage | 迁移入口（dry-run 预览 + 备份 + 执行） | 1d |
| **合计** | | **~8d（含迁移），不含迁移 ~5d** |

### 7.7 风险与回滚
- 高风险：迁移碰 vault 原文（违反铁律 2 边界）。必须 dry-run + `.helmose/backup` 备份 + 用户手动触发 + 全量回滚
- 回滚：feature flag（localStorage）开关，出问题立即回旧口径

---

## 八、最终执行清单（纳入全部决策）

### 阶段一 · 地基与反模式（~3 人天，P0，零架构改动）
1. 新建 `tokens.ts`（主色 #6D28D9）+ ConfigProvider 接入（不开 cssVar）
2. `index.css :root` 用 tokens 输出替换 + 全局动效工具类
3. grep 收敛 7 种紫色变体 → `var(--ob-primary*)`
4. Ribbon/TabBar/StatusBar 收敛 AppIcon + 原生 title→antd Tooltip
5. 删 PlannerPage 假保存按钮
6. quickAdd 复用 buildTaskBullet（修复契约）
7. DragOverlay 克隆任务卡 + isOver 象限原色 + KeyboardSensor
8. AI 教练挂载先读 `ai_generations` 缓存
9. 品牌 anchor 真锚 SVG + registerIcon

### 阶段二 · 质感与效率（~4 人天，P1）
10. AI 卡片统一组件（左边框+来源角标+反差动效，含深海墨蓝渐变底）
11. EmptyState 品牌化组件（5 场景几何插画）
12. PlannerPage.css / ProjectsPage inline style → token + className
13. 全局快捷键扩展（⌘+N/⌘+Enter/⌘+W/⌘+1~9）
14. canvas 取色修复（ForceGraph/TimelineView 读 tokens.brand）→ 为阶段四 cssVar 铺路

### 阶段三 · Obsidian 式能力补齐（~4 人天，P2）
15. TabBar 拖拽重排/溢出滚动/中键关闭/reopen closed
16. FilePanel 删除文件（移 `.trash/`）+ 最近打开
17. 四象限重力视觉 + 完成收束动效（记忆点②③）

### 阶段四 · 真 GTD 流转 + 零渲染主题（~10 人天，P2，结构性）
18. 收集箱 GTD 动线（方向 A，§七）+ `migrate_task_markers` 存量迁移工具
19. 试点 cssVar 全量开启（阶段二 #14 完成后）

### 阶段五 · 差异化记忆点（v0.3，~2 周）
20. 航线主线视觉（依赖主线判定稳定）
21. Onboarding 三段式 + Demo vault
22. CalendarPage 日/周视图

---

## 九、自洽性核对

| 项目铁律 | 兼容性 |
|---|---|
| vault 是唯一真相源 | ✅ 纯前端样式 + GTD 口径派生，收集箱是查询口径非新表 |
| vault 原文只读 | ⚠️ 仅 §七迁移工具碰原文，已强制 dry-run+备份+手动触发 |
| 双轨主题 | ✅ 升级为 tokens.ts 单一来源驱动双轨，架构不变 |
| 多标签页模型 | ✅ ConfigProvider 在最外层，所有 tab 共享 |
| 不加未要求功能 | ✅ 全部基于已调研短板 |
| 性能红线（1.9万md） | ✅ 列表/树渲染不变；cssVar 反而降低主题切换开销 |

---

## 附：专家团原始产出索引

本整合方案基于以下四份独立专家报告交叉校验：
1. **桌面工具UX交互专家** — 核心操作路径诊断 + PlannerPage 交互优化 + Obsidian 式工作台效率 + 优化项分级（🟢13项/🟡18项/🔴7项）
2. **Ant Design 视觉设计师** — 完整设计系统（色彩/间距/圆角/字体/阴影/动效）+ 6 页面视觉方案 + 图标规范 + 双主题对照 + "专业克制"8 原则
3. **Tauri+React 前端落地工程师** — ConfigProvider 完整代码 + tokens.ts 单一来源 + Icon 收敛策略 + 工作量评估表（P0 1.8d/P1 2.3d）
4. **人生OS 产品顾问** — 五维竞品对标 + 克制智能原则 + 免费/Pro 视觉分层 + Onboarding 留存 + 三大差异化记忆点（航线/AI反差/四象限重力）+ 商业模式建议

> 配套视觉打样见 `docs/ui-preview.html`（双主题可切换的组件演示页）。
