use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use walkdir::WalkDir;

use crate::library::db::LibraryDb;
use crate::library::scanner::{
    canonicalize_root, file_size_and_mtime_ms, index_single_file, FolderWatcherManager,
};
use crate::midi::{HandRole, ParsedSong, SongSettings, SongSummary};

#[tauri::command]
pub fn get_root_folder(db: State<'_, Arc<LibraryDb>>) -> Result<Option<String>, String> {
    db.get_setting("root_folder")
}

#[tauri::command]
pub async fn set_root_folder(
    app: AppHandle,
    db: State<'_, Arc<LibraryDb>>,
    watcher: State<'_, Mutex<FolderWatcherManager>>,
    folder_path: String,
) -> Result<Vec<SongSummary>, String> {
    let path = PathBuf::from(&folder_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("Path {:?} is not a valid directory", folder_path));
    }

    let canon_path = canonicalize_root(&path);
    let canon_str = canon_path.to_string_lossy().to_string();
    db.set_setting("root_folder", &canon_str)?;

    // Update active folder watcher before scanning
    let coordinator = {
        let mut mgr = watcher.lock().map_err(|e| e.to_string())?;
        let _ = mgr.watch(canon_path.clone(), app.clone(), (*db).clone());
        mgr.coordinator()
    };

    let db_arc = (*db).clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        coordinator.run_blocking_scan(&canon_path, &db_arc, Some(&app_clone), false)?;
        db_arc.get_all_songs()
    })
    .await
    .map_err(|e| format!("Folder scan task failed: {}", e))?
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

fn canonical_root(db: &LibraryDb) -> Result<PathBuf, String> {
    let root_str = db
        .get_setting("root_folder")?
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "No library folder configured".to_string())?;
    std::fs::canonicalize(&root_str).map_err(|e| format!("Invalid library folder: {}", e))
}

fn is_midi_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("mid") || e.eq_ignore_ascii_case("midi"))
        .unwrap_or(false)
}

fn sanitize_single_segment(raw: &str) -> Result<String, String> {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_control() => ' ',
            _ => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("Name cannot be empty".to_string());
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
pub fn delete_library_song(
    app: AppHandle,
    db: State<'_, Arc<LibraryDb>>,
    file_path: String,
) -> Result<(), String> {
    let canon_root = canonical_root(&db)?;
    let canon_target = std::fs::canonicalize(&file_path)
        .map_err(|e| format!("Target file not found: {}", e))?;

    if !canon_target.starts_with(&canon_root) {
        return Err("Refused to delete file outside configured MIDI library folder".to_string());
    }
    if !canon_target.is_file() || !is_midi_path(&canon_target) {
        return Err("Refused to delete non-MIDI file".to_string());
    }

    std::fs::remove_file(&canon_target)
        .map_err(|e| format!("Failed to delete file: {}", e))?;

    let canon_target_str = canon_target.to_string_lossy().to_string();
    let deleted = db.delete_song_by_path(&canon_target_str)?;
    if deleted == 0 && canon_target_str != file_path {
        db.delete_song_by_path(&file_path)?;
    }

    let _ = app.emit("library:updated", ());
    Ok(())
}

#[tauri::command]
pub fn list_library_folders(db: State<'_, Arc<LibraryDb>>) -> Result<Vec<String>, String> {
    let canon_root = match canonical_root(&db) {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()),
    };

    let mut folders: Vec<String> = Vec::new();
    for entry in WalkDir::new(&canon_root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            e.depth() == 0 || !name.starts_with('.')
        })
        .filter_map(|e| e.ok())
    {
        if entry.depth() == 0 || !entry.file_type().is_dir() {
            continue;
        }
        if let Ok(rel) = entry.path().strip_prefix(&canon_root) {
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            if !rel_str.is_empty() {
                folders.push(rel_str);
            }
        }
    }
    folders.sort();
    Ok(folders)
}

