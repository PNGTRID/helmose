// AI 教练面板：主线判定 + 每日教练建议 + 明日一句 三卡。
// 三卡独立 loading / 降级态（source 标 ai / heuristic / cached）。
// 未配 key 由父组件显「去设置」降级态卡，本组件假定已配 key 才挂载。

import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Input,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import {
  EditOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import * as api from "../../api";
import type {
  AiCoachResult,
  AiMainline,
  AiTomorrowResult,
} from "../../types";

const { Text, Paragraph } = Typography;

// AI 三卡结果本地缓存（localStorage）：挂载先读作 initial，消除每次进页空白等待。
// 后端 ai_coach/ai_mainline/ai_tomorrow 内部已有降级链（AI→heuristic→cache），但前端命令每次都重跑；
// 这里在前端再兜一层"上次结果"，跨会话瞬时显示，用户主动点「刷新/重新生成」拉最新。
const cacheKey = (vaultId: string) => `helmose-ai-cache-${vaultId}`;
interface AiCache {
  mainline?: AiMainline | null;
  coach?: AiCoachResult | null;
  tomorrow?: AiTomorrowResult | null;
}
function readAiCache(vaultId: string): AiCache {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(vaultId)) ?? "{}");
  } catch {
    return {};
  }
}
function writeAiCache(vaultId: string, patch: Partial<AiCache>) {
  try {
    const cur = readAiCache(vaultId);
    localStorage.setItem(cacheKey(vaultId), JSON.stringify({ ...cur, ...patch }));
  } catch {
    /* localStorage 不可用时静默（隐私模式等）*/
  }
}

/** source 文本 → (颜色, 中文标签)。heuristic/cached 灰色，ai 蓝色亮显 */
function sourceTag(source: string): { color: string; label: string } {
  switch (source) {
    case "ai":
      return { color: "blue", label: "AI" };
    case "heuristic":
      return { color: "default", label: "本地推断" };
    case "cached":
      return { color: "default", label: "上次结果" };
    default:
      return { color: "default", label: source };
  }
}

/** 主线判定 source 标签映射后的可显示标签（project_name 在前） */
function MainlineTag({ source }: { source: string }) {
  const t = sourceTag(source);
  return (
    <Tag color={t.color} style={{ margin: 0 }}>
      {t.label}
    </Tag>
  );
}

export interface AiCoachCardProps {
  vaultId: string;
  /** 初始主线判定结果（父组件挂载时已拉，可为 null 表示尚未拉取） */
  initialMainline?: AiMainline | null;
  initialCoach?: AiCoachResult | null;
  initialTomorrow?: AiTomorrowResult | null;
  /** 编辑明日一句保存回调（父组件可注入自定义实现，默认走 getNoteContent+saveNoteBody 替换） */
  onTomorrowSaved?: (sentence: string) => void;
}

