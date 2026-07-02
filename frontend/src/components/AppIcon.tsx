// AppIcon：全局统一图标组件（纯 SVG，无字体文件，跨平台一致）。
// 图标统一规则：项目功能图标一律走本组件（@ant-design/icons），禁用 emoji / 字体图标 / Font Awesome。
// vault md 正文里的 emoji 是用户内容，不在本组件管辖范围。
//
// 三种来源，按优先级：
//   1) svg    —— 自定义 SVG 节点（v0.2 AI 教练专属图标通道）
//   2) icon   —— 直接传 antd 图标组件（编译期确定，类型最全，给静态 UI 用）
//   3) name   —— 查 REGISTRY 字符串名（给数据/配置驱动用，如分类图标存 localStorage）
// 主题：未显式传 color 时取 antd token.colorText，自动跟随 darkAlgorithm 深浅切换。
// 能力：spin 旋转 / disabled 禁用态 / size 像素尺寸 / color 自定义色。
import { theme } from "antd";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import {
  // 文件 / 目录
  FileOutlined,
  FileTextOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  // 知识库操作
  InboxOutlined,
  DatabaseOutlined,
  SyncOutlined,
  CloudSyncOutlined,
  CloudOutlined,
  SearchOutlined,
  FileSearchOutlined,
  TagsOutlined,
  // 功能模块（对应 Ribbon / 菜单）
  ApartmentOutlined,
  AimOutlined,
  CheckSquareOutlined,
  ScheduleOutlined,
  ProjectOutlined,
  CalendarOutlined,
  BookOutlined,
  HomeOutlined,
  AppstoreOutlined,
  // 通用操作
  SettingOutlined,
  BellOutlined,
  StarOutlined,
  LinkOutlined,
  DeleteOutlined,
  ReloadOutlined,
  PlusOutlined,
  CloseOutlined,
  LeftOutlined,
  RightOutlined,
  CaretRightOutlined,
  EllipsisOutlined,
  SaveOutlined,
  WarningOutlined,
  EditOutlined,
  CheckOutlined,
  CopyOutlined,
  UnorderedListOutlined,
  TableOutlined,
  DashboardOutlined,
  UserOutlined,
  LockOutlined,
  BorderOutlined,
  BlockOutlined,
  // 四象限 / 语义
  FireOutlined,
  BulbOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  CoffeeOutlined,
  HeartOutlined,
  CrownOutlined,
  CompassOutlined,
  // AI（v0.2 教练层预留）
  RobotOutlined,
  MessageOutlined,
  // 品牌 / 心情
  SmileOutlined,
} from "@ant-design/icons";
import "./AppIcon.css";

/**
 * 内置图标注册表：name（可序列化，能存 localStorage / vault 配置）→ antd 图标组件。
 * 新增知识库图标只需在此追加一行；数据层引用 name 字符串即可，不耦合组件。
 */
const REGISTRY = {
  // 文件 / 目录
  file: FileOutlined,
  note: FileTextOutlined,
  folder: FolderOutlined,
  "folder-open": FolderOpenOutlined,
  // 知识库操作
  inbox: InboxOutlined,
  database: DatabaseOutlined,
  index: DatabaseOutlined,
  sync: SyncOutlined,
  "cloud-sync": CloudSyncOutlined,
  cloud: CloudOutlined,
  search: SearchOutlined,
  "file-search": FileSearchOutlined,
  tag: TagsOutlined,
  // 功能模块
  graph: ApartmentOutlined,
  today: AimOutlined,
  task: CheckSquareOutlined,
  planner: ScheduleOutlined,
  project: ProjectOutlined,
  calendar: CalendarOutlined,
  journal: BookOutlined,
  home: HomeOutlined,
  apps: AppstoreOutlined,
  // 通用操作
  setting: SettingOutlined,
  bell: BellOutlined,
  star: StarOutlined,
  link: LinkOutlined,
  delete: DeleteOutlined,
  reload: ReloadOutlined,
  plus: PlusOutlined,
  close: CloseOutlined,
  left: LeftOutlined,
  right: RightOutlined,
  "caret-right": CaretRightOutlined,
  ellipsis: EllipsisOutlined,
  save: SaveOutlined,
  warning: WarningOutlined,
  edit: EditOutlined,
  check: CheckOutlined,
  copy: CopyOutlined,
  list: UnorderedListOutlined,
  table: TableOutlined,
  dashboard: DashboardOutlined,
  user: UserOutlined,
  lock: LockOutlined,
  border: BorderOutlined,
  side: BlockOutlined, // 侧栏（Ribbon 右侧面板按钮）
  // 四象限 / 语义
  fire: FireOutlined,
  bulb: BulbOutlined,
  thunder: ThunderboltOutlined,
  clock: ClockCircleOutlined,
  coffee: CoffeeOutlined,
  heart: HeartOutlined,
  crown: CrownOutlined,
  compass: CompassOutlined,
  // AI（v0.2 教练层预留，现用内置占位，后续可 registerIcon 换自定义 SVG）
  ai: RobotOutlined,
  robot: RobotOutlined,
  message: MessageOutlined,
  // 品牌 / 心情
  anchor: LinkOutlined,
  smile: SmileOutlined,
} satisfies Record<string, ComponentType<any>>;

