use std::path::Path;
use std::sync::Mutex;
use rusqlite::{params, Connection};
use crate::midi::{HandRole, SongSettings, SongSummary};

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
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS songs (
                content_hash TEXT PRIMARY KEY,
                relative_path TEXT NOT NULL,
                file_path TEXT NOT NULL,
                title TEXT NOT NULL,
                folder TEXT NOT NULL,
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
                loop_end_sec REAL
            );

            CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
            CREATE INDEX IF NOT EXISTS idx_songs_file_path ON songs(file_path);
            "#,
        )
        .map_err(|e| format!("Failed to initialize database tables: {}", e))?;

        // Safe idempotent migrations for existing databases
        let _ = conn.execute("ALTER TABLE songs ADD COLUMN peak_start_sec REAL NOT NULL DEFAULT 0.0", []);
        let _ = conn.execute("ALTER TABLE songs ADD COLUMN preview_peak_json TEXT NOT NULL DEFAULT '[]'", []);
        let _ = conn.execute("ALTER TABLE songs ADD COLUMN preview_start_json TEXT NOT NULL DEFAULT '[]'", []);
        let _ = conn.execute("ALTER TABLE songs ADD COLUMN added_at INTEGER NOT NULL DEFAULT 0", []);

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

    pub fn upsert_song(&self, song: &SongSummary) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO songs (
                content_hash, relative_path, file_path, title, folder,
                duration_sec, initial_bpm, track_count, is_favorite, last_played_at,
                added_at, peak_start_sec, preview_peak_json, preview_start_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            ON CONFLICT(content_hash) DO UPDATE SET
                relative_path = excluded.relative_path,
                file_path = excluded.file_path,
                title = excluded.title,
                folder = excluded.folder,
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
        Ok(())
    }

    pub fn update_song_added_at(&self, content_hash: &str, added_at: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE songs SET added_at = ?1 WHERE content_hash = ?2",
            params![added_at, content_hash],
        )
        .map_err(|e| e.to_string())?;
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

    pub fn update_song_previews(
        &self,
        content_hash: &str,
        peak_start_sec: f64,
        preview_peak_json: &str,
        preview_start_json: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE songs SET peak_start_sec = ?1, preview_peak_json = ?2, preview_start_json = ?3 WHERE content_hash = ?4",
            params![peak_start_sec, preview_peak_json, preview_start_json, content_hash],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_song_paths(
        &self,
        content_hash: &str,
        file_path: &str,
        relative_path: &str,
        folder: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE songs SET file_path = ?1, relative_path = ?2, folder = ?3 WHERE content_hash = ?4",
            params![file_path, relative_path, folder, content_hash],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_song_metadata(
        &self,
        content_hash: &str,
        file_path: &str,
        relative_path: &str,
        folder: &str,
        title: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE songs SET file_path = ?1, relative_path = ?2, folder = ?3, title = ?4 WHERE content_hash = ?5",
            params![file_path, relative_path, folder, title, content_hash],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_song_bpm(&self, content_hash: &str, initial_bpm: f64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE songs SET initial_bpm = ?1 WHERE content_hash = ?2",
            params![initial_bpm, content_hash],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_stale_songs(&self, current_file_paths: &[String]) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        if current_file_paths.is_empty() {
            let removed = conn
                .execute("DELETE FROM songs", [])
                .map_err(|e| e.to_string())?;
            return Ok(removed);
        }

        // Fetch all registered file paths from DB
        let mut stmt = conn
            .prepare("SELECT file_path, content_hash FROM songs")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;

        let mut to_delete: Vec<String> = Vec::new();
        let path_set: std::collections::HashSet<&str> =
            current_file_paths.iter().map(|s| s.as_str()).collect();

        for r in rows {
            let (path, hash) = r.map_err(|e| e.to_string())?;
            if !path_set.contains(path.as_str()) {
                to_delete.push(hash);
            }
        }

        let mut removed_count = 0;
        for hash in to_delete {
            conn.execute("DELETE FROM songs WHERE content_hash = ?1", params![hash])
                .map_err(|e| e.to_string())?;
            removed_count += 1;
        }

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
            let track_hands: std::collections::HashMap<u32, HandRole> =
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
            // Default settings
            let default_settings = SongSettings {
                content_hash: content_hash.to_string(),
                ..Default::default()
            };
            self.save_song_settings_with_conn(&conn, &default_settings)?;
            Ok(default_settings)
        }
    }

    pub fn save_song_settings(&self, settings: &SongSettings) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        self.save_song_settings_with_conn(&conn, settings)
    }

    fn save_song_settings_with_conn(
        &self,
        conn: &Connection,
        settings: &SongSettings,
    ) -> Result<(), String> {
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

    #[test]
    fn test_db_crud_and_settings() {
        let db = LibraryDb::new_in_memory().expect("Failed to create in-memory db");

        db.set_setting("root_folder", "/test/midi")
            .expect("Failed to set root_folder");
        let root = db
            .get_setting("root_folder")
            .expect("Failed to get setting");
        assert_eq!(root.as_deref(), Some("/test/midi"));

        let summary = SongSummary {
            content_hash: "hash123".to_string(),
            relative_path: "Chopin/nocturne.mid".to_string(),
            file_path: "/test/midi/Chopin/nocturne.mid".to_string(),
            title: "Nocturne Op 9 No 2".to_string(),
            folder: "Chopin".to_string(),
            duration_sec: 180.0,
            initial_bpm: 132.0,
            track_count: 2,
            is_favorite: false,
            last_played_at: None,
            added_at: 0,
            peak_start_sec: 15.0,
            preview_peak_json: "[]".to_string(),
            preview_start_json: "[]".to_string(),
        };

        db.upsert_song(&summary).expect("Failed to upsert song");
        let all = db.get_all_songs().expect("Failed to get all songs");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "Nocturne Op 9 No 2");
        assert_eq!(all[0].peak_start_sec, 15.0);

        // Update previews
        db.update_song_previews("hash123", 22.5, "[[60,0,500,1]]", "[[48,0,500,2]]")
            .expect("Failed to update song previews");
        let with_previews = db.get_song_by_hash("hash123").unwrap().unwrap();
        assert_eq!(with_previews.peak_start_sec, 22.5);
        assert_eq!(with_previews.preview_peak_json, "[[60,0,500,1]]");

        // Toggle favorite
        let is_fav = db.toggle_favorite("hash123").expect("Failed to toggle fav");
        assert!(is_fav);
        let updated = db.get_song_by_hash("hash123").unwrap().unwrap();
        assert!(updated.is_favorite);

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
        assert_eq!(loaded_settings.loop_start_sec, Some(10.0));
        assert_eq!(loaded_settings.loop_end_sec, Some(30.0));
    }
}
