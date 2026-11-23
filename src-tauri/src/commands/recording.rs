use std::path::{Path, PathBuf};
use std::sync::Arc;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::audio::dsp::SoundProfile;
use crate::audio::offline_render::{render_midi_to_audio, AudioExportFormat};
use crate::library::db::LibraryDb;
use crate::library::scanner::scan_folder;
use crate::midi::writer::{write_freeplay_midi, FreeplayRecordingPayload};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRecordingResult {
    pub file_path: String,
    pub folder: String,
    pub filename: String,
}

fn sanitize_filename(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_control() => ' ',
            _ => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "Freeplay Recording".to_string()
    } else {
        trimmed.to_string()
    }
}

fn next_available_midi_path(dir: &Path, base_name: &str) -> (PathBuf, String) {
    let first_name = format!("{}.mid", base_name);
    let first_path = dir.join(&first_name);
    if !first_path.exists() {
        return (first_path, first_name);
    }

    let mut idx = 2u32;
    loop {
        let candidate_name = format!("{} ({}).mid", base_name, idx);
        let candidate_path = dir.join(&candidate_name);
        if !candidate_path.exists() {
            return (candidate_path, candidate_name);
        }
        idx += 1;
    }
}

#[tauri::command]
pub fn save_freeplay_midi(
    app: AppHandle,
    db: State<'_, Arc<LibraryDb>>,
    title: String,
    payload: FreeplayRecordingPayload,
    custom_path: Option<String>,
) -> Result<SavedRecordingResult, String> {
    if let Some(custom) = custom_path {
        let dest = PathBuf::from(&custom);
        if let Some(parent) = dest.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create destination folder: {}", e))?;
            }
        }
        write_freeplay_midi(&dest, &payload)?;
        let filename = dest
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "recording.mid".to_string());
        return Ok(SavedRecordingResult {
            file_path: dest.to_string_lossy().to_string(),
            folder: String::new(),
            filename,
        });
    }

    let root_folder = db
        .get_setting("root_folder")?
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "NO_ROOT_FOLDER".to_string())?;

    let root_path = PathBuf::from(&root_folder);
    if !root_path.exists() || !root_path.is_dir() {
        return Err("NO_ROOT_FOLDER".to_string());
    }

    let recordings_dir = root_path.join("Recordings");
    std::fs::create_dir_all(&recordings_dir)
        .map_err(|e| format!("Failed to create Recordings folder: {}", e))?;

    let safe_base = sanitize_filename(&title);
    let (target_path, filename) = next_available_midi_path(&recordings_dir, &safe_base);

    write_freeplay_midi(&target_path, &payload)?;

    let _ = scan_folder(&root_path, &db);
    let _ = app.emit("library:updated", ());

    Ok(SavedRecordingResult {
        file_path: target_path.to_string_lossy().to_string(),
        folder: "Recordings".to_string(),
        filename,
    })
}

#[tauri::command]
pub fn export_midi_copy(source_path: String, dest_path: String) -> Result<(), String> {
    let src = Path::new(&source_path);
    if !src.exists() || !src.is_file() {
        return Err(format!("Source MIDI file not found: {:?}", source_path));
    }

    let dst = Path::new(&dest_path);
    if let Some(parent) = dst.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create destination folder: {}", e))?;
        }
    }

    std::fs::copy(src, dst)
        .map(|_| ())
        .map_err(|e| format!("Failed to copy MIDI file: {}", e))
}

fn resolve_soundfont_path(app: &AppHandle, db: &LibraryDb) -> Option<PathBuf> {
    if let Ok(Some(saved_sf)) = db.get_setting("active_soundfont_v1") {
        let p = PathBuf::from(saved_sf);
        if p.exists() {
            return Some(p);
        }
    }

    let mut candidates = Vec::new();
    if let Ok(res_dir) = app.path().resource_dir() {
        candidates.push(
            res_dir
                .join("resources")
                .join("soundfonts")
                .join("YDP-GrandPiano-20160804.sf2"),
        );
        candidates.push(res_dir.join("resources").join("piano.sf2"));
        candidates.push(res_dir.join("piano.sf2"));
    }
    candidates.push(PathBuf::from("resources/soundfonts/YDP-GrandPiano-20160804.sf2"));
    candidates.push(PathBuf::from(
        "src-tauri/resources/soundfonts/YDP-GrandPiano-20160804.sf2",
    ));
    candidates.push(PathBuf::from("resources/piano.sf2"));
    candidates.push(PathBuf::from("src-tauri/resources/piano.sf2"));

    candidates.into_iter().find(|p| p.exists())
}

fn resolve_sound_profile(db: &LibraryDb) -> SoundProfile {
    db.get_setting("sound_profile_v1")
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str::<SoundProfile>(&raw).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn export_song_audio(
    app: AppHandle,
    db: State<'_, Arc<LibraryDb>>,
    midi_path: String,
    output_path: String,
    format: String,
) -> Result<(), String> {
    let fmt = AudioExportFormat::parse(&format)?;
    let sf = resolve_soundfont_path(&app, &db);
    let profile = resolve_sound_profile(&db);

    tauri::async_runtime::spawn_blocking(move || {
        render_midi_to_audio(
            Path::new(&midi_path),
            Path::new(&output_path),
            fmt,
            sf.as_deref(),
            profile,
        )
    })
    .await
    .map_err(|e| format!("Audio export task failed: {}", e))?
}

#[tauri::command]
pub async fn export_freeplay_audio(
    app: AppHandle,
    db: State<'_, Arc<LibraryDb>>,
    payload: FreeplayRecordingPayload,
    output_path: String,
    format: String,
) -> Result<(), String> {
    let fmt = AudioExportFormat::parse(&format)?;
    let sf = resolve_soundfont_path(&app, &db);
    let profile = resolve_sound_profile(&db);

    tauri::async_runtime::spawn_blocking(move || {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let temp_mid = std::env::temp_dir().join(format!(
            "aurelia_freeplay_export_{}_{}.mid",
            std::process::id(),
            nanos
        ));

        write_freeplay_midi(&temp_mid, &payload)?;
        let res = render_midi_to_audio(
            &temp_mid,
            Path::new(&output_path),
            fmt,
            sf.as_deref(),
            profile,
        );
        let _ = std::fs::remove_file(&temp_mid);
        res
    })
    .await
    .map_err(|e| format!("Audio export task failed: {}", e))?
}
