// 迷你月历（周一首日，有任务日期带点，今天高亮，点日期预填输入条）。
// 纯展示（props 驱动，零写回依赖）。从 PlannerPage 抽离（阶段 3a 纯展示拆分）。
// 复用全局 planner- 类名（PlannerPage.css 仍全局生效，本组件不单独引 CSS）。
import dayjs from "dayjs";
import AppIcon from "../AppIcon";
import { todayStr } from "./constants";

export interface MiniCalendarProps {
  viewMonth: dayjs.Dayjs;
  onPrev: () => void;
  onNext: () => void;
  dueDateSet: Set<string>;
  selectedDue: string | null;
  onPickDate: (d: string) => void;
}

export default function MiniCalendar({
  viewMonth,
  onPrev,
  onNext,
  dueDateSet,
  selectedDue,
  onPickDate,
}: MiniCalendarProps) {
  const today = todayStr();
  const startOfMonth = viewMonth.startOf("month");
  const daysInMonth = viewMonth.daysInMonth();
  const firstWeekday = (startOfMonth.day() + 6) % 7; // 周一首：周一=0...周日=6
  const prevMonth = viewMonth.subtract(1, "month");
  const prevDaysInMonth = prevMonth.daysInMonth();

  const heads = ["一", "二", "三", "四", "五", "六", "日"];
  type Cell = { day: number; dateStr: string; other: boolean };
  const cells: Cell[] = [];
  for (let i = firstWeekday - 1; i >= 0; i--) {
    const d = prevDaysInMonth - i;
    cells.push({ day: d, dateStr: prevMonth.date(d).format("YYYY-MM-DD"), other: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, dateStr: viewMonth.date(d).format("YYYY-MM-DD"), other: false });
  }
  const nextMonth = viewMonth.add(1, "month");
  let n = 1;
  while (cells.length < 42) {
    cells.push({ day: n, dateStr: nextMonth.date(n).format("YYYY-MM-DD"), other: true });
    n++;
  }

  return (
    <div className="planner-panel planner-cal">
      <div className="planner-cal-head">
        <div className="planner-cal-month">{viewMonth.format("YYYY年MM月")}</div>
        <div className="planner-cal-nav">
          <button onClick={onPrev}>
            <AppIcon name="left" size={11} />
          </button>
          <button onClick={onNext}>
            <AppIcon name="right" size={11} />
          </button>
        </div>
      </div>
      <div className="planner-cal-grid">
        {heads.map((h, i) => (
          <div key={h} className={`planner-cal-wk ${i >= 5 ? "weekend" : ""}`}>
            {h}
          </div>
        ))}
        {cells.map((c, i) => {
          const isToday = c.dateStr === today;
          const isSelected = selectedDue === c.dateStr;
          const hasTask = dueDateSet.has(c.dateStr);
          const cls = [
            "planner-cal-day",
            c.other ? "other" : "",
            isToday ? "today" : "",
            isSelected ? "selected" : "",
          ].join(" ").trim();
          return (
            <div key={i} className={cls} onClick={() => onPickDate(c.dateStr)}>
              {c.day}
              {hasTask && <span className="planner-cal-dot" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
