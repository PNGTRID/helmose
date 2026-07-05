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
        Err(AppError::invalid_input(format!(
            "路径越界（含 symlink 或绝对路径片段）：{} 不在 vault {} 内",
            child.display(),
            root.display()
        )))
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
        Err(AppError::invalid_input(format!(
            "新建路径越界：{} 不在 vault {} 内",
            child.display(),
            root.display()
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