#[tauri::command]
pub fn create_library_folder(
    app: AppHandle,
    db: State<'_, Arc<LibraryDb>>,
    parent_relative_path: String,
    folder_name: String,
) -> Result<String, String> {
    let canon_root = canonical_root(&db)?;
    let safe_name = sanitize_single_segment(&folder_name)?;

    let clean_parent = parent_relative_path
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();
    let parent_dir = if clean_parent.is_empty() {
        canon_root.clone()
    } else {
        canon_root.join(&clean_parent)
    };
    let canon_parent = std::fs::canonicalize(&parent_dir)
        .map_err(|e| format!("Parent folder not found: {}", e))?;
    if !canon_parent.starts_with(&canon_root) {
        return Err("Refused to create folder outside library".to_string());
    }

    let new_dir = canon_parent.join(&safe_name);
    if !new_dir.exists() {
        std::fs::create_dir_all(&new_dir)
            .map_err(|e| format!("Failed to create folder: {}", e))?;
    }

    let rel = new_dir
        .strip_prefix(&canon_root)
        .unwrap_or(&new_dir)
        .to_string_lossy()
        .replace('\\', "/");
    let _ = app.emit("library:updated", ());
    Ok(rel)
}

#[tauri::command]
pub fn move_library_song(
    app: AppHandle,
    db: State<'_, Arc<LibraryDb>>,
    file_path: String,
    target_folder_relative: String,
) -> Result<String, String> {
    let canon_root = canonical_root(&db)?;
    let canon_src = std::fs::canonicalize(&file_path)
        .map_err(|e| format!("Source file not found: {}", e))?;

    if !canon_src.starts_with(&canon_root) {
        return Err("Refused to move file outside configured MIDI library folder".to_string());
    }
    if !canon_src.is_file() || !is_midi_path(&canon_src) {
        return Err("Refused to move non-MIDI file".to_string());
    }

    let clean_target = target_folder_relative
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();
    let target_dir = if clean_target.is_empty() {
        canon_root.clone()
    } else {
        let mut candidate = canon_root.clone();
        for seg in clean_target.split('/').filter(|s| !s.is_empty()) {
            let safe_seg = sanitize_single_segment(seg)?;
            candidate.push(safe_seg);
        }
        if !candidate.exists() {
            std::fs::create_dir_all(&candidate)
                .map_err(|e| format!("Failed to create target folder: {}", e))?;
        }
        candidate
    };

    let canon_target_dir = std::fs::canonicalize(&target_dir)
        .map_err(|e| format!("Target folder invalid: {}", e))?;
    if !canon_target_dir.starts_with(&canon_root) {
        return Err("Refused to move file outside configured MIDI library folder".to_string());
    }

    let file_name = canon_src
        .file_name()
        .ok_or_else(|| "Invalid source filename".to_string())?;
    let dest_path = canon_target_dir.join(file_name);

    if dest_path == canon_src {
        return Ok(canon_src.to_string_lossy().to_string());
    }
    if dest_path.exists() {
        return Err("A file with that name already exists in the target folder".to_string());
    }

    std::fs::rename(&canon_src, &dest_path)
        .map_err(|e| format!("Failed to move file: {}", e))?;

    let canon_src_str = canon_src.to_string_lossy().to_string();
    let dest_str = dest_path.to_string_lossy().to_string();
    let new_rel = dest_path
        .strip_prefix(&canon_root)
        .unwrap_or(&dest_path)
        .to_string_lossy()
        .replace('\\', "/");
    let new_folder = dest_path
        .parent()
        .and_then(|p| p.strip_prefix(&canon_root).ok())
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    let (file_size, file_mtime_ms) = file_size_and_mtime_ms(&dest_path);

    let mut updated = db.update_song_location_by_path(
        &canon_src_str,
        &dest_str,
        &new_rel,
        &new_folder,
        None,
        file_size,
        file_mtime_ms,
    )?;
    if updated == 0 && canon_src_str != file_path {
        updated = db.update_song_location_by_path(
            &file_path,
            &dest_str,
            &new_rel,
            &new_folder,
            None,
            file_size,
            file_mtime_ms,
        )?;
    }
    if updated == 0 {
        index_single_file(&canon_root, &dest_path, &db)?;
    }

    let _ = app.emit("library:updated", ());
    Ok(dest_str)
}

