// ============================================================
// 脚手架命令 —— 新用户 onboarding「创建我的知识库」一键生成规范骨架
// 仅对「空目录」写（新建 vault 豁免，无需备份）；绝不碰非空/已有 vault。
// 复用 services::contract 的目录/type 契约。详见 design vault-paradigm-scaffold Component 4。
// ============================================================

use crate::models::ScaffoldStats;
use crate::services::contract;
use std::fs;
use std::path::Path;

/// 目录是否已是 vault：含 00~09 任一顶层目录 或 含任意顶层 .md 文件
fn looks_like_vault(path: &Path) -> bool {
    for dir in contract::TOP_LEVEL_DIRS {
        if path.join(dir).is_dir() {
            return true;
        }
    }
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if entry.path().extension().and_then(|s| s.to_str()) == Some("md") {
                return true;
            }
        }
    }
    false
}

/// 目录是否为空（无任何条目）
fn is_empty_dir(path: &Path) -> bool {
    fs::read_dir(path)
        .map(|mut it| it.next().is_none())
        .unwrap_or(true)
}

/// 单种 type 的待填写模板（frontmatter 占位 + 引导文字，通用无私有业务内容）
fn type_template(type_name: &str, dir: &str) -> String {
    format!(
        "---\ntitle: 待填写\ncreated: YYYY-MM-DD\nupdated: YYYY-MM-DD\ntype: {t}\ntags: []\nsources: []\n---\n\n# {t}\n\n> 存放位置：`{dir}`\n> type 说明见根目录 `规范.md`「页面类型说明」。在此填写内容。\n",
        t = type_name,
        dir = dir
    )
}

/// 根目录 `规范.md` 通用模板（骨架，按契约生成，不含作者私有业务）
fn template_spec() -> String {
    let mut s = String::new();
    s.push_str("# 知识库规范\n\n> 本文件是知识库的结构契约（人读 + Agent 读）。由 Helmose 脚手架生成，可按需扩充。\n\n");
    s.push_str("## 目录结构\n\n```\n");
    for dir in contract::TOP_LEVEL_DIRS {
        s.push_str(&format!("├── {}/\n", dir));
    }
    s.push_str("```\n\n## 页面类型说明\n\n| type | 说明 | 存放目录 |\n|------|------|----------|\n");
    for t in contract::NOTE_TYPES {
        let dir = contract::type_to_dir(t).unwrap_or("");
        s.push_str(&format!("| {} | （待补充） | {} |\n", t, dir));
    }
    s.push_str(
        "\n## Frontmatter 模板\n\n```yaml\n---\ntitle: 页面标题\ncreated: YYYY-MM-DD\nupdated: YYYY-MM-DD\ntype: profile | person | project | strategy | book | course | tool | method | experience | comparison | query\ntags: []\nsources: []\n---\n```\n",
    );
    s
}

/// 根目录 `目录.md` 通用模板
fn template_index() -> String {
    let mut s = String::from("# 目录\n\n> 知识库总索引。新增页面后请在此登记。\n\n");
    for dir in contract::TOP_LEVEL_DIRS {
        s.push_str(&format!("- [[{}]]\n", dir));
    }
    s
}

/// 根目录 `README.md` 通用模板
fn template_readme() -> String {
    "# 我的人生知识库\n\n由 Helmose 脚手架生成，与 Obsidian / Hermes 共存。\n\n- `规范.md`：结构契约\n- `目录.md`：总索引\n- 顶层 `00_收件箱` ~ `09_核心知识库` 为资产域骨架\n\n开始记录你的人生数据。\n".to_string()
}

/// 脚手架核心逻辑（命令壳子转调它，便于单测）
fn scaffold_inner(target_path: &str) -> Result<ScaffoldStats, String> {
    let root = Path::new(target_path);

    if !root.exists() {
        fs::create_dir_all(root).map_err(|e| e.to_string())?;
    }
    if !is_empty_dir(root) {
        if looks_like_vault(root) {
            return Err("检测到已有 vault，请改用「打开已有 vault」并索引（脚手架不执行）".into());
        }
        return Err("目标目录非空，拒绝铺文件，请选择一个空目录".into());
    }

    let mut dirs_created = 0usize;
    let mut templates_created = 0usize;

    // 1. 00~09 顶层目录骨架
    for dir in contract::TOP_LEVEL_DIRS {
        fs::create_dir_all(root.join(dir)).map_err(|e| e.to_string())?;
        dirs_created += 1;
    }

    // 2. 11 种 type 待填写模板（放 type_to_dir 指定目录）
    for t in contract::NOTE_TYPES {
        if let Some(dir) = contract::type_to_dir(t) {
            let abs_dir = root.join(dir);
            fs::create_dir_all(&abs_dir).map_err(|e| e.to_string())?;
            let tmpl_path = abs_dir.join(format!("{}-模板.md", t));
            fs::write(&tmpl_path, type_template(t, dir)).map_err(|e| e.to_string())?;
            templates_created += 1;
        }
    }

    // 3. 根目录 规范.md / 目录.md / README.md
    fs::write(root.join("规范.md"), template_spec()).map_err(|e| e.to_string())?;
    fs::write(root.join("目录.md"), template_index()).map_err(|e| e.to_string())?;
    fs::write(root.join("README.md"), template_readme()).map_err(|e| e.to_string())?;

    Ok(ScaffoldStats {
        root_path: target_path.to_string(),
        dirs_created,
        templates_created,
        root_files_created: 3,
    })
}

