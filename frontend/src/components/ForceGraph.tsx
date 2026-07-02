// 轻量自绘 canvas 力导向图谱（不引入额外依赖，避免构建不确定性）
// 力：中心引力 + 节点排斥 + 边弹簧；支持拖拽 + 点击节点跳转（移动 <5px 视为点击）。
// 增强：hover 高亮 + cursor pointer + 暗色模式颜色适配（随 theme store 切换）。

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
        // 节点排斥（O(n²)，n≤600 可接受）
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
        // 积分 + 阻尼
        for (let i = 0; i < nodes.length; i++) {
          if (i === dragIdx) continue;
          nodes[i].vx *= DAMP;
          nodes[i].vy *= DAMP;
          nodes[i].x += nodes[i].vx;
          nodes[i].y += nodes[i].vy;
        }

        // 绘制
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
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

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
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("resize", resize);
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