#[tauri::command]
pub fn rename_library_song(
    app: AppHandle,
    db: State<'_, Arc<LibraryDb>>,
    file_path: String,
    new_title: String,
) -> Result<String, String> {
    let canon_root = canonical_root(&db)?;
    let canon_src = std::fs::canonicalize(&file_path)
        .map_err(|e| format!("Source file not found: {}", e))?;

    if !canon_src.starts_with(&canon_root) {
        return Err("Refused to rename file outside configured MIDI library folder".to_string());
    }
    if !canon_src.is_file() || !is_midi_path(&canon_src) {
        return Err("Refused to rename non-MIDI file".to_string());
    }

    let stripped = new_title
        .trim()
        .strip_suffix(".mid")
        .or_else(|| new_title.trim().strip_suffix(".midi"))
        .or_else(|| new_title.trim().strip_suffix(".MID"))
        .or_else(|| new_title.trim().strip_suffix(".MIDI"))
        .unwrap_or(new_title.trim());

    let safe_title = sanitize_single_segment(stripped)?;
    let ext = canon_src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mid");
    let parent = canon_src
        .parent()
        .ok_or_else(|| "Invalid source parent folder".to_string())?;
    let dest_path = parent.join(format!("{}.{}", safe_title, ext));

    if dest_path == canon_src {
        return Ok(canon_src.to_string_lossy().to_string());
    }
    if dest_path.exists() {
        return Err("A file with that name already exists".to_string());
    }

    std::fs::rename(&canon_src, &dest_path)
        .map_err(|e| format!("Failed to rename file: {}", e))?;

    let canon_src_str = canon_src.to_string_lossy().to_string();
    let dest_str = dest_path.to_string_lossy().to_string();
    let new_rel = dest_path
        .strip_prefix(&canon_root)
        .unwrap_or(&dest_path)
        .to_string_lossy()
        .replace('\\', "/");
    let new_folder = dest_path
        .parent()
        .and_then(|p| p.strip_prefix(&canon_root).ok())
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    let (file_size, file_mtime_ms) = file_size_and_mtime_ms(&dest_path);

    let mut updated = db.update_song_location_by_path(
        &canon_src_str,
        &dest_str,
        &new_rel,
        &new_folder,
        Some(&safe_title),
        file_size,
        file_mtime_ms,
    )?;
    if updated == 0 && canon_src_str != file_path {
        updated = db.update_song_location_by_path(
            &file_path,
            &dest_str,
            &new_rel,
            &new_folder,
            Some(&safe_title),
            file_size,
            file_mtime_ms,
        )?;
    }
    if updated == 0 {
        index_single_file(&canon_root, &dest_path, &db)?;
    }

    let _ = app.emit("library:updated", ());
    Ok(dest_str)
}

#[tauri::command]
pub async fn rename_library_folder(
    app: AppHandle,
    db: State<'_, Arc<LibraryDb>>,
    watcher: State<'_, Mutex<FolderWatcherManager>>,
    relative_path: String,
    new_name: String,
) -> Result<String, String> {
    let canon_root = canonical_root(&db)?;
    let clean_rel = relative_path
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();
    if clean_rel.is_empty() {
        return Err("Cannot rename the root library folder".to_string());
    }

    let canon_src = std::fs::canonicalize(canon_root.join(&clean_rel))
        .map_err(|e| format!("Folder not found: {}", e))?;
    if !canon_src.starts_with(&canon_root) || canon_src == canon_root {
        return Err("Refused to rename folder outside configured MIDI library".to_string());
    }
    if !canon_src.is_dir() {
        return Err("Target is not a directory".to_string());
    }

    let safe_name = sanitize_single_segment(&new_name)?;
    let parent = canon_src
        .parent()
        .ok_or_else(|| "Invalid folder parent".to_string())?;
    let dest_dir = parent.join(&safe_name);

    if dest_dir == canon_src {
        return Ok(clean_rel);
    }
    if dest_dir.exists() {
        return Err("A folder with that name already exists".to_string());
    }

    let new_rel = dest_dir
        .strip_prefix(&canon_root)
        .unwrap_or(&dest_dir)
        .to_string_lossy()
        .replace('\\', "/");

    let coordinator = watcher
        .lock()
        .map_err(|e| e.to_string())?
        .coordinator();
    let db_arc = (*db).clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        std::fs::rename(&canon_src, &dest_dir)
            .map_err(|e| format!("Failed to rename folder: {}", e))?;
        coordinator.run_blocking_scan(&canon_root, &db_arc, Some(&app_clone), true)?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Folder rescan task failed: {}", e))??;

    Ok(new_rel)
}

#[tauri::command]
pub async fn delete_library_folder(
    app: AppHandle,
    db: State<'_, Arc<LibraryDb>>,
    watcher: State<'_, Mutex<FolderWatcherManager>>,
    relative_path: String,
) -> Result<(), String> {
    let canon_root = canonical_root(&db)?;
    let clean_rel = relative_path
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();
    if clean_rel.is_empty() {
        return Err("Cannot delete the root library folder".to_string());
    }

    let canon_target = std::fs::canonicalize(canon_root.join(&clean_rel))
        .map_err(|e| format!("Folder not found: {}", e))?;
    if !canon_target.starts_with(&canon_root) || canon_target == canon_root {
        return Err("Refused to delete folder outside configured MIDI library".to_string());
    }
    if !canon_target.is_dir() {
        return Err("Target is not a directory".to_string());
    }

    let coordinator = watcher
        .lock()
        .map_err(|e| e.to_string())?
        .coordinator();
    let db_arc = (*db).clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        std::fs::remove_dir_all(&canon_target)
            .map_err(|e| format!("Failed to delete folder: {}", e))?;
        coordinator.run_blocking_scan(&canon_root, &db_arc, Some(&app_clone), true)?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Folder rescan task failed: {}", e))?
}

