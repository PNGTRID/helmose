// 统一 loading / error / empty / 数据 四态渲染，消除各列表页重复的三态条件分支。
// 用法：<DataState loading error errorTitle empty emptyText>{数据}</DataState>
import type { ReactNode } from "react";
import { Alert, Empty, Spin } from "antd";

interface DataStateProps {
  loading?: boolean;
  error?: ReactNode;
  errorTitle?: ReactNode; // 默认「加载失败」
  empty?: boolean;
  emptyText?: ReactNode;
  children?: ReactNode;
}

export default function DataState({
  loading,
  error,
  errorTitle = "加载失败",
  empty,
  emptyText,
  children,
}: DataStateProps) {
  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <Spin />
      </div>
    );
  }
  if (error) {
    return <Alert type="error" showIcon message={errorTitle} description={error} />;
  }
  if (empty) {
    return <Empty description={emptyText} />;
  }
  return <>{children}</>;
}
