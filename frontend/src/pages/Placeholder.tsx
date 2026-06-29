import { Typography, Empty } from "antd";

interface Props {
  title: string;
  hint?: string;
}

/** 通用占位页：v0.1 未实现的视图先放占位 */
export default function Placeholder({ title, hint }: Props) {
  return (
    <div>
      <Typography.Title level={3}>{title}</Typography.Title>
      <Empty description={hint ?? `${title} · v0.1 开发中`} />
    </div>
  );
}