fn next_available_import_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let candidate = dir.join(format!("{}.{}", stem, ext));
    if !candidate.exists() {
        return candidate;
    }
    let mut counter = 1u32;
    loop {
        let numbered = dir.join(format!("{} ({}).{}", stem, counter, ext));
        if !numbered.exists() {
            return numbered;
        }
        counter += 1;
    }
}

#[tauri::command]
pub fn import_midi_files(
    app: AppHandle,
    db: State<'_, Arc<LibraryDb>>,
    source_paths: Vec<String>,
    target_folder_relative: String,
) -> Result<Vec<String>, String> {
    if source_paths.is_empty() {
        return Ok(Vec::new());
    }

    let canon_root = canonical_root(&db)?;
    let clean_target = target_folder_relative
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();

    let target_dir = if clean_target.is_empty() {
        canon_root.clone()
    } else {
        let mut candidate = canon_root.clone();
        for seg in clean_target.split('/').filter(|s| !s.is_empty()) {
            let safe_seg = sanitize_single_segment(seg)?;
            candidate.push(safe_seg);
        }
        if !candidate.exists() {
            std::fs::create_dir_all(&candidate)
                .map_err(|e| format!("Failed to create target folder: {}", e))?;
        }
        candidate
    };

    let canon_target_dir = std::fs::canonicalize(&target_dir)
        .map_err(|e| format!("Target folder invalid: {}", e))?;
    if !canon_target_dir.starts_with(&canon_root) {
        return Err("Refused to import files outside configured MIDI library folder".to_string());
    }

    let mut imported_paths = Vec::new();
    for raw_src in source_paths {
        let canon_src = match std::fs::canonicalize(&raw_src) {
            Ok(p) => p,
            Err(_) => continue,
        };
        if !canon_src.is_file() || !is_midi_path(&canon_src) {
            continue;
        }

        let raw_stem = canon_src
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Imported");
        let safe_stem = sanitize_single_segment(raw_stem).unwrap_or_else(|_| "Imported".to_string());
        let ext = canon_src
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .filter(|e| e == "mid" || e == "midi")
            .unwrap_or_else(|| "mid".to_string());

        let dest_path = next_available_import_path(&canon_target_dir, &safe_stem, &ext);
        std::fs::copy(&canon_src, &dest_path)
            .map_err(|e| format!("Failed to copy MIDI file: {}", e))?;

        let _ = index_single_file(&canon_root, &dest_path, &db);
        imported_paths.push(dest_path.to_string_lossy().to_string());
    }

    if !imported_paths.is_empty() {
        let _ = app.emit("library:updated", ());
    }
    Ok(imported_paths)
}

#[tauri::command]
pub async fn reveal_in_file_manager(
    db: State<'_, Arc<LibraryDb>>,
    path: String,
    is_relative_folder: bool,
) -> Result<(), String> {
    let canon_root = canonical_root(&db)?;
    let raw_target = if is_relative_folder {
        let clean_rel = path.replace('\\', "/").trim_matches('/').to_string();
        if clean_rel.is_empty() {
            canon_root.clone()
        } else {
            canon_root.join(&clean_rel)
        }
    } else {
        PathBuf::from(&path)
    };

    let canon_target = std::fs::canonicalize(&raw_target)
        .map_err(|e| format!("Path not found: {}", e))?;
    if !canon_target.starts_with(&canon_root) {
        return Err("Refused to reveal path outside configured MIDI library".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&canon_target)
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        let display_path = canon_target.to_string_lossy();
        let clean_path = display_path.strip_prefix(r"\\?\").unwrap_or(&display_path);
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", clean_path))
            .spawn()
            .map_err(|e| format!("Failed to open Explorer: {}", e))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let dir = if canon_target.is_dir() {
            canon_target.as_path()
        } else {
            canon_target.parent().unwrap_or(canon_target.as_path())
        };
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }

    Ok(())
}
