use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::Arc;
use std::time::{Duration, Instant};
use notify::event::ModifyKind;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use crate::library::db::LibraryDb;
use crate::midi::{compute_song_previews, parse_midi_bytes, SongSummary};

pub fn scan_folder(root: &Path, db: &LibraryDb) -> Result<Vec<SongSummary>, String> {
    if !root.exists() || !root.is_dir() {
        return Err(format!("Directory {:?} does not exist or is not a directory", root));
    }

    let mut current_file_paths: Vec<String> = Vec::new();

    for entry in WalkDir::new(root).follow_links(true).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let is_midi = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| {
                let lower = ext.to_lowercase();
                lower == "mid" || lower == "midi"
            })
            .unwrap_or(false);

        if !is_midi {
            continue;
        }

        let file_path = path.to_string_lossy().to_string();
        current_file_paths.push(file_path.clone());

        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();

        let folder = path
            .parent()
            .and_then(|p| p.strip_prefix(root).ok())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let title_fallback = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Untitled".to_string());

        // Read bytes (limit to 64MB for safety)
        if let Ok(metadata) = entry.metadata() {
            if metadata.len() > 64 * 1024 * 1024 {
                continue;
            }
        }

        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(_) => continue,
        };

        let content_hash = blake3::hash(&bytes).to_hex().to_string();
        let file_added_ms = file_timestamp_ms(path);

        if let Ok(Some(existing)) = db.get_song_by_hash(&content_hash) {
            if existing.added_at == 0 && file_added_ms > 0 {
                let _ = db.update_song_added_at(&content_hash, file_added_ms);
            }
            // Already indexed: check if path or title needs updating (e.g. moved, renamed, or updating from instrument name to file name)
            if existing.file_path != file_path
                || existing.relative_path != relative_path
                || existing.folder != folder
                || existing.title != title_fallback
            {
                let _ = db.update_song_metadata(
                    &content_hash,
                    &file_path,
                    &relative_path,
                    &folder,
                    &title_fallback,
                );
            }

            // Auto-heal out-of-range or bogus BPMs from previous versions
            if existing.initial_bpm > 300.0 || existing.initial_bpm < 20.0 {
                if let Ok(parsed) = parse_midi_bytes(&bytes, &file_path, &title_fallback) {
                    let _ = db.update_song_bpm(&content_hash, parsed.initial_bpm);
                }
            }

            // Backfill preview if missing on existing song
            if (existing.preview_peak_json == "[]" || existing.preview_peak_json.is_empty())
                && existing.duration_sec > 0.0
            {
                if let Ok(parsed) = parse_midi_bytes(&bytes, &file_path, &title_fallback) {
                    let previews = compute_song_previews(&parsed);
                    let _ = db.update_song_previews(
                        &content_hash,
                        previews.peak_start_sec,
                        &previews.preview_peak_json,
                        &previews.preview_start_json,
                    );
                }
            }
        } else {
            // New file: parse and insert
            if let Ok(parsed) = parse_midi_bytes(&bytes, &file_path, &title_fallback) {
                let previews = compute_song_previews(&parsed);
                let summary = SongSummary {
                    content_hash: content_hash.clone(),
                    relative_path,
                    file_path,
                    title: parsed.title,
                    folder,
                    duration_sec: parsed.duration_sec,
                    initial_bpm: parsed.initial_bpm,
                    track_count: parsed.tracks.len() as u32,
                    is_favorite: false,
                    last_played_at: None,
                    added_at: file_added_ms,
                    peak_start_sec: previews.peak_start_sec,
                    preview_peak_json: previews.preview_peak_json,
                    preview_start_json: previews.preview_start_json,
                };
                let _ = db.upsert_song(&summary);
                let _ = db.get_song_settings(&content_hash); // creates default song_settings
            }
        }
    }

    // Clean up files no longer present in folder
    let _ = db.remove_stale_songs(&current_file_paths);

    db.get_all_songs()
}

fn file_timestamp_ms(path: &Path) -> i64 {
    if let Ok(meta) = std::fs::metadata(path) {
        let sys_time = meta.created().or_else(|_| meta.modified()).ok();
        if let Some(t) = sys_time {
            if let Ok(dur) = t.duration_since(std::time::UNIX_EPOCH) {
                return dur.as_millis() as i64;
            }
        }
    }
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn is_hidden_or_dotfile(path: &Path) -> bool {
    path.components().any(|c| {
        c.as_os_str().to_string_lossy().starts_with('.')
    })
}

pub struct FolderWatcherManager {
    watcher: Option<RecommendedWatcher>,
}

impl FolderWatcherManager {
    pub fn new() -> Self {
        Self { watcher: None }
    }

    pub fn watch(
        &mut self,
        root: PathBuf,
        app_handle: AppHandle,
        db: Arc<LibraryDb>,
    ) -> Result<(), String> {
        // Drop existing watcher if active
        self.watcher = None;

        let (tx, rx) = channel();

        let mut watcher = RecommendedWatcher::new(
            move |res| {
                if let Ok(event) = res {
                    let _ = tx.send(event);
                }
            },
            Config::default().with_poll_interval(Duration::from_millis(500)),
        )
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch {:?}: {}", root, e))?;

        self.watcher = Some(watcher);

        // Spawn debouncing background worker
        let root_clone = root.clone();
        std::thread::spawn(move || {
            let mut last_trigger: Option<Instant> = None;
            let debounce_delay = Duration::from_millis(300);

            while let Ok(event) = rx.recv() {
                // Drain any additional events in the channel
                let mut events: Vec<Event> = vec![event];
                while let Ok(more) = rx.try_recv() {
                    events.push(more);
                }

                let mut is_relevant = false;
                for ev in events {
                    for path in ev.paths {
                        if is_hidden_or_dotfile(&path) {
                            continue;
                        }

                        if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                            let lower = ext.to_lowercase();
                            if lower == "mid" || lower == "midi" {
                                is_relevant = true;
                                break;
                            }
                        }

                        if path.is_dir() {
                            is_relevant = true;
                            break;
                        }

                        if path.extension().is_none() {
                            match ev.kind {
                                EventKind::Create(_)
                                | EventKind::Remove(_)
                                | EventKind::Modify(ModifyKind::Name(_)) => {
                                    is_relevant = true;
                                    break;
                                }
                                _ => {}
                            }
                        }
                    }
                    if is_relevant {
                        break;
                    }
                }

                if is_relevant {
                    let now = Instant::now();
                    if let Some(prev) = last_trigger {
                        if now.duration_since(prev) < debounce_delay {
                            std::thread::sleep(debounce_delay);
                        }
                    }
                    last_trigger = Some(Instant::now());

                    // Re-scan folder and emit library:updated
                    let _ = scan_folder(&root_clone, &db);
                    let _ = app_handle.emit("library:updated", ());
                }
            }
        });

        Ok(())
    }
}
