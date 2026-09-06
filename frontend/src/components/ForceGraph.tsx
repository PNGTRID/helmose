// 轻量自绘 canvas 力导向图谱（不引入额外依赖，避免构建不确定性）
// 力：中心引力 + 节点排斥 + 边弹簧；支持拖拽 + 点击节点跳转（移动 <5px 视为点击）。
// 增强：hover 高亮 + cursor pointer + 暗色模式颜色适配（随 theme store 切换）。
// 性能：物理收敛后停止 RAF 释放主线程；交互（resize / 拖拽释放）唤醒重启。

import { useEffect, useRef } from "react";
import { useThemeStore } from "../stores/theme";
import { tokens, darkTokens } from "../theme/tokens";
import type { GraphData, GraphNode } from "../types";

interface SimNode {
  id: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  deg: number;
}

interface Sim {
  nodes: SimNode[];
  edges: Array<[number, number]>;
}

const REPEL = 700;
const SPRING = 0.015;
const SPRING_LEN = 70;
const CENTER = 0.004;
const DAMP = 0.85;
// 收敛阈值：所有节点速度平方和低于此值视为静止，停止 RAF 主线程占用。
// 交互（拖拽节点 / 窗口 resize / data 变化重建模拟）会唤醒重启 RAF。
const CONVERGE_THRESHOLD = 0.5;
// 防止极端抖动反复唤醒：连续收敛帧数达到此值才真正停 RAF。
const CONVERGE_FRAMES = 6;