/// 新建知识库骨架（onboarding「创建我的知识库」调用）。
/// 仅对空目录写；已有 vault 或非空目录拒绝，绝不偷偷铺文件。
#[tauri::command]
pub fn scaffold_vault(target_path: String) -> Result<ScaffoldStats, String> {
    scaffold_inner(&target_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// 构造唯一的临时目录（用进程 id + 唯一名，不依赖外部 crate）
    fn tmp(unique: &str) -> PathBuf {
        let p = std::env::temp_dir()
            .join(format!("helmose_scaffold_{}_{}", std::process::id(), unique));
        let _ = fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn 空目录生成完整骨架() {
        let root = tmp("empty");
        fs::create_dir_all(&root).unwrap();
        let stats = scaffold_inner(root.to_string_lossy().as_ref()).unwrap();
        assert_eq!(stats.dirs_created, 10);
        assert_eq!(stats.templates_created, 12);
        assert_eq!(stats.root_files_created, 3);
        for dir in contract::TOP_LEVEL_DIRS {
            assert!(root.join(dir).is_dir(), "缺目录 {}", dir);
        }
        assert!(root.join("规范.md").is_file());
        assert!(root.join("目录.md").is_file());
        assert!(root.join("README.md").is_file());
        // 11 个 type 模板各在其 type_to_dir 目录下
        let mut tmpl = 0;
        for t in contract::NOTE_TYPES {
            if let Some(d) = contract::type_to_dir(t) {
                if root.join(d).join(format!("{}-模板.md", t)).is_file() {
                    tmpl += 1;
                }
            }
        }
        assert_eq!(tmpl, 12);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn 不存在的嵌套路径会被创建() {
        let root = tmp("nested/new");
        let stats = scaffold_inner(root.to_string_lossy().as_ref()).unwrap();
        assert_eq!(stats.dirs_created, 10);
        assert!(root.join("00_收件箱").is_dir());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn 非空目录拒绝() {
        let root = tmp("nonempty");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("随便.txt"), "x").unwrap();
        let err = scaffold_inner(root.to_string_lossy().as_ref()).unwrap_err();
        assert!(err.contains("非空"), "应拒绝非空目录：{}", err);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn 已有_vault_拒绝() {
        let root = tmp("existing");
        fs::create_dir_all(root.join("01_企业与项目资产")).unwrap();
        let err = scaffold_inner(root.to_string_lossy().as_ref()).unwrap_err();
        assert!(err.contains("已有 vault"), "应识别已有 vault：{}", err);
        let _ = fs::remove_dir_all(&root);
    }

    /// scaffold → add_vault → index_vault_inner 链路：脚手架生成的模板 md 被正确索引入库。
    #[test]
    fn scaffold_then_add_then_index_pipeline() {
        use crate::commands::index::index_vault_inner;
        use crate::commands::vault::add_vault_inner;
        use crate::models::VaultInput;
        use crate::services::Database;
        use rusqlite::params;

        let root = tmp("pipeline");
        let stats = scaffold_inner(root.to_string_lossy().as_ref()).unwrap();
        assert_eq!(stats.templates_created, 12);

        // 临时 DB + 注册 vault + 全量索引
        let db_path = std::env::temp_dir().join(format!(
            "helmose_scaffold_db_{}_{}.db",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let db = Database::new(db_path).unwrap();
        db.init_schema().unwrap();

        let v = add_vault_inner(
            VaultInput {
                name: "scaffold".into(),
                root_path: root.to_string_lossy().to_string(),
                is_obsidian_shared: false,
            },
            &db,
        )
        .unwrap();

        let idx_stats = index_vault_inner(&v.id, &db).unwrap();
        // 12 个 type 模板 + 规范.md / 目录.md / README.md = 15 个 md
        assert_eq!(idx_stats.notes, 15, "骨架 15 个 md 应全部入库");

        // project-模板.md 的 frontmatter type=project → projects 表命中
        let projects: i64 = db
            .sqlite()
            .query_row(
                "SELECT COUNT(*) FROM projects WHERE vault_id = ?1",
                params![&v.id],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert!(
            projects >= 1,
            "project 模板应进 projects 表，实际 {}",
            projects
        );

        let _ = fs::remove_dir_all(&root);
    }
}
