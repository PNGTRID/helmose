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

/// 12 种 type 的填写引导：`(type, 一句话说明, 正文结构引导)`。
/// 通用骨架，不含作者私有业务内容（Req 2.4）。与 `contract::NOTE_TYPES` 对齐，
/// 测试断言每种 type 都有引导（防漂移）。说明用于规范.md 表，引导用于 type 模板正文。
const TYPE_GUIDES: &[(&str, &str, &str)] = &[
    ("profile", "个人画像——我是谁", "- **定位**：一句话说清你是谁、在做什么。\n- **价值观 / 原则**：指导你决策的核心信念。\n- **能力清单**：擅长什么、在持续精进什么。\n- **当前目标**：近期聚焦的主线（用 `[[wikilink]]` 关联 project/strategy）。\n- **关键数据**：可被 Agent 读取的结构化字段（专业领域、所在城市等）。"),
    ("person", "人物档案——关系人", "- **基础信息**：姓名、身份、与你的关系。\n- **背景**：经历、专长、兴趣。\n- **价值交换**：你能提供什么、对方能提供什么。\n- **互动记录**：上次见面 / 沟通要点、待跟进项（用 `[[wikilink]]` 关联事件）。\n- **标签**：人脉分类（如 mentor / 合作方 / 客户）。"),
    ("project", "项目——有目标有节点的推进单元", "- **目标**：这个项目要达成什么（尽量可量化）。\n- **状态**：进行中 / 已完成 / 暂停。\n- **里程碑**：关键节点 + 时间。\n- **关联主线**：服务于哪条主线 / OKR（链接）。\n- **关键事件**：用 `- ` 列表记录推进要事（会被 events 索引提取）。\n- **任务**：待办用 `- [ ]` + `📅 YYYY-MM-DD` 标截止。"),
    ("strategy", "运营策略——方向与取舍", "- **策略方向**：要解决的核心问题 + 取舍逻辑。\n- **决策依据**：数据 / 观察 / 假设。\n- **执行路径**：分步骤的行动。\n- **生效范围**：适用于哪些项目 / 场景。\n- **复盘锚点**：何时回看、用什么指标判断成败。"),
    ("book", "书籍——读书笔记", "- **书名 / 作者**：基本信息。\n- **核心观点**：3-5 条最打动你的论点。\n- **摘录**：高价值原文片段（标注页码）。\n- **应用**：会怎么用到自己的项目 / 生活。\n- **评价**：推荐度 / 适读人群。"),
    ("course", "课程——学习记录", "- **课程 / 讲师**：基本信息。\n- **模块大纲**：课程结构。\n- **核心收获**：每个模块的要点。\n- **作业 / 实操**：练习记录。\n- **应用**：如何转化为行动。"),
    ("tool", "工具——使用与技巧", "- **用途**：解决什么问题。\n- **上手要点**：安装 / 配置 / 关键设置。\n- **使用技巧**：提效用法、快捷键、模板。\n- **对比**：与同类工具的差异（可链接 `[[comparison]]`）。\n- **坑 / 注意**：踩过的雷。"),
    ("method", "方法论——可复用的做法", "- **定义**：这是什么方法、解决什么问题。\n- **适用场景**：何时用、何时不用。\n- **步骤**：操作流程（编号清单）。\n- **案例**：自己实践的真实例子。\n- **局限**：边界与反例。"),
    ("experience", "经历——事件与反思", "- **时间 / 地点**：事件基本要素。\n- **事件经过**：发生了什么。\n- **感受 / 反思**：当时的情绪与现在的视角。\n- **教训**：可复用的经验。\n- **关联**：链接到相关人 / 项目 / 方法论。"),
    ("comparison", "对比分析——决策依据", "- **对比对象**：列出比较的若干选项。\n- **对比维度**：用表格呈现（维度 × 选项）。\n- **结论**：各场景下的推荐选择。\n- **依据**：数据 / 实测 / 来源（写进 frontmatter `sources`）。\n- **决策**：你最终选了什么、为什么。"),
    ("log", "日志——每日记录与复盘", "- **今日要事**：当天关键事件 / 决策（`- ` 列表，会被 events 提取）。\n- **进展**：推进了哪些项目 / 任务。\n- **复盘**：做得好的 / 要改进的。\n- **明日计划**：下一步聚焦。"),
    ("query", "待解决问题——开放疑问", "- **问题**：要回答的核心疑问。\n- **背景**：为什么问这个。\n- **已知**：目前掌握的信息。\n- **待查**：还需要搞清楚的点。\n- **结论**：找到答案后填写（可链接到 method / comparison）。"),
];