export default function ForceGraph({
  data,
  onSelect,
}: {
  data: GraphData;
  onSelect: (n: GraphNode) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Sim | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const hoverIdxRef = useRef<number>(-1);

  // 主题色（亮/暗），用 ref 让 effect 不因 theme 变化重跑、但每帧读到最新色
  const theme = useThemeStore((s) => s.theme);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // 重建模拟（data 变化时）
  useEffect(() => {
    const deg = new Map<string, number>();
    data.edges.forEach((e) => {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    });
    const nodes: SimNode[] = data.nodes.map((n, i) => {
      const angle = (i / Math.max(1, data.nodes.length)) * Math.PI * 2;
      const r = 180 + ((i * 37) % 120); // 伪随机半径，避免 Math.random 抖动
      return {
        id: n.id,
        label: n.label,
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        vx: 0,
        vy: 0,
        deg: deg.get(n.id) ?? 1,
      };
    });
    const idx = new Map(nodes.map((n, i) => [n.id, i] as const));
    const edges: Array<[number, number]> = data.edges
      .filter((e) => idx.has(e.source) && idx.has(e.target))
      .map((e) => [idx.get(e.source)!, idx.get(e.target)!]);
    simRef.current = { nodes, edges };
  }, [data]);

  // 渲染 + 交互循环
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const DPR = window.devicePixelRatio || 1;
    let raf = 0;
    // 连续收敛帧计数：达到 CONVERGE_FRAMES 后停止 RAF，主线程释放。
    let convergeFrame = 0;
    let dragIdx: number | null = null;
    let downX = 0;
    let downY = 0;
    let moved = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, rect.width) * DPR;
      canvas.height = 520 * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };
    resize();

    // canvas 取色直读 tokens（不能用 CSS 变量字符串），与主色海蓝统一
    const colors = () =>
      themeRef.current === "dark"
        ? { node: darkTokens.color.accent, nodeHover: darkTokens.color.accentHover, edge: darkTokens.color.border, hoverRing: darkTokens.color.accentHover }
        : { node: tokens.color.accent, nodeHover: tokens.color.accentHover, edge: tokens.color.border, hoverRing: tokens.color.accentHover };

    const step = () => {
      const sim = simRef.current;
      if (sim) {
        const { nodes, edges } = sim;
        const W = canvas.width / DPR;
        const H = canvas.height / DPR;
        const cx = W / 2;
        const cy = H / 2;

        // 中心引力
        for (let i = 0; i < nodes.length; i++) {
          if (i === dragIdx) continue;
          nodes[i].vx += (cx - nodes[i].x) * CENTER;
          nodes[i].vy += (cy - nodes[i].y) * CENTER;
        }
        // 节点排斥（O(n²)，配合后端默认 limit=500 保证主线程可用）
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[i].x - nodes[j].x;
            const dy = nodes[i].y - nodes[j].y;
            const d2 = dx * dx + dy * dy + 0.01;
            const d = Math.sqrt(d2);
            const f = REPEL / d2;
            const fx = (f * dx) / d;
            const fy = (f * dy) / d;
            nodes[i].vx += fx;
            nodes[i].vy += fy;
            nodes[j].vx -= fx;
            nodes[j].vy -= fy;
          }
        }
        // 边弹簧
        for (const [a, b] of edges) {
          const dx = nodes[b].x - nodes[a].x;
          const dy = nodes[b].y - nodes[a].y;
          const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
          const f = (d - SPRING_LEN) * SPRING;
          nodes[a].vx += (f * dx) / d;
          nodes[a].vy += (f * dy) / d;
          nodes[b].vx -= (f * dx) / d;
          nodes[b].vy -= (f * dy) / d;
        }
        // 积分 + 阻尼；同时累加速度平方和判定收敛。
        // 拖拽中的节点速度被人为置 0，不参与判定（避免拖拽误判收敛停 RAF）。
        let kinetic = 0;
        for (let i = 0; i < nodes.length; i++) {
          if (i === dragIdx) continue;
          nodes[i].vx *= DAMP;
          nodes[i].vy *= DAMP;
          nodes[i].x += nodes[i].vx;
          nodes[i].y += nodes[i].vy;
          kinetic += nodes[i].vx * nodes[i].vx + nodes[i].vy * nodes[i].vy;
        }

        // 绘制（无论是否继续模拟都要画当前帧；停 RAF 前最后画一次静止态）
        const c = colors();
        ctx.clearRect(0, 0, W, H);
        ctx.strokeStyle = c.edge;
        ctx.lineWidth = 0.6;
        for (const [a, b] of edges) {
          ctx.beginPath();
          ctx.moveTo(nodes[a].x, nodes[a].y);
          ctx.lineTo(nodes[b].x, nodes[b].y);
          ctx.stroke();
        }
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          const r = 3 + Math.min(n.deg * 1.1, 9);
          const isHover = i === hoverIdxRef.current;
          if (isHover) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2);
            ctx.strokeStyle = c.hoverRing;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
          ctx.fillStyle = isHover ? c.nodeHover : c.node;
          ctx.fill();
        }

        // 收敛判定：动能低于阈值连续 N 帧则停 RAF，释放主线程（图谱静止后不再空转 O(n²)）。
        // 拖拽中（dragIdx !== null）即使人为置 0 也不停，保证拖拽流畅。
        if (kinetic < CONVERGE_THRESHOLD) {
          convergeFrame++;
          if (convergeFrame >= CONVERGE_FRAMES && dragIdx === null) {
            raf = 0; // 标记 RAF 已停，wake() 据此判断是否需重启
            return;
          }
        } else {
          convergeFrame = 0;
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    // 唤醒物理循环：重置收敛计数 + 若 RAF 已停则重启。
    // 触发点：resize（尺寸变化需重排）、拖拽释放（人为扰动需重新平衡）。
    const wake = () => {
      convergeFrame = 0;
      if (!raf) raf = requestAnimationFrame(step);
    };

    const relPos = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const findNode = (x: number, y: number) => {
      const sim = simRef.current;
      if (!sim) return -1;
      for (let i = sim.nodes.length - 1; i >= 0; i--) {
        const n = sim.nodes[i];
        if ((n.x - x) ** 2 + (n.y - y) ** 2 < 144) return i;
      }
      return -1;
    };
    const onDown = (e: MouseEvent) => {
      const { x, y } = relPos(e);
      dragIdx = findNode(x, y);
      downX = x;
      downY = y;
      moved = false;
    };
    const onMove = (e: MouseEvent) => {
      const { x, y } = relPos(e);
      if (dragIdx !== null) {
        const sim = simRef.current!;
        sim.nodes[dragIdx].x = x;
        sim.nodes[dragIdx].y = y;
        sim.nodes[dragIdx].vx = 0;
        sim.nodes[dragIdx].vy = 0;
        if ((x - downX) ** 2 + (y - downY) ** 2 > 25) moved = true;
      } else {
        // 无拖拽时：hover 检测 + cursor 反馈
        const h = findNode(x, y);
        hoverIdxRef.current = h;
        canvas.style.cursor = h >= 0 ? "pointer" : "grab";
      }
    };
    const onUp = () => {
      if (dragIdx !== null && !moved) {
        const sim = simRef.current!;
        const n = sim.nodes[dragIdx];
        const orig = data.nodes.find((d) => d.id === n.id);
        if (orig) onSelectRef.current(orig);
      }
      // 释放节点后人造扰动需重新平衡：唤醒 RAF（若已停）。
      if (dragIdx !== null) wake();
      dragIdx = null;
    };
    const onLeave = () => {
      hoverIdxRef.current = -1;
      canvas.style.cursor = "grab";
    };

    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    window.addEventListener("mouseup", onUp);
    const onResize = () => {
      resize();
      wake(); // 尺寸变化导致中心引力重排，唤醒 RAF
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("resize", onResize);
    };
  }, [data]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: 520,
        marginTop: 8,
        background: "var(--ob-bg-mod)",
        borderRadius: 8,
        cursor: "grab",
      }}
    />
  );
}
