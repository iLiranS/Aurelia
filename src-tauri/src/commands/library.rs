use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

use crate::library::db::LibraryDb;
use crate::library::scanner::{scan_folder, FolderWatcherManager};
use crate::midi::{HandRole, ParsedSong, SongSettings, SongSummary};

#[tauri::command]
pub fn get_root_folder(db: State<'_, Arc<LibraryDb>>) -> Result<Option<String>, String> {
    db.get_setting("root_folder")
}

#[tauri::command]
pub fn set_root_folder(
    app: AppHandle,
    db: State<'_, Arc<LibraryDb>>,
    watcher: State<'_, Mutex<FolderWatcherManager>>,
    folder_path: String,
) -> Result<Vec<SongSummary>, String> {
    let path = PathBuf::from(&folder_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("Path {:?} is not a valid directory", folder_path));
    }

    db.set_setting("root_folder", &folder_path)?;
    let songs = scan_folder(&path, &db)?;

    // Update active folder watcher
    if let Ok(mut mgr) = watcher.lock() {
        let _ = mgr.watch(path, app, (*db).clone());
    }

    Ok(songs)
}

#[tauri::command]
pub fn get_library_songs(db: State<'_, Arc<LibraryDb>>) -> Result<Vec<SongSummary>, String> {
    db.get_all_songs()
}

#[tauri::command]
pub fn load_song(
    db: State<'_, Arc<LibraryDb>>,
    file_path: String,
) -> Result<(ParsedSong, SongSettings), String> {
    let path = Path::new(&file_path);
    let parsed = crate::midi::parser::parse_midi_file(path)?;
    let settings = db.get_song_settings(&parsed.content_hash)?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let _ = db.touch_last_played(&parsed.content_hash, now_ms);
    Ok((parsed, settings))
}

#[tauri::command]
pub fn save_song_settings(
    db: State<'_, Arc<LibraryDb>>,
    settings: SongSettings,
) -> Result<(), String> {
    db.save_song_settings(&settings)
}

#[tauri::command]
pub fn toggle_favorite(
    db: State<'_, Arc<LibraryDb>>,
    content_hash: String,
) -> Result<bool, String> {
    db.toggle_favorite(&content_hash)
}

#[tauri::command]
pub fn get_app_setting(
    db: State<'_, Arc<LibraryDb>>,
    key: String,
) -> Result<Option<String>, String> {
    db.get_setting(&key)
}

#[tauri::command]
pub fn set_app_setting(
    db: State<'_, Arc<LibraryDb>>,
    key: String,
    value: String,
) -> Result<(), String> {
    db.set_setting(&key, &value)
}

#[tauri::command]
pub fn get_song_preview_notes(file_path: String) -> Result<Vec<[i32; 4]>, String> {
    let parsed = crate::midi::parser::parse_midi_file(Path::new(&file_path))?;
    let mut out = Vec::with_capacity(parsed.notes.len());
    for n in &parsed.notes {
        let hand = match n.default_hand {
            HandRole::Left => 2,
            _ => 1,
        };
        out.push([
            n.midi as i32,
            (n.start_sec * 1000.0).round() as i32,
            (n.duration_sec * 1000.0).max(50.0).round() as i32,
            hand,
        ]);
    }
    Ok(out)
}