/// type 的一句话说明（用于规范.md「页面类型说明」表；缺失兜底「（待补充）」）
fn type_desc(t: &str) -> &'static str {
    TYPE_GUIDES
        .iter()
        .find(|(k, _, _)| *k == t)
        .map(|(_, d, _)| *d)
        .unwrap_or("（待补充）")
}

/// type 的正文填写引导（用于 type 模板正文；缺失兜底通用提示）
fn type_guide(t: &str) -> &'static str {
    TYPE_GUIDES
        .iter()
        .find(|(k, _, _)| *k == t)
        .map(|(_, _, g)| *g)
        .unwrap_or("在此填写内容。")
}

/// 单种 type 的待填写模板（frontmatter 占位 + 该 type 专属填写引导，通用无私有业务内容）
fn type_template(type_name: &str, dir: &str) -> String {
    format!(
        "---\ntitle: 待填写\ncreated: YYYY-MM-DD\nupdated: YYYY-MM-DD\ntype: {t}\ntags: []\nsources: []\n---\n\n# {t}\n\n> 存放位置：`{dir}`\n> type 说明：{desc}\n\n## 内容引导\n\n{guide}\n",
        t = type_name,
        dir = dir,
        desc = type_desc(type_name),
        guide = type_guide(type_name),
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
        s.push_str(&format!("| {} | {} | {} |\n", t, type_desc(t), dir));
    }
    s.push_str(
        "\n## Frontmatter 模板\n\n```yaml\n---\ntitle: 页面标题\ncreated: YYYY-MM-DD\nupdated: YYYY-MM-DD\ntype: profile | person | project | strategy | book | course | tool | method | experience | comparison | query | log\ntags: []\nsources: []\n---\n```\n",
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

    // 2. 12 种 type 待填写模板（放 type_to_dir 指定目录）
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

    #[test]
    fn 每种_type_都有填写引导() {
        // TYPE_GUIDES 必须覆盖全部 contract::NOTE_TYPES（防脚手架引导与契约漂移）
        assert_eq!(
            TYPE_GUIDES.len(),
            contract::NOTE_TYPES.len(),
            "TYPE_GUIDES 数量应与 NOTE_TYPES 一致"
        );
        for t in contract::NOTE_TYPES {
            assert!(
                TYPE_GUIDES.iter().any(|(k, _, _)| k == t),
                "type {} 缺填写引导",
                t
            );
            assert_ne!(type_desc(t), "（待补充）", "type {} 的说明不应是兜底", t);
            assert_ne!(type_guide(t), "在此填写内容。", "type {} 的引导不应是兜底", t);
        }
        // 反向：TYPE_GUIDES 里的 type 必须都在契约内（防引入非契约 type）
        for (t, _, _) in TYPE_GUIDES {
            assert!(contract::NOTE_TYPES.contains(t), "TYPE_GUIDES 含非契约 type {}", t);
        }
    }

    #[test]
    fn type_template_含_frontmatter_与专属引导() {
        // project 模板应含 frontmatter type=project + 存放位置 + 内容引导标题 + project 专属引导关键词
        let tmpl = type_template("project", "01_企业与项目资产/");
        assert!(tmpl.contains("type: project"), "应有 frontmatter type: project：{}", tmpl);
        assert!(tmpl.contains("存放位置"), "应含存放位置提示：{}", tmpl);
        assert!(tmpl.contains("## 内容引导"), "应含引导标题：{}", tmpl);
        assert!(tmpl.contains("里程碑"), "project 模板应含专属引导关键词：{}", tmpl);
        // frontmatter 字段齐全
        for field in ["title:", "created:", "updated:", "tags:", "sources:"] {
            assert!(tmpl.contains(field), "frontmatter 缺字段 {}", field);
        }
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
