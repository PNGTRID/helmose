// ============================================================
// SQLite 直接访问层 (rusqlite) —— 仿 baimo_desktop，加 WAL/busy_timeout
// 单连接 + Mutex 互斥（桌面单用户场景够用）
// ============================================================

use rusqlite::{Connection, Result as SqliteResult, Row};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct SqliteDatabase {
    connection: Arc<Mutex<Connection>>,
}

impl SqliteDatabase {
    pub fn new(db_path: PathBuf) -> SqliteResult<Self> {
        let conn = Connection::open(&db_path)?;
        // PRAGMA 用 execute_batch：journal_mode 会返回行，execute() 会报
        // ExecuteReturnedResults；execute_batch 不检查返回行，故安全
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;",
        )?;

        Ok(Self {
            connection: Arc::new(Mutex::new(conn)),
        })
    }

    /// 执行查询并返回多行
    pub fn query_map<T, F>(
        &self,
        sql: &str,
        params: &[&dyn rusqlite::ToSql],
        mut f: F,
    ) -> SqliteResult<Vec<T>>
    where
        F: FnMut(&Row) -> SqliteResult<T>,
    {
        let conn = self.connection.lock().unwrap();
        let mut stmt = conn.prepare(sql)?;
        let rows: SqliteResult<Vec<T>> = stmt.query_map(params, &mut f)?.collect();
        drop(stmt);
        drop(conn);
        rows
    }

    /// 执行查询并返回单行（无行返回 None）
    pub fn query_row<T, F>(
        &self,
        sql: &str,
        params: &[&dyn rusqlite::ToSql],
        f: F,
    ) -> SqliteResult<Option<T>>
    where
        F: FnOnce(&Row) -> SqliteResult<T>,
    {
        let conn = self.connection.lock().unwrap();
        let result = conn.query_row(sql, params, f);
        drop(conn);
        match result {
            Ok(row) => Ok(Some(row)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 执行 SQL（INSERT/UPDATE/DELETE）
    pub fn execute(
        &self,
        sql: &str,
        params: &[&dyn rusqlite::ToSql],
    ) -> SqliteResult<usize> {
        let conn = self.connection.lock().unwrap();
        let result = conn.execute(sql, params)?;
        drop(conn);
        Ok(result)
    }

    /// 事务封装
    pub fn transaction<F, R>(&self, f: F) -> SqliteResult<R>
    where
        F: FnOnce(&rusqlite::Transaction) -> SqliteResult<R>,
    {
        let conn = self.connection.lock().unwrap();
        let result = {
            let tx = conn.unchecked_transaction()?;
            let r = f(&tx);
            match &r {
                Ok(_) => {
                    tx.commit()?;
                }
                Err(_) => {
                    let _ = tx.rollback();
                }
            }
            r
        };
        drop(conn);
        result
    }
}
