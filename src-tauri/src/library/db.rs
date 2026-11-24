use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use rusqlite::{params, Connection};
use crate::midi::{HandRole, SongSettings, SongSummary};

const SCHEMA_VERSION: i32 = 2;

#[derive(Debug, Clone)]
pub struct CachedSongStat {
    pub content_hash: String,
    pub file_path: String,
    pub relative_path: String,
    pub folder: String,
    pub title: String,
    pub file_size: i64,
    pub file_mtime_ms: i64,
}

#[derive(Debug, Clone)]
pub struct ScannedSongRecord {
    pub summary: SongSummary,
    pub file_size: i64,
    pub file_mtime_ms: i64,
}

#[derive(Debug, Clone)]
pub struct SongLocationUpdate {
    pub content_hash: String,
    pub file_path: String,
    pub relative_path: String,
    pub folder: String,
    pub title: String,
    pub file_size: i64,
    pub file_mtime_ms: i64,
}

pub struct LibraryDb {
    conn: Mutex<Connection>,
}

impl LibraryDb {
    pub fn new(db_path: &Path) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create database directory {:?}: {}", parent, e))?;
        }

        let conn = Connection::open(db_path)
            .map_err(|e| format!("Failed to open SQLite database at {:?}: {}", db_path, e))?;

        let db = Self {
            conn: Mutex::new(conn),
        };

        db.init_tables()?;
        Ok(db)
    }

    #[cfg(test)]
    pub fn new_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory()
            .map_err(|e| format!("Failed to open in-memory SQLite: {}", e))?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_tables()?;
        Ok(db)
    }

    pub fn init_tables(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA busy_timeout = 5000;

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )
        .map_err(|e| format!("Failed to configure database pragmas: {}", e))?;

        let current_version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap_or(0);

        if current_version < SCHEMA_VERSION {
            // Cleanly rebuild library tables (preserves app_settings like root_folder, theme, shortcuts, soundfont)
            conn.execute_batch(
                r#"
                DROP TABLE IF EXISTS song_settings;
                DROP TABLE IF EXISTS songs;
                "#,
            )
            .map_err(|e| format!("Failed to reset library tables for schema v{}: {}", SCHEMA_VERSION, e))?;
        }

        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS songs (
                content_hash TEXT PRIMARY KEY,
                relative_path TEXT NOT NULL,
                file_path TEXT NOT NULL,
                title TEXT NOT NULL,
                folder TEXT NOT NULL,
                file_size INTEGER NOT NULL DEFAULT 0,
                file_mtime_ms INTEGER NOT NULL DEFAULT 0,
                duration_sec REAL NOT NULL,
                initial_bpm REAL NOT NULL,
                track_count INTEGER NOT NULL,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                last_played_at INTEGER,
                added_at INTEGER NOT NULL DEFAULT 0,
                peak_start_sec REAL NOT NULL DEFAULT 0.0,
                preview_peak_json TEXT NOT NULL DEFAULT '[]',
                preview_start_json TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS song_settings (
                content_hash TEXT PRIMARY KEY,
                track_hands_json TEXT NOT NULL DEFAULT '{}',
                split_point_midi INTEGER NOT NULL DEFAULT 60,
                use_split_point INTEGER NOT NULL DEFAULT 0,
                tempo_scale REAL NOT NULL DEFAULT 1.0,
                loop_enabled INTEGER NOT NULL DEFAULT 0,
                loop_start_sec REAL,
                loop_end_sec REAL,
                FOREIGN KEY (content_hash) REFERENCES songs(content_hash) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
            CREATE INDEX IF NOT EXISTS idx_songs_file_path ON songs(file_path);
            "#,
        )
        .map_err(|e| format!("Failed to initialize database tables: {}", e))?;

        if current_version < SCHEMA_VERSION {
            conn.pragma_update(None, "user_version", SCHEMA_VERSION)
                .map_err(|e| format!("Failed to update schema version: {}", e))?;
        }

        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT value FROM app_settings WHERE key = ?1")
            .map_err(|e| e.to_string())?;

        let mut rows = stmt.query(params![key]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let val: String = row.get(0).map_err(|e| e.to_string())?;
            Ok(Some(val))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Loads a lightweight index of all songs for O(1) stat-first folder scanning.
    /// Returns (file_path -> CachedSongStat, set of known content_hashes).
    pub fn get_song_file_index(
        &self,
    ) -> Result<(HashMap<String, CachedSongStat>, HashSet<String>), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT content_hash, file_path, relative_path, folder, title, file_size, file_mtime_ms
                 FROM songs",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(CachedSongStat {
                    content_hash: row.get(0)?,
                    file_path: row.get(1)?,
                    relative_path: row.get(2)?,
                    folder: row.get(3)?,
                    title: row.get(4)?,
                    file_size: row.get(5)?,
                    file_mtime_ms: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut by_path = HashMap::new();
        let mut known_hashes = HashSet::new();
        for r in rows {
            let stat = r.map_err(|e| e.to_string())?;
            known_hashes.insert(stat.content_hash.clone());
            by_path.insert(stat.file_path.clone(), stat);
        }

        Ok((by_path, known_hashes))
    }

    /// Applies a batch of new/parsed songs and moved/renamed location updates in a single transaction.
    pub fn apply_scan_batch(
        &self,
        inserts: &[ScannedSongRecord],
        updates: &[SongLocationUpdate],
    ) -> Result<(), String> {
        if inserts.is_empty() && updates.is_empty() {
            return Ok(());
        }

        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        if !inserts.is_empty() {
            let mut upsert_stmt = tx
                .prepare_cached(
                    "INSERT INTO songs (
                        content_hash, relative_path, file_path, title, folder,
                        file_size, file_mtime_ms, duration_sec, initial_bpm, track_count,
                        is_favorite, last_played_at, added_at, peak_start_sec,
                        preview_peak_json, preview_start_json
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
                    ON CONFLICT(content_hash) DO UPDATE SET
                        relative_path = excluded.relative_path,
                        file_path = excluded.file_path,
                        title = excluded.title,
                        folder = excluded.folder,
                        file_size = excluded.file_size,
                        file_mtime_ms = excluded.file_mtime_ms,
                        duration_sec = excluded.duration_sec,
                        initial_bpm = excluded.initial_bpm,
                        track_count = excluded.track_count,
                        peak_start_sec = excluded.peak_start_sec,
                        preview_peak_json = excluded.preview_peak_json,
                        preview_start_json = excluded.preview_start_json",
                )
                .map_err(|e| e.to_string())?;

            for rec in inserts {
                let song = &rec.summary;
                upsert_stmt
                    .execute(params![
                        song.content_hash,
                        song.relative_path,
                        song.file_path,
                        song.title,
                        song.folder,
                        rec.file_size,
                        rec.file_mtime_ms,
                        song.duration_sec,
                        song.initial_bpm,
                        song.track_count,
                        if song.is_favorite { 1 } else { 0 },
                        song.last_played_at,
                        song.added_at,
                        song.peak_start_sec,
                        song.preview_peak_json,
                        song.preview_start_json,
                    ])
                    .map_err(|e| e.to_string())?;
            }
        }

        if !updates.is_empty() {
            let mut update_stmt = tx
                .prepare_cached(
                    "UPDATE songs
                     SET file_path = ?1, relative_path = ?2, folder = ?3, title = ?4,
                         file_size = ?5, file_mtime_ms = ?6
                     WHERE content_hash = ?7",
                )
                .map_err(|e| e.to_string())?;

            for upd in updates {
                update_stmt
                    .execute(params![
                        upd.file_path,
                        upd.relative_path,
                        upd.folder,
                        upd.title,
                        upd.file_size,
                        upd.file_mtime_ms,
                        upd.content_hash,
                    ])
                    .map_err(|e| e.to_string())?;
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_all_songs(&self) -> Result<Vec<SongSummary>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT content_hash, relative_path, file_path, title, folder,
                        duration_sec, initial_bpm, track_count, is_favorite, last_played_at,
                        added_at, peak_start_sec, preview_peak_json, preview_start_json
                 FROM songs
                 ORDER BY is_favorite DESC, title COLLATE NOCASE ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                let is_fav_int: i32 = row.get(8)?;
                Ok(SongSummary {
                    content_hash: row.get(0)?,
                    relative_path: row.get(1)?,
                    file_path: row.get(2)?,
                    title: row.get(3)?,
                    folder: row.get(4)?,
                    duration_sec: row.get(5)?,
                    initial_bpm: row.get(6)?,
                    track_count: row.get(7)?,
                    is_favorite: is_fav_int != 0,
                    last_played_at: row.get(9)?,
                    added_at: row.get(10)?,
                    peak_start_sec: row.get(11)?,
                    preview_peak_json: row.get(12)?,
                    preview_start_json: row.get(13)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut songs = Vec::new();
        for r in rows {
            songs.push(r.map_err(|e| e.to_string())?);
        }
        Ok(songs)
    }

    pub fn get_song_by_hash(&self, content_hash: &str) -> Result<Option<SongSummary>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT content_hash, relative_path, file_path, title, folder,
                        duration_sec, initial_bpm, track_count, is_favorite, last_played_at,
                        added_at, peak_start_sec, preview_peak_json, preview_start_json
                 FROM songs
                 WHERE content_hash = ?1",
            )
            .map_err(|e| e.to_string())?;

        let mut rows = stmt.query(params![content_hash]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let is_fav_int: i32 = row.get(8).map_err(|e| e.to_string())?;
            Ok(Some(SongSummary {
                content_hash: row.get(0).map_err(|e| e.to_string())?,
                relative_path: row.get(1).map_err(|e| e.to_string())?,
                file_path: row.get(2).map_err(|e| e.to_string())?,
                title: row.get(3).map_err(|e| e.to_string())?,
                folder: row.get(4).map_err(|e| e.to_string())?,
                duration_sec: row.get(5).map_err(|e| e.to_string())?,
                initial_bpm: row.get(6).map_err(|e| e.to_string())?,
                track_count: row.get(7).map_err(|e| e.to_string())?,
                is_favorite: is_fav_int != 0,
                last_played_at: row.get(9).map_err(|e| e.to_string())?,
                added_at: row.get(10).map_err(|e| e.to_string())?,
                peak_start_sec: row.get(11).map_err(|e| e.to_string())?,
                preview_peak_json: row.get(12).map_err(|e| e.to_string())?,
                preview_start_json: row.get(13).map_err(|e| e.to_string())?,
            }))
        } else {
            Ok(None)
        }
    }

    /// Upserts a single song (used for single-file indexing, e.g. newly saved recordings).
    /// Removes any stale row at the same `file_path` with a different `content_hash` first.
    pub fn upsert_song(&self, song: &SongSummary, file_size: i64, file_mtime_ms: i64) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        tx.execute(
            "DELETE FROM songs WHERE file_path = ?1 AND content_hash != ?2",
            params![song.file_path, song.content_hash],
        )
        .map_err(|e| e.to_string())?;

        tx.execute(
            "INSERT INTO songs (
                content_hash, relative_path, file_path, title, folder,
                file_size, file_mtime_ms, duration_sec, initial_bpm, track_count,
                is_favorite, last_played_at, added_at, peak_start_sec,
                preview_peak_json, preview_start_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
            ON CONFLICT(content_hash) DO UPDATE SET
                relative_path = excluded.relative_path,
                file_path = excluded.file_path,
                title = excluded.title,
                folder = excluded.folder,
                file_size = excluded.file_size,
                file_mtime_ms = excluded.file_mtime_ms,
                duration_sec = excluded.duration_sec,
                initial_bpm = excluded.initial_bpm,
                track_count = excluded.track_count,
                peak_start_sec = excluded.peak_start_sec,
                preview_peak_json = excluded.preview_peak_json,
                preview_start_json = excluded.preview_start_json",
            params![
                song.content_hash,
                song.relative_path,
                song.file_path,
                song.title,
                song.folder,
                file_size,
                file_mtime_ms,
                song.duration_sec,
                song.initial_bpm,
                song.track_count,
                if song.is_favorite { 1 } else { 0 },
                song.last_played_at,
                song.added_at,
                song.peak_start_sec,
                song.preview_peak_json,
                song.preview_start_json,
            ],
        )
        .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn touch_last_played(&self, content_hash: &str, timestamp_ms: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE songs SET last_played_at = ?1 WHERE content_hash = ?2",
            params![timestamp_ms, content_hash],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Direct O(1) update for in-app song move or rename without rescanning the library.
    pub fn update_song_location_by_path(
        &self,
        old_file_path: &str,
        new_file_path: &str,
        new_relative_path: &str,
        new_folder: &str,
        new_title: Option<&str>,
        file_size: i64,
        file_mtime_ms: i64,
    ) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let updated = if let Some(title) = new_title {
            conn.execute(
                "UPDATE songs
                 SET file_path = ?1, relative_path = ?2, folder = ?3, title = ?4,
                     file_size = ?5, file_mtime_ms = ?6
                 WHERE file_path = ?7",
                params![
                    new_file_path,
                    new_relative_path,
                    new_folder,
                    title,
                    file_size,
                    file_mtime_ms,
                    old_file_path,
                ],
            )
            .map_err(|e| e.to_string())?
        } else {
            conn.execute(
                "UPDATE songs
                 SET file_path = ?1, relative_path = ?2, folder = ?3,
                     file_size = ?4, file_mtime_ms = ?5
                 WHERE file_path = ?6",
                params![
                    new_file_path,
                    new_relative_path,
                    new_folder,
                    file_size,
                    file_mtime_ms,
                    old_file_path,
                ],
            )
            .map_err(|e| e.to_string())?
        };
        Ok(updated)
    }

    /// Removes all songs whose `file_path` or `content_hash` is no longer present on disk in a single transaction.
    /// Linked `song_settings` rows are automatically removed via `ON DELETE CASCADE`.
    pub fn remove_stale_songs(
        &self,
        current_file_paths: &HashSet<String>,
        current_hashes: &HashSet<String>,
    ) -> Result<usize, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        if current_file_paths.is_empty() || current_hashes.is_empty() {
            let removed = tx
                .execute("DELETE FROM songs", [])
                .map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
            return Ok(removed);
        }

        let to_delete: Vec<String> = {
            let mut stmt = tx
                .prepare("SELECT file_path, content_hash FROM songs")
                .map_err(|e| e.to_string())?;

            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?;

            let mut stale = Vec::new();
            for r in rows {
                let (path, hash) = r.map_err(|e| e.to_string())?;
                if !current_file_paths.contains(&path) || !current_hashes.contains(&hash) {
                    stale.push(hash);
                }
            }
            stale
        };

        let mut removed_count = 0;
        if !to_delete.is_empty() {
            let mut del_stmt = tx
                .prepare_cached("DELETE FROM songs WHERE content_hash = ?1")
                .map_err(|e| e.to_string())?;
            for hash in to_delete {
                removed_count += del_stmt.execute(params![hash]).map_err(|e| e.to_string())?;
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(removed_count)
    }

    pub fn delete_song_by_path(&self, file_path: &str) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let deleted = conn
            .execute("DELETE FROM songs WHERE file_path = ?1", params![file_path])
            .map_err(|e| e.to_string())?;
        Ok(deleted)
    }

    pub fn toggle_favorite(&self, content_hash: &str) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let current_fav: i32 = conn
            .query_row(
                "SELECT is_favorite FROM songs WHERE content_hash = ?1",
                params![content_hash],
                |row| row.get(0),
            )
            .map_err(|e| format!("Song not found: {}", e))?;

        let new_fav = if current_fav == 0 { 1 } else { 0 };
        conn.execute(
            "UPDATE songs SET is_favorite = ?1 WHERE content_hash = ?2",
            params![new_fav, content_hash],
        )
        .map_err(|e| e.to_string())?;

        Ok(new_fav != 0)
    }

    /// Reads per-song settings without eagerly inserting default rows into `song_settings`.
    pub fn get_song_settings(&self, content_hash: &str) -> Result<SongSettings, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT track_hands_json, split_point_midi, use_split_point,
                        tempo_scale, loop_enabled, loop_start_sec, loop_end_sec
                 FROM song_settings
                 WHERE content_hash = ?1",
            )
            .map_err(|e| e.to_string())?;

        let mut rows = stmt.query(params![content_hash]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let track_hands_json: String = row.get(0).map_err(|e| e.to_string())?;
            let track_hands: HashMap<u32, HandRole> =
                serde_json::from_str(&track_hands_json).unwrap_or_default();
            let split_point_midi: u8 = row.get(1).map_err(|e| e.to_string())?;
            let use_split_int: i32 = row.get(2).map_err(|e| e.to_string())?;
            let tempo_scale: f64 = row.get(3).map_err(|e| e.to_string())?;
            let loop_enabled_int: i32 = row.get(4).map_err(|e| e.to_string())?;
            let loop_start_sec: Option<f64> = row.get(5).map_err(|e| e.to_string())?;
            let loop_end_sec: Option<f64> = row.get(6).map_err(|e| e.to_string())?;

            Ok(SongSettings {
                content_hash: content_hash.to_string(),
                track_hands,
                split_point_midi,
                use_split_point: use_split_int != 0,
                tempo_scale,
                loop_enabled: loop_enabled_int != 0,
                loop_start_sec,
                loop_end_sec,
            })
        } else {
            Ok(SongSettings {
                content_hash: content_hash.to_string(),
                ..Default::default()
            })
        }
    }

    pub fn save_song_settings(&self, settings: &SongSettings) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Ensure the song exists in `songs` before inserting so out-of-library files never violate FK or create orphans
        let song_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM songs WHERE content_hash = ?1)",
                params![settings.content_hash],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        if !song_exists {
            return Ok(());
        }

        let track_hands_json =
            serde_json::to_string(&settings.track_hands).unwrap_or_else(|_| "{}".to_string());

        conn.execute(
            "INSERT INTO song_settings (
                content_hash, track_hands_json, split_point_midi, use_split_point,
                tempo_scale, loop_enabled, loop_start_sec, loop_end_sec
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(content_hash) DO UPDATE SET
                track_hands_json = excluded.track_hands_json,
                split_point_midi = excluded.split_point_midi,
                use_split_point = excluded.use_split_point,
                tempo_scale = excluded.tempo_scale,
                loop_enabled = excluded.loop_enabled,
                loop_start_sec = excluded.loop_start_sec,
                loop_end_sec = excluded.loop_end_sec",
            params![
                settings.content_hash,
                track_hands_json,
                settings.split_point_midi,
                if settings.use_split_point { 1 } else { 0 },
                settings.tempo_scale,
                if settings.loop_enabled { 1 } else { 0 },
                settings.loop_start_sec,
                settings.loop_end_sec,
            ],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_summary(hash: &str, path: &str, title: &str) -> SongSummary {
        SongSummary {
            content_hash: hash.to_string(),
            relative_path: format!("Chopin/{}.mid", title),
            file_path: path.to_string(),
            title: title.to_string(),
            folder: "Chopin".to_string(),
            duration_sec: 180.0,
            initial_bpm: 132.0,
            track_count: 2,
            is_favorite: false,
            last_played_at: None,
            added_at: 1000,
            peak_start_sec: 15.0,
            preview_peak_json: "[]".to_string(),
            preview_start_json: "[]".to_string(),
        }
    }

    #[test]
    fn test_db_crud_and_cascade_delete() {
        let db = LibraryDb::new_in_memory().expect("Failed to create in-memory db");

        db.set_setting("root_folder", "/test/midi")
            .expect("Failed to set root_folder");
        let root = db
            .get_setting("root_folder")
            .expect("Failed to get setting");
        assert_eq!(root.as_deref(), Some("/test/midi"));

        let summary = sample_summary("hash123", "/test/midi/Chopin/nocturne.mid", "Nocturne Op 9 No 2");
        db.upsert_song(&summary, 4096, 1700000000000)
            .expect("Failed to upsert song");

        let all = db.get_all_songs().expect("Failed to get all songs");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "Nocturne Op 9 No 2");

        // Verify stat index
        let (by_path, hashes) = db.get_song_file_index().expect("Failed to load file index");
        assert!(hashes.contains("hash123"));
        assert_eq!(by_path["/test/midi/Chopin/nocturne.mid"].file_size, 4096);
        assert_eq!(by_path["/test/midi/Chopin/nocturne.mid"].file_mtime_ms, 1700000000000);

        // Toggle favorite
        let is_fav = db.toggle_favorite("hash123").expect("Failed to toggle fav");
        assert!(is_fav);

        // Song settings persistence
        let mut settings = db.get_song_settings("hash123").unwrap();
        assert_eq!(settings.tempo_scale, 1.0);
        settings.tempo_scale = 1.25;
        settings.loop_enabled = true;
        settings.loop_start_sec = Some(10.0);
        settings.loop_end_sec = Some(30.0);
        db.save_song_settings(&settings).unwrap();

        let loaded_settings = db.get_song_settings("hash123").unwrap();
        assert_eq!(loaded_settings.tempo_scale, 1.25);
        assert!(loaded_settings.loop_enabled);

        // Removing the song must cascade-delete its song_settings row (zero orphans)
        let empty = HashSet::new();
        let removed = db.remove_stale_songs(&empty, &empty).unwrap();
        assert_eq!(removed, 1);

        let settings_count: i64 = {
            let conn = db.conn.lock().unwrap();
            conn.query_row("SELECT COUNT(*) FROM song_settings", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(settings_count, 0, "song_settings should cascade delete with songs");
    }

    #[test]
    fn test_save_settings_ignores_nonexistent_song() {
        let db = LibraryDb::new_in_memory().expect("Failed to create in-memory db");
        let settings = SongSettings {
            content_hash: "orphan_hash".to_string(),
            tempo_scale: 0.75,
            ..Default::default()
        };
        db.save_song_settings(&settings).expect("Should not error on missing song");

        let settings_count: i64 = {
            let conn = db.conn.lock().unwrap();
            conn.query_row("SELECT COUNT(*) FROM song_settings", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(settings_count, 0, "Should not insert orphan song_settings row");
    }
}
