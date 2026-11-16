//! SQLite storage for settings and translation history.

use std::path::Path;
use std::sync::Mutex;

use anyhow::Result;
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::types::Settings;

pub struct Store {
  conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
  pub id: i64,
  /// UTC, ISO 8601.
  pub created_at: String,
  pub source_lang: Option<String>,
  pub target_lang: String,
  pub original: Option<String>,
  pub translated: String,
  /// Groups the lines captured between one Start and Stop.
  pub session_id: Option<i64>,
}

impl Store {
  pub fn open(path: &Path) -> Result<Self> {
    Self::init(Connection::open(path)?)
  }

  pub fn in_memory() -> Result<Self> {
    Self::init(Connection::open_in_memory()?)
  }

  fn init(conn: Connection) -> Result<Self> {
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
       CREATE TABLE IF NOT EXISTS history (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
         source_lang TEXT,
         target_lang TEXT NOT NULL,
         original TEXT,
         translated TEXT NOT NULL
       );",
    )?;
    let has_session = conn
      .prepare("SELECT 1 FROM pragma_table_info('history') WHERE name = 'session_id'")?
      .exists([])?;
    if !has_session {
      conn.execute("ALTER TABLE history ADD COLUMN session_id INTEGER", [])?;
    }
    Ok(Self { conn: Mutex::new(conn) })
  }

  pub fn load_settings(&self) -> Settings {
    let conn = self.conn.lock().unwrap();
    let json = match conn.query_row("SELECT value FROM settings WHERE key = 'app'", [], |r| r.get::<_, String>(0)) {
      Ok(json) => json,
      Err(rusqlite::Error::QueryReturnedNoRows) => return Settings::default(),
      Err(e) => {
        eprintln!("[lingvo] could not read saved settings, using defaults: {e}");
        return Settings::default();
      }
    };
    serde_json::from_str(&json).unwrap_or_else(|e| {
      eprintln!("[lingvo] saved settings are unreadable, using defaults: {e}");
      Settings::default()
    })
  }

  pub fn save_settings(&self, settings: &Settings) -> Result<()> {
    let json = serde_json::to_string(settings)?;
    self.conn.lock().unwrap().execute(
      "INSERT INTO settings (key, value) VALUES ('app', ?1)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      params![json],
    )?;
    Ok(())
  }

  pub fn get_value(&self, key: &str) -> Option<String> {
    let conn = self.conn.lock().unwrap();
    conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0)).ok()
  }

  pub fn set_value(&self, key: &str, value: &str) -> Result<()> {
    self.conn.lock().unwrap().execute(
      "INSERT INTO settings (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      params![key, value],
    )?;
    Ok(())
  }

  pub fn add_history(
    &self,
    session_id: Option<i64>,
    source_lang: Option<&str>,
    target_lang: &str,
    original: Option<&str>,
    translated: &str,
  ) -> Result<()> {
    self.conn.lock().unwrap().execute(
      "INSERT INTO history (source_lang, target_lang, original, translated, session_id) VALUES (?1, ?2, ?3, ?4, ?5)",
      params![source_lang, target_lang, original, translated, session_id],
    )?;
    Ok(())
  }

  /// Newest first. With `session`, only that session's lines.
  pub fn history(&self, limit: u32, session: Option<i64>) -> Result<Vec<HistoryEntry>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, created_at, source_lang, target_lang, original, translated, session_id
       FROM history WHERE (?2 IS NULL OR session_id = ?2) ORDER BY id DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit, session], |r| {
      Ok(HistoryEntry {
        id: r.get(0)?,
        created_at: r.get(1)?,
        source_lang: r.get(2)?,
        target_lang: r.get(3)?,
        original: r.get(4)?,
        translated: r.get(5)?,
        session_id: r.get(6)?,
      })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
  }

  pub fn clear_history(&self) -> Result<()> {
    self.conn.lock().unwrap().execute("DELETE FROM history", [])?;
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn settings_round_trip_and_default() {
    let store = Store::in_memory().unwrap();
    assert_eq!(store.load_settings(), Settings::default());
    let mut s = Settings::default();
    s.target_lang = "fr".into();
    s.overlay.font_size = 44;
    store.save_settings(&s).unwrap();
    assert_eq!(store.load_settings(), s);
  }

  #[test]
  fn history_is_newest_first_and_clearable() {
    let store = Store::in_memory().unwrap();
    store.add_history(Some(7), Some("es"), "en", Some("Hola"), "Hello").unwrap();
    store.add_history(None, None, "en", None, "Bye").unwrap();
    let h = store.history(10, None).unwrap();
    assert_eq!(store.history(10, Some(7)).unwrap().len(), 1);
    assert_eq!(h.len(), 2);
    assert_eq!(h[0].translated, "Bye");
    assert_eq!(h[1].original.as_deref(), Some("Hola"));
    store.clear_history().unwrap();
    assert!(store.history(10, None).unwrap().is_empty());
  }
}
