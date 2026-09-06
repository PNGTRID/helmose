// 路径安全校验（防穿越）：split `..` 快速预检 + canonicalize 兜底。
//
// 攻击面（企业级 defense in depth）：
//   1. rel 含 `..` → root.join(rel) 跑出 vault（经典穿越，is_safe_rel 预检防）
//   2. vault 内 symlink 指向 vault 外 → root.join(rel) 后 fs::write 跟随 symlink 写出 vault
//      （is_safe_rel 不防，需 canonicalize 后 starts_with 校验，is_path_within 防）
//   3. 绝对路径片段（`/etc`、`C:\`）→ Path::join 遇绝对路径会替换 base，is_path_within 防
//
// 用法：
//   - 快速预检（rel 字符串）：is_safe_rel(rel)
//   - 写盘前兜底（已存在路径）：assert_within(abs, root)
//   - 新建路径兜底（abs 尚不存在）：assert_new_path_within(abs, root)
use crate::models::{AppError, AppResult};
use std::path::Path;

/// 快速预检：rel 任一段为 `..` 即不安全（防 `../` 穿越经典攻击）。
/// 不防 symlink/绝对路径（需 canonicalize 兜底）。返回 true 表示通过预检。
pub fn is_safe_rel(rel: &str) -> bool {
    !rel.split(['/', '\\']).any(|c| c == "..")
}

/// canonicalize 兜底：child 是否在 root 内（防 symlink 逃逸 + 绝对路径片段）。
/// child 与 root 均须存在（canonicalize 要求解析所有 symlink/相对段）。
pub fn is_path_within(child: &Path, root: &Path) -> bool {
    let ok = || {
        let c = std::fs::canonicalize(child).ok()?;
        let r = std::fs::canonicalize(root).ok()?;
        c.starts_with(r).then_some(())
    };
    ok().is_some()
}

/// 校验已存在路径在 root 内，否则返错（覆盖写盘前兜底）。
pub fn assert_within(child: &Path, root: &Path) -> AppResult<()> {
    if is_path_within(child, root) {
        Ok(())
    } else {
        // 不回显绝对路径：错误经 AppError 序列化回前端，避免泄露宿主用户名/vault 位置（与 export_life_state 同原则）。
        // 真实路径写入 tracing 日志便于本地排障。
        tracing::error!(
            child = %child.display(),
            root = %root.display(),
            "路径越界（含 symlink 或绝对路径片段），已拒绝写盘"
        );
        Err(AppError::invalid_input(
            "路径越界（含 symlink 或绝对路径片段），已拒绝写盘",
        ))
    }
}

