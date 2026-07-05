// ============================================================
// 日志初始化(tracing)+ panic hook —— 发布前排障基础
// ============================================================

pub fn init() {
    let _ = tracing_subscriber::fmt().with_target(false).try_init();

    // panic hook:捕获 panic → tracing::error 落日志(否则 .expect/run 末尾 panic 仅静默退出,
    // 用户侧表现为「双击没反应」)。未来 Sentry 接入在此处 send_event。
    // 保留原 hook 链(不破坏 devtools 断点 / 默认 abort 行为)。
    let prev_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "<unknown>".to_string());
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
            .unwrap_or("<non-string panic>");
        tracing::error!(location = %location, "panic: {}", payload);
        prev_hook(info);
    }));
}
