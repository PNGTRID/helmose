// 错误边界：捕获子树渲染期异常，显示友好 fallback 而非整页白屏。
// 包在 App 的 content 区——某 tab 页崩时只影响 content，Ribbon/面板仍可用，可切到其他页。
// 「重试」清 error 重渲当前 tab；「重载」window.location.reload 兜底。

import { Component, type ReactNode } from "react";
import { Button, Result } from "antd";

interface Props {
  children: ReactNode;
  label?: string;
}
interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("[ErrorBoundary] 渲染异常：", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <Result
          status="error"
          title={this.props.label ?? "这一页出了点问题"}
          subTitle={
            <span style={{ wordBreak: "break-all", color: "var(--ob-text-muted)" }}>
              {this.state.error.message || String(this.state.error)}
            </span>
          }
          extra={[
            <Button
              key="retry"
              type="primary"
              onClick={() => this.setState({ error: null })}
            >
              重试
            </Button>,
            <Button key="reload" onClick={() => window.location.reload()}>
              重载应用
            </Button>,
          ]}
        />
      );
    }
    return this.props.children;
  }
}