export type IconName = keyof typeof REGISTRY;

/** 自定义图标运行时注册表（registerIcon 写入），优先级高于内置 REGISTRY。 */
const CUSTOM_REGISTRY: Record<string, ReactNode> = {};

/**
 * 注册自定义图标（运行时扩展，给 v0.2 AI 模块用）。
 * 用法：在 ai 模块入口 registerIcon("ai-coach", <AiCoachSvg />)
 * 注册后 <AppIcon name="ai-coach" /> 即可渲染，和数据驱动用法一致。
 */
export function registerIcon(name: string, node: ReactNode): void {
  CUSTOM_REGISTRY[name] = node;
}

export interface AppIconProps {
  /** 内置图标名（查 REGISTRY；数据/配置驱动，如分类图标） */
  name?: string;
  /** 直接传 antd 图标组件（编译期确定，类型最全） */
  icon?: ComponentType<any>;
  /** 自定义 SVG 节点（AI 专属图标通道） */
  svg?: ReactNode;
  /** 像素尺寸，默认 16 */
  size?: number;
  /** 颜色，默认取主题 colorText（自动跟随深浅） */
  color?: string;
  /** 旋转动画（同步 / 加载态） */
  spin?: boolean;
  /** 禁用态：降不透明度 + not-allowed 光标 */
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  /** 原生 title（鼠标悬停提示，无障碍） */
  title?: string;
}

export function AppIcon({
  name,
  icon,
  svg,
  size = 16,
  color,
  spin,
  disabled,
  className,
  style,
  title,
}: AppIconProps) {
  const { token } = theme.useToken();
  const finalColor = color ?? token.colorText;
  const common: CSSProperties = {
    fontSize: size,
    color: finalColor,
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? "not-allowed" : undefined,
    ...style,
  };

  // 1) 自定义 SVG（AI 图标专属通道；spin 由外层 animation 驱动）
  if (svg !== undefined) {
    return (
      <span
        className={className}
        style={{
          display: "inline-flex",
          lineHeight: 0,
          verticalAlign: "middle",
          animation: spin ? "helmose-icon-spin 1s linear infinite" : undefined,
          ...common,
        }}
        title={title}
      >
        {svg}
      </span>
    );
  }

  // 2) 自定义 registry 命中（registerIcon 注册过的）
  if (name && CUSTOM_REGISTRY[name] !== undefined) {
    return (
      <span
        className={className}
        style={{ display: "inline-flex", lineHeight: 0, verticalAlign: "middle", ...common }}
        title={title}
      >
        {CUSTOM_REGISTRY[name]}
      </span>
    );
  }

  // 3) antd 内置：icon 直传 > name 查 REGISTRY
  const Comp = icon ?? (name ? REGISTRY[name as IconName] : undefined);
  if (!Comp) {
    // 兜底：图标名找不到 → 空占位，避免脏数据导致崩溃
    return (
      <span
        className={className}
        style={{ width: size, height: size, display: "inline-block", verticalAlign: "middle", ...common }}
        title={title}
      />
    );
  }
  return <Comp className={className} style={common} spin={spin} title={title} />;
}

export default AppIcon;
