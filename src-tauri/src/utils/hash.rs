// ============================================================
// content hash —— note 稳定标识（取代随机 uuid）
// 规范化正文（去 frontmatter 后）的 sha256：移动/重命名不变，编辑必变。
// 详见 design vault-paradigm-scaffold Component 3。
// ============================================================

use sha2::{Digest, Sha256};

/// 规范化正文：去 BOM → 行尾统一 LF → 去每行末尾空白 → 去整体首尾空白
fn normalize(body: &str) -> String {
    let no_bom = body.strip_prefix('\u{feff}').unwrap_or(body); // 去 BOM
    no_bom
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(|line| line.trim_end()) // 去每行末尾空白
        .collect::<Vec<_>>()
        .join("\n")
        .trim() // 去整体首尾空白
        .to_string()
}

/// 正文 content hash：sha256(规范化正文) 的 hex（64 字符），作 note 稳定主键
pub fn content_hash(body: &str) -> String {
    let normalized = normalize(body);
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    hex(&hasher.finalize())
}

/// 短哈希（hash 碰撞时叠加 rel_path 消歧用）：sha256 hex 前 8 位（32 bit）。
/// 同 vault 内两 rel_path 落同 8 位的概率 ~1/4G，可忽略；若未来 vault 规模使然可加长。
pub fn short_hash(s: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    hex(&hasher.finalize())[..8].to_string()
}

/// 字节 → 小写 hex
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 换行风格不影响_hash() {
        let a = content_hash("第一行\n第二行");
        assert_eq!(a, content_hash("第一行\r\n第二行")); // CRLF
        assert_eq!(a, content_hash("第一行\r第二行")); // CR
    }

    #[test]
    fn 行尾空白不影响_hash() {
        assert_eq!(content_hash("行内容\n另一行"), content_hash("行内容   \n另一行"));
    }

    #[test]
    fn bom_不影响_hash() {
        assert_eq!(content_hash("内容"), content_hash("\u{feff}内容"));
    }

    #[test]
    fn 整体首尾空白不影响_hash() {
        assert_eq!(content_hash("内容"), content_hash("\n\n内容\n\n"));
    }

    #[test]
    fn 内容微调必变_hash() {
        assert_ne!(content_hash("内容A"), content_hash("内容B"));
    }

    #[test]
    fn hash_为_64_位_hex() {
        let h = content_hash("x");
        assert_eq!(h.len(), 64);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn short_hash_8_位_hex() {
        let s = short_hash("01_企业与项目资产/x.md");
        assert_eq!(s.len(), 8);
        assert!(s.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