/// 校验新建路径（child 尚不存在）：从 child 向上找最远「已存在」祖先，canonicalize 后拼回剩余段
/// 必在 root 内。防「父目录是 symlink 指向 vault 外」（is_safe_rel 不防，canonicalize 才能解析 symlink）。
/// 不依赖 child/中间目录存在——新建多层目录时走到 root 拼回全部段（starts_with(root) 必过）。
pub fn assert_new_path_within(child: &Path, root: &Path) -> AppResult<()> {
    let r = match std::fs::canonicalize(root) {
        Ok(r) => r,
        Err(_) => root.to_path_buf(), // root 不存在（异常）退化字面比较
    };
    // 向上找最远已存在祖先（canonicalize 需路径存在）；剩余段入栈待拼回
    let mut cur = child.to_path_buf();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    while !cur.exists() {
        match (cur.file_name(), cur.parent()) {
            (Some(name), Some(p)) => {
                tail.push(name.to_os_string());
                cur = p.to_path_buf();
            }
            _ => break,
        }
    }
    tail.reverse();
    // canonicalize 最远祖先（解析其上 symlink）→ 拼回剩余段得 child 真实路径 → 比对 root
    let mut real = std::fs::canonicalize(&cur).unwrap_or(cur);
    for name in &tail {
        real = real.join(name);
    }
    if real.starts_with(&r) {
        Ok(())
    } else {
        // 不回显绝对路径（同 assert_within，避免泄露宿主路径回前端）。
        tracing::error!(
            child = %child.display(),
            root = %root.display(),
            "新建路径越界（父目录含 symlink 指向 vault 外），已拒绝写盘"
        );
        Err(AppError::invalid_input(
            "新建路径越界（父目录含 symlink 指向 vault 外），已拒绝写盘",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AppError;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn safe_rel_拒绝_两点段() {
        assert!(!is_safe_rel("../etc/passwd"));
        assert!(!is_safe_rel("a/../../b"));
        assert!(!is_safe_rel("a\\..\\b"));
    }

    #[test]
    fn safe_rel_放行_正常路径() {
        assert!(is_safe_rel("1-人/a.md"));
        assert!(is_safe_rel("项目/Picboil.md"));
        assert!(is_safe_rel("a/b/c.md"));
    }

    // ---- is_path_within（canonicalize 兜底，防 symlink 逃逸 + 绝对路径片段）----

    #[test]
    fn is_path_within_子在root内_真() {
        let root = TempDir::new().unwrap();
        let sub = root.path().join("a");
        fs::create_dir_all(&sub).unwrap();
        let child = sub.join("b.md");
        fs::write(&child, "x").unwrap();
        assert!(is_path_within(&child, root.path()));
    }

    #[test]
    fn is_path_within_子在root外_假() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let child = outside.path().join("x.md");
        fs::write(&child, "x").unwrap();
        assert!(!is_path_within(&child, root.path()));
    }

    #[test]
    fn is_path_within_不存在路径_假() {
        // canonicalize 要求路径存在；不存在 → None → false
        let root = TempDir::new().unwrap();
        let ghost = root.path().join("nope.md");
        assert!(!is_path_within(&ghost, root.path()));
    }

    #[cfg(unix)]
    #[test]
    fn is_path_within_symlink逃逸_假() {
        // 攻击面：root/ln → outside，经 symlink 解析后 child 实际在 outside → 不在 root 内
        use std::os::unix::fs::symlink;
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("secret.md"), "x").unwrap();
        symlink(&outside, root.path().join("ln")).unwrap();
        let child_via_link = root.path().join("ln/secret.md");
        assert!(
            !is_path_within(&child_via_link, root.path()),
            "经 symlink 解析到 vault 外的路径应判越界"
        );
    }

    // ---- assert_within（已存在路径写盘前兜底）----

    #[test]
    fn assert_within_在root内_通过() {
        let root = TempDir::new().unwrap();
        let child = root.path().join("a.md");
        fs::write(&child, "x").unwrap();
        assert!(assert_within(&child, root.path()).is_ok());
    }

    #[test]
    fn assert_within_越界_返非法输入且不外泄绝对路径() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let child = outside.path().join("x.md");
        fs::write(&child, "x").unwrap();
        let err = assert_within(&child, root.path()).unwrap_err();
        // 错误码化：越界应映射 InvalidInput（非 Internal）
        assert!(matches!(err, AppError::InvalidInput(_)), "应 InvalidInput，实际 {:?}", err);
        // 脱敏：message 不含宿主绝对路径（防 XSS 经 IPC 触发越界外泄用户名/vault 位置）
        let msg = err.to_string();
        assert!(
            !msg.contains(outside.path().to_str().unwrap()),
            "错误消息不应外泄宿主绝对路径，实际：{}",
            msg
        );
        assert!(msg.contains("越界"), "应提示越界，实际：{}", msg);
    }

    // ---- assert_new_path_within（新建路径兜底，防父目录是 symlink 指向 vault 外）----

    #[test]
    fn assert_new_path_within_新建多层路径在root内_通过() {
        // child 尚不存在、父目录全不存在（新建 a/b/c.md）→ 走到 root 拼回 → starts_with(root) 真
        let root = TempDir::new().unwrap();
        let new_file = root.path().join("a/b/c.md");
        assert!(assert_new_path_within(&new_file, root.path()).is_ok());
    }

    #[test]
    fn assert_new_path_within_绝对路径片段在root外_越界() {
        // child 在另一个 tmp（不在 root 内）→ 拼回后 starts_with(root) 假 → Err
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let new_file = outside.path().join("new.md");
        let err = assert_new_path_within(&new_file, root.path()).unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));
    }

    #[cfg(unix)]
    #[test]
    fn assert_new_path_within_父目录symlink指向root外_拦截() {
        // 核心攻击面（本轮 move_note/save 防护目标）：
        // root/ln 是 symlink → outside，新建 root/ln/new.md 实际写到 outside/new.md → 越界拦截
        use std::os::unix::fs::symlink;
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        symlink(&outside, root.path().join("ln")).unwrap();
        let new_file = root.path().join("ln/new.md");
        let err = assert_new_path_within(&new_file, root.path()).unwrap_err();
        assert!(
            matches!(err, AppError::InvalidInput(_)),
            "父目录 symlink 指向 vault 外应拦截，实际 {:?}",
            err
        );
    }
}