export default function AiCoachCard({
  vaultId,
  initialMainline = null,
  initialCoach = null,
  initialTomorrow = null,
}: AiCoachCardProps) {
  // 挂载先读 localStorage 缓存作 initial（父组件未传 initial 时兜底，消除空白等待）
  const cache = useMemo(() => readAiCache(vaultId), [vaultId]);

  // —— 主线判定 ——
  const [mainline, setMainline] = useState<AiMainline | null>(
    initialMainline ?? cache.mainline ?? null
  );
  const [mainlineLoading, setMainlineLoading] = useState(false);

  // —— 每日教练 ——
  const [coach, setCoach] = useState<AiCoachResult | null>(
    initialCoach ?? cache.coach ?? null
  );
  const [coachLoading, setCoachLoading] = useState(false);

  // —— 明日一句 ——
  const [tomorrow, setTomorrow] = useState<AiTomorrowResult | null>(
    initialTomorrow ?? cache.tomorrow ?? null
  );
  const [tomorrowLoading, setTomorrowLoading] = useState(false);
  const [editingTomorrow, setEditingTomorrow] = useState(false);
  const [tomorrowDraft, setTomorrowDraft] = useState("");

  const regenMainline = async () => {
    setMainlineLoading(true);
    try {
      const r = await api.aiMainline(vaultId);
      setMainline(r);
      writeAiCache(vaultId, { mainline: r });
    } catch (e) {
      message.error(`主线判定失败：${e}`);
    } finally {
      setMainlineLoading(false);
    }
  };

  const refreshCoach = async () => {
    setCoachLoading(true);
    try {
      const r = await api.aiCoach(vaultId);
      setCoach(r);
      writeAiCache(vaultId, { coach: r });
    } catch (e) {
      message.error(`教练建议失败：${e}`);
    } finally {
      setCoachLoading(false);
    }
  };

  const regenTomorrow = async () => {
    setTomorrowLoading(true);
    try {
      const r = await api.aiTomorrow(vaultId);
      setTomorrow(r);
      writeAiCache(vaultId, { tomorrow: r });
    } catch (e) {
      message.error(`生成明日一句失败：${e}`);
    } finally {
      setTomorrowLoading(false);
    }
  };

  /** 编辑明日一句后保存：调用后端 update_tomorrow_sentence（在「明日一句」section 内
   *  定位 + update_line / append_bullet 收口，含备份 + 重索引）。前端不处理文本，
   *  避免旧实现在整个 raw_content 全局 replaceFirst 误伤笔记别处同名 bullet。 */
  const saveTomorrowEdit = async () => {
    const draft = tomorrowDraft.trim();
    if (!draft || !tomorrow) {
      setEditingTomorrow(false);
      return;
    }
    setTomorrowLoading(true);
    try {
      const r = await api.updateTomorrowSentence(tomorrow.note_id, draft);
      setTomorrow(r);
      writeAiCache(vaultId, { tomorrow: r });
      setEditingTomorrow(false);
      message.success("已保存");
    } catch (e) {
      message.error(`保存失败：${e}`);
    } finally {
      setTomorrowLoading(false);
    }
  };

  const startEditTomorrow = () => {
    if (!tomorrow) return;
    setTomorrowDraft(tomorrow.sentence);
    setEditingTomorrow(true);
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {/* 主线判定卡 */}
      <Card
        size="small"
        title={
          <Space>
            <ThunderboltOutlined />
            <span>主线判定</span>
            {mainline && <MainlineTag source={mainline.source} />}
          </Space>
        }
        extra={
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            loading={mainlineLoading}
            onClick={regenMainline}
          >
            重新生成
          </Button>
        }
      >
        {mainlineLoading && !mainline ? (
          <Spin tip="AI 思考中…" size="small">
            <div style={{ minHeight: 40 }} />
          </Spin>
        ) : mainline ? (
          <Space direction="vertical" size={4} style={{ width: "100%" }}>
            <Text strong style={{ fontSize: 16 }}>
              {mainline.project_name}
            </Text>
            <Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
              {mainline.reason}
            </Paragraph>
          </Space>
        ) : (
          <Text type="secondary">点击「重新生成」获取主线判定</Text>
        )}
      </Card>

      {/* 每日教练建议卡 */}
      <Card
        size="small"
        title={
          <Space>
            <ThunderboltOutlined />
            <span>每日教练</span>
            {coach && <MainlineTag source={coach.source} />}
          </Space>
        }
        extra={
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            loading={coachLoading}
            onClick={refreshCoach}
          >
            刷新
          </Button>
        }
      >
        {coachLoading && !coach ? (
          <Spin tip="AI 思考中…" size="small">
            <div style={{ minHeight: 40 }} />
          </Spin>
        ) : coach ? (
          <Paragraph style={{ margin: 0 }}>{coach.text}</Paragraph>
        ) : (
          <Text type="secondary">点击「刷新」获取今日教练建议</Text>
        )}
      </Card>

      {/* 明日一句卡 */}
      <Card
        size="small"
        title={
          <Space>
            <ThunderboltOutlined />
            <span>明日一句</span>
            {tomorrow && <MainlineTag source={tomorrow.source} />}
          </Space>
        }
        extra={
          <Space size={4}>
            {!editingTomorrow && (
              <>
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  disabled={!tomorrow}
                  onClick={startEditTomorrow}
                >
                  编辑
                </Button>
                <Button
                  size="small"
                  type="text"
                  icon={<ReloadOutlined />}
                  loading={tomorrowLoading}
                  onClick={regenTomorrow}
                >
                  重新生成
                </Button>
              </>
            )}
          </Space>
        }
      >
        {tomorrowLoading && !tomorrow ? (
          <Spin tip="AI 思考中…" size="small">
            <div style={{ minHeight: 40 }} />
          </Spin>
        ) : editingTomorrow ? (
          <Space direction="vertical" size={6} style={{ width: "100%" }}>
            <Input.TextArea
              value={tomorrowDraft}
              onChange={(e) => setTomorrowDraft(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 4 }}
              placeholder="写下明日聚焦的一句话…"
              disabled={tomorrowLoading}
            />
            <Space>
              <Button
                size="small"
                type="primary"
                loading={tomorrowLoading}
                onClick={saveTomorrowEdit}
              >
                保存
              </Button>
              <Button
                size="small"
                onClick={() => setEditingTomorrow(false)}
                disabled={tomorrowLoading}
              >
                取消
              </Button>
            </Space>
          </Space>
        ) : tomorrow ? (
          <Paragraph style={{ margin: 0, fontSize: 15 }}>
            {tomorrow.sentence}
          </Paragraph>
        ) : (
          <Alert
            type="info"
            showIcon
            message="点击「重新生成」让 AI 写下明日聚焦"
            description="会写回当日笔记「明日一句」section，次日打开 TodayPage 时作为今日寄语显示"
          />
        )}
      </Card>
    </Space>
  );
}
