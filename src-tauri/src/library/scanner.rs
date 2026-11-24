use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use notify::event::ModifyKind;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use crate::library::db::{CachedSongStat, LibraryDb, ScannedSongRecord, SongLocationUpdate};
use crate::midi::{compute_song_previews, parse_midi_bytes, SongSummary};

const MAX_MIDI_FILE_BYTES: u64 = 64 * 1024 * 1024;
const SCAN_BATCH_SIZE: usize = 25;

#[derive(Debug, Default, Clone)]
pub struct ScanOutcome {
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
    pub folders: Vec<String>,
    pub emitted: bool,
}

impl ScanOutcome {
    pub fn changed(&self) -> bool {
        self.added > 0 || self.updated > 0 || self.removed > 0
    }
}

pub fn canonicalize_root(root: &Path) -> PathBuf {
    std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf())
}

pub fn is_midi_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("mid") || ext.eq_ignore_ascii_case("midi"))
        .unwrap_or(false)
}

pub fn file_size_and_mtime_ms(path: &Path) -> (i64, i64) {
    if let Ok(meta) = std::fs::metadata(path) {
        let size = meta.len() as i64;
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        return (size, mtime);
    }
    (0, 0)
}

fn file_added_ms(meta: &std::fs::Metadata) -> i64 {
    let sys_time = meta.created().or_else(|_| meta.modified()).ok();
    if let Some(t) = sys_time {
        if let Ok(dur) = t.duration_since(UNIX_EPOCH) {
            return dur.as_millis() as i64;
        }
    }
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn file_mtime_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn is_hidden_or_dotfile(path: &Path, canon_root: &Path) -> bool {
    let rel = path.strip_prefix(canon_root).unwrap_or(path);
    rel.components()
        .any(|c| c.as_os_str().to_string_lossy().starts_with('.'))
}

/// Stat-first, batched folder scanner with optional cancellation check.
/// - Skips reading/hashing/parsing files whose `(file_path, file_size, file_mtime_ms)` match the DB.
/// - Preserves favorites, `last_played_at`, and `song_settings` across moves/renames via BLAKE3 `content_hash`.
/// - Commits in batches of 25 songs and emits `library:updated` progressively during large imports
///   (unless switching from a different root folder, where intermediate mixed emissions are suppressed).
/// - Removes stale rows (including replaced hashes at edited paths) in a single transaction at the end.
pub fn scan_folder_with_abort<F>(
    root: &Path,
    db: &LibraryDb,
    app_handle: Option<&AppHandle>,
    should_abort: F,
) -> Result<ScanOutcome, String>
where
    F: Fn() -> bool,
{
    if !root.exists() || !root.is_dir() {
        return Err(format!(
            "Directory {:?} does not exist or is not a directory",
            root
        ));
    }

    let canon_root = canonicalize_root(root);
    let (file_index, mut known_hashes) = db.get_song_file_index()?;

    let mut hash_to_cached: HashMap<String, CachedSongStat> = HashMap::with_capacity(file_index.len());
    let mut has_foreign_root_songs = false;
    for (path_str, stat) in &file_index {
        if !Path::new(path_str).starts_with(&canon_root) {
            has_foreign_root_songs = true;
        }
        hash_to_cached
            .entry(stat.content_hash.clone())
            .or_insert_with(|| stat.clone());
    }

    let mut current_file_paths: HashSet<String> = HashSet::new();
    let mut current_hashes: HashSet<String> = HashSet::new();
    let mut current_folders: Vec<String> = Vec::new();
    let mut pending_inserts: Vec<ScannedSongRecord> = Vec::with_capacity(SCAN_BATCH_SIZE);
    let mut pending_updates: Vec<SongLocationUpdate> = Vec::with_capacity(SCAN_BATCH_SIZE);
    let mut outcome = ScanOutcome::default();
    let mut emitted_intermediate = false;

    for entry in WalkDir::new(&canon_root)
        .follow_links(true)
        .into_iter()
        .filter_entry(|e| {
            e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.')
        })
        .filter_map(|e| e.ok())
    {
        if should_abort() {
            return Ok(outcome);
        }

        let path = entry.path();
        if entry.depth() > 0 && entry.file_type().is_dir() {
            if let Ok(rel) = path.strip_prefix(&canon_root) {
                let rel_str = rel.to_string_lossy().replace('\\', "/");
                if !rel_str.is_empty() {
                    current_folders.push(rel_str);
                }
            }
            continue;
        }

        if !path.is_file() || !is_midi_extension(path) {
            continue;
        }

        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.len() > MAX_MIDI_FILE_BYTES {
            continue;
        }

        let file_path = path.to_string_lossy().to_string();
        let relative_path = path
            .strip_prefix(&canon_root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");

        let folder = path
            .parent()
            .and_then(|p| p.strip_prefix(&canon_root).ok())
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();

        let title_fallback = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Untitled".to_string());

        let file_size = meta.len() as i64;
        let mtime_ms = file_mtime_ms(&meta);

        // Stat-first fast path: skip disk read, BLAKE3, and MIDI parsing for unchanged files
        if let Some(cached) = file_index.get(&file_path) {
            if cached.file_size == file_size
                && cached.file_mtime_ms == mtime_ms
                && cached.relative_path == relative_path
                && cached.folder == folder
                && cached.title == title_fallback
            {
                current_file_paths.insert(file_path);
                current_hashes.insert(cached.content_hash.clone());
                continue;
            }
        }

        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(_) => continue,
        };

        let content_hash = blake3::hash(&bytes).to_hex().to_string();

        // Duplicate stability guard: if another file with identical bytes was already claimed
        // in this scan pass, skip this duplicate so it never ping-pongs file_path across scans.
        if current_hashes.contains(&content_hash) {
            continue;
        }

        if known_hashes.contains(&content_hash) {
            if let Some(existing) = hash_to_cached.get(&content_hash) {
                if existing.file_path != file_path && Path::new(&existing.file_path).starts_with(&canon_root) {
                    if let Ok(existing_meta) = std::fs::metadata(&existing.file_path) {
                        if existing_meta.len() as i64 == existing.file_size
                            && file_mtime_ms(&existing_meta) == existing.file_mtime_ms
                        {
                            continue;
                        }
                    }
                }
            }

            // File was moved, renamed, or touched without content changes -> lightweight metadata update
            current_file_paths.insert(file_path.clone());
            current_hashes.insert(content_hash.clone());
            pending_updates.push(SongLocationUpdate {
                content_hash,
                file_path,
                relative_path,
                folder,
                title: title_fallback,
                file_size,
                file_mtime_ms: mtime_ms,
            });
            outcome.updated += 1;
        } else if let Ok(parsed) = parse_midi_bytes(&bytes, &file_path, &title_fallback) {
            let previews = compute_song_previews(&parsed);
            let summary = SongSummary {
                content_hash: content_hash.clone(),
                relative_path,
                file_path: file_path.clone(),
                title: parsed.title,
                folder,
                duration_sec: parsed.duration_sec,
                initial_bpm: parsed.initial_bpm,
                track_count: parsed.tracks.len() as u32,
                is_favorite: false,
                last_played_at: None,
                added_at: file_added_ms(&meta),
                peak_start_sec: previews.peak_start_sec,
                preview_peak_json: previews.preview_peak_json,
                preview_start_json: previews.preview_start_json,
            };
            known_hashes.insert(content_hash.clone());
            current_hashes.insert(content_hash);
            current_file_paths.insert(file_path);
            pending_inserts.push(ScannedSongRecord {
                summary,
                file_size,
                file_mtime_ms: mtime_ms,
            });
            outcome.added += 1;
        }

        if pending_inserts.len() + pending_updates.len() >= SCAN_BATCH_SIZE {
            if should_abort() {
                return Ok(outcome);
            }
            db.apply_scan_batch(&pending_inserts, &pending_updates)?;
            pending_inserts.clear();
            pending_updates.clear();
            if !has_foreign_root_songs {
                if let Some(app) = app_handle {
                    let _ = app.emit("library:updated", ());
                    emitted_intermediate = true;
                }
            }
        }
    }

    if should_abort() {
        return Ok(outcome);
    }

    if !pending_inserts.is_empty() || !pending_updates.is_empty() {
        db.apply_scan_batch(&pending_inserts, &pending_updates)?;
    }

    outcome.removed = db.remove_stale_songs(&current_file_paths, &current_hashes)?;
    current_folders.sort();
    outcome.folders = current_folders;

    if let Some(app) = app_handle {
        if outcome.changed() || emitted_intermediate {
            let _ = app.emit("library:updated", ());
            outcome.emitted = true;
        }
    }

    Ok(outcome)
}

pub fn scan_folder_with_progress(
    root: &Path,
    db: &LibraryDb,
    app_handle: Option<&AppHandle>,
) -> Result<ScanOutcome, String> {
    scan_folder_with_abort(root, db, app_handle, || false)
}

/// Convenience wrapper for synchronous callers that want the full updated song list.
pub fn scan_folder(root: &Path, db: &LibraryDb) -> Result<Vec<SongSummary>, String> {
    scan_folder_with_progress(root, db, None)?;
    db.get_all_songs()
}

/// Indexes a single newly created MIDI file (e.g. after saving a recording) without scanning the entire library.
pub fn index_single_file(root: &Path, file_path: &Path, db: &LibraryDb) -> Result<(), String> {
    let canon_root = canonicalize_root(root);
    let canon_file = std::fs::canonicalize(file_path).unwrap_or_else(|_| file_path.to_path_buf());

    if !canon_file.is_file() || !is_midi_extension(&canon_file) {
        return Ok(());
    }

    let meta = std::fs::metadata(&canon_file)
        .map_err(|e| format!("Failed to stat MIDI file: {}", e))?;
    if meta.len() > MAX_MIDI_FILE_BYTES {
        return Ok(());
    }

    let bytes = std::fs::read(&canon_file)
        .map_err(|e| format!("Failed to read MIDI file: {}", e))?;

    let file_path_str = canon_file.to_string_lossy().to_string();
    let relative_path = canon_file
        .strip_prefix(&canon_root)
        .unwrap_or(&canon_file)
        .to_string_lossy()
        .replace('\\', "/");
    let folder = canon_file
        .parent()
        .and_then(|p| p.strip_prefix(&canon_root).ok())
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    let title_fallback = canon_file
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Untitled".to_string());

    let parsed = parse_midi_bytes(&bytes, &file_path_str, &title_fallback)?;
    let previews = compute_song_previews(&parsed);
    let summary = SongSummary {
        content_hash: parsed.content_hash,
        relative_path,
        file_path: file_path_str,
        title: parsed.title,
        folder,
        duration_sec: parsed.duration_sec,
        initial_bpm: parsed.initial_bpm,
        track_count: parsed.tracks.len() as u32,
        is_favorite: false,
        last_played_at: None,
        added_at: file_added_ms(&meta),
        peak_start_sec: previews.peak_start_sec,
        preview_peak_json: previews.preview_peak_json,
        preview_start_json: previews.preview_start_json,
    };

    db.upsert_song(&summary, meta.len() as i64, file_mtime_ms(&meta))
}

#[derive(Default)]
struct ScanCoordinatorState {
    in_progress: bool,
    dirty: bool,
    latest_root: Option<PathBuf>,
    last_folders: Option<(PathBuf, Vec<String>)>,
}

/// Coalesces and serializes library scans so rapid Finder changes or command rescans never race.
#[derive(Clone)]
pub struct ScanCoordinator {
    state: Arc<Mutex<ScanCoordinatorState>>,
    generation: Arc<AtomicU64>,
    scan_lock: Arc<Mutex<()>>,
}

impl Default for ScanCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

impl ScanCoordinator {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(ScanCoordinatorState::default())),
            generation: Arc::new(AtomicU64::new(0)),
            scan_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn set_active_root(&self, root: PathBuf) -> u64 {
        let new_gen = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        if let Ok(mut guard) = self.state.lock() {
            let root_changed = guard
                .latest_root
                .as_ref()
                .map(|prev| prev != &root)
                .unwrap_or(true);
            guard.latest_root = Some(root);
            guard.dirty = false;
            if root_changed {
                guard.last_folders = None;
            }
        }
        new_gen
    }

    fn update_folders_and_maybe_emit(
        &self,
        root: &Path,
        outcome: &ScanOutcome,
        app_handle: Option<&AppHandle>,
        force_emit_if_not_emitted: bool,
    ) {
        let folders_changed = if let Ok(mut guard) = self.state.lock() {
            let changed = matches!(
                &guard.last_folders,
                Some((prev_root, prev)) if prev_root == root && prev != &outcome.folders
            );
            guard.last_folders = Some((root.to_path_buf(), outcome.folders.clone()));
            changed
        } else {
            false
        };

        if !outcome.emitted && (folders_changed || force_emit_if_not_emitted) {
            if let Some(app) = app_handle {
                let _ = app.emit("library:updated", ());
            }
        }
    }

    pub fn run_blocking_scan(
        &self,
        root: &Path,
        db: &LibraryDb,
        app_handle: Option<&AppHandle>,
        force_emit_if_unchanged: bool,
    ) -> Result<ScanOutcome, String> {
        let target_gen = self.generation.load(Ordering::Acquire);
        let _scan_guard = self.scan_lock.lock().map_err(|e| e.to_string())?;
        let outcome = scan_folder_with_abort(root, db, app_handle, || {
            self.generation.load(Ordering::Acquire) != target_gen
        })?;
        if self.generation.load(Ordering::Acquire) == target_gen {
            self.update_folders_and_maybe_emit(root, &outcome, app_handle, force_emit_if_unchanged);
        }
        Ok(outcome)
    }

    pub fn trigger_background_scan(
        &self,
        root: PathBuf,
        expected_gen: Option<u64>,
        app_handle: AppHandle,
        db: Arc<LibraryDb>,
    ) {
        {
            let Ok(mut guard) = self.state.lock() else {
                return;
            };
            if let Some(g) = expected_gen {
                if self.generation.load(Ordering::Acquire) != g {
                    return;
                }
            }
            guard.latest_root = Some(root);
            if guard.in_progress {
                guard.dirty = true;
                return;
            }
            guard.in_progress = true;
            guard.dirty = false;
        }

        let coordinator = self.clone();
        std::thread::spawn(move || loop {
            let (target_root, target_gen) = match coordinator.state.lock() {
                Ok(guard) => (
                    guard.latest_root.clone(),
                    coordinator.generation.load(Ordering::Acquire),
                ),
                Err(_) => break,
            };

            if let Some(root_path) = target_root {
                if root_path.exists() && root_path.is_dir() {
                    if let Ok(_scan_guard) = coordinator.scan_lock.lock() {
                        if let Ok(outcome) = scan_folder_with_abort(
                            &root_path,
                            &db,
                            Some(&app_handle),
                            || coordinator.generation.load(Ordering::Acquire) != target_gen,
                        ) {
                            if coordinator.generation.load(Ordering::Acquire) == target_gen {
                                coordinator.update_folders_and_maybe_emit(
                                    &root_path,
                                    &outcome,
                                    Some(&app_handle),
                                    false,
                                );
                            }
                        }
                    }
                }
            }

            match coordinator.state.lock() {
                Ok(mut guard) => {
                    if guard.dirty {
                        guard.dirty = false;
                        continue;
                    }
                    guard.in_progress = false;
                    break;
                }
                Err(_) => break,
            }
        });
    }
}

fn is_relevant_fs_event(ev: &Event, canon_root: &Path) -> bool {
    if matches!(ev.kind, EventKind::Access(_)) {
        return false;
    }

    let is_remove_or_rename = matches!(
        ev.kind,
        EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
    );

    for path in &ev.paths {
        if is_hidden_or_dotfile(path, canon_root) {
            continue;
        }

        // For removals/renames, `path.is_dir()` is false once deleted and folders can contain dots (e.g. "Op. 9").
        // With the stat-first fast path, triggering a scan on any non-hidden removal/rename is cheap and catches everything.
        if is_remove_or_rename {
            return true;
        }

        if is_midi_extension(path) || path.is_dir() {
            return true;
        }
    }

    false
}

pub struct FolderWatcherManager {
    watcher: Option<RecommendedWatcher>,
    coordinator: ScanCoordinator,
}

impl Default for FolderWatcherManager {
    fn default() -> Self {
        Self::new()
    }
}

impl FolderWatcherManager {
    pub fn new() -> Self {
        Self {
            watcher: None,
            coordinator: ScanCoordinator::new(),
        }
    }

    pub fn coordinator(&self) -> ScanCoordinator {
        self.coordinator.clone()
    }

    pub fn watch(
        &mut self,
        root: PathBuf,
        app_handle: AppHandle,
        db: Arc<LibraryDb>,
    ) -> Result<(), String> {
        let canon_root = canonicalize_root(&root);
        let watch_gen = self.coordinator.set_active_root(canon_root.clone());

        // Drop existing watcher if active (closes channel and cleanly exits old worker thread)
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
            .watch(&canon_root, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch {:?}: {}", canon_root, e))?;

        self.watcher = Some(watcher);

        let coordinator = self.coordinator.clone();
        std::thread::spawn(move || {
            let debounce_delay = Duration::from_millis(250);

            'watch_loop: while let Ok(first_event) = rx.recv() {
                let mut is_relevant = is_relevant_fs_event(&first_event, &canon_root);

                // Trailing-edge debounce: coalesce bursts (e.g. pasting/deleting 100 files in Finder)
                loop {
                    match rx.recv_timeout(debounce_delay) {
                        Ok(next_event) => {
                            if !is_relevant && is_relevant_fs_event(&next_event, &canon_root) {
                                is_relevant = true;
                            }
                        }
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => break 'watch_loop,
                    }
                }

                if is_relevant {
                    coordinator.trigger_background_scan(
                        canon_root.clone(),
                        Some(watch_gen),
                        app_handle.clone(),
                        db.clone(),
                    );
                }
            }
        });

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::midi::SongSettings;
    use notify::event::{AccessKind, CreateKind, RemoveKind, RenameMode};

    struct TempDirGuard(PathBuf);

    impl TempDirGuard {
        fn new(name: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let dir = std::env::temp_dir().join(format!(
                "aurelia_scanner_test_{}_{}_{}",
                name,
                std::process::id(),
                nanos
            ));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("Failed to create temp test dir");
            Self(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn make_test_midi_bytes(pitches: &[u8]) -> Vec<u8> {
        use midly::{
            num::{u15, u24, u28, u4, u7},
            Format, Header, MetaMessage, MidiMessage, Smf, Timing, TrackEvent, TrackEventKind,
        };

        let mut track = vec![TrackEvent {
            delta: u28::from(0),
            kind: TrackEventKind::Meta(MetaMessage::Tempo(u24::from(500_000))),
        }];

        for &pitch in pitches {
            track.push(TrackEvent {
                delta: u28::from(0),
                kind: TrackEventKind::Midi {
                    channel: u4::from(0),
                    message: MidiMessage::NoteOn {
                        key: u7::from(pitch),
                        vel: u7::from(90),
                    },
                },
            });
            track.push(TrackEvent {
                delta: u28::from(480),
                kind: TrackEventKind::Midi {
                    channel: u4::from(0),
                    message: MidiMessage::NoteOff {
                        key: u7::from(pitch),
                        vel: u7::from(0),
                    },
                },
            });
        }

        let mut bytes = Vec::new();
        let smf = Smf {
            header: Header::new(Format::SingleTrack, Timing::Metrical(u15::from(480))),
            tracks: vec![track],
        };
        smf.write(&mut bytes).expect("Failed to serialize test SMF");
        bytes
    }

    #[test]
    fn test_stat_first_fast_path_and_move_preserves_metadata() {
        let dir = TempDirGuard::new("fast_path_move");
        let db = LibraryDb::new_in_memory().unwrap();
        let song_path = dir.path().join("nocturne.mid");
        std::fs::write(&song_path, make_test_midi_bytes(&[60, 64])).unwrap();

        let first = scan_folder_with_progress(dir.path(), &db, None).unwrap();
        assert_eq!(first.added, 1);
        assert_eq!(first.updated, 0);
        assert_eq!(first.removed, 0);

        // Second scan must hit stat-first fast path with zero changes
        let second = scan_folder_with_progress(dir.path(), &db, None).unwrap();
        assert!(!second.changed());

        let songs = db.get_all_songs().unwrap();
        assert_eq!(songs.len(), 1);
        let hash = songs[0].content_hash.clone();
        assert!(db.toggle_favorite(&hash).unwrap());
        db.save_song_settings(&SongSettings {
            content_hash: hash.clone(),
            tempo_scale: 0.85,
            ..Default::default()
        })
        .unwrap();

        // Move and rename into "Op. 9/renamed.mid"
        let sub_dir = dir.path().join("Op. 9");
        std::fs::create_dir_all(&sub_dir).unwrap();
        let moved_path = sub_dir.join("renamed.mid");
        std::fs::rename(&song_path, &moved_path).unwrap();

        let third = scan_folder_with_progress(dir.path(), &db, None).unwrap();
        assert_eq!(third.added, 0);
        assert_eq!(third.updated, 1);
        assert_eq!(third.removed, 0);

        let moved_songs = db.get_all_songs().unwrap();
        assert_eq!(moved_songs.len(), 1);
        assert_eq!(moved_songs[0].content_hash, hash);
        assert_eq!(moved_songs[0].folder, "Op. 9");
        assert_eq!(moved_songs[0].title, "renamed");
        assert!(moved_songs[0].is_favorite);
        assert_eq!(db.get_song_settings(&hash).unwrap().tempo_scale, 0.85);
    }

    #[test]
    fn test_in_place_edit_replaces_old_hash_without_ghosts() {
        let dir = TempDirGuard::new("in_place_edit");
        let db = LibraryDb::new_in_memory().unwrap();
        let song_path = dir.path().join("piece.mid");
        std::fs::write(&song_path, make_test_midi_bytes(&[60])).unwrap();

        scan_folder_with_progress(dir.path(), &db, None).unwrap();
        let old_hash = db.get_all_songs().unwrap()[0].content_hash.clone();
        db.save_song_settings(&SongSettings {
            content_hash: old_hash.clone(),
            tempo_scale: 1.5,
            ..Default::default()
        })
        .unwrap();

        // Overwrite with different MIDI content & size at the exact same path
        std::fs::write(&song_path, make_test_midi_bytes(&[60, 64, 67])).unwrap();
        let res = scan_folder_with_progress(dir.path(), &db, None).unwrap();
        assert_eq!(res.added, 1);
        assert_eq!(res.removed, 1);

        let songs = db.get_all_songs().unwrap();
        assert_eq!(songs.len(), 1);
        assert_ne!(songs[0].content_hash, old_hash);

        // Old song_settings row must have been cascade-deleted
        let remaining_settings = db.get_song_settings(&old_hash).unwrap();
        assert_eq!(remaining_settings.tempo_scale, 1.0);
    }

    #[test]
    fn test_duplicate_files_do_not_ping_pong() {
        let dir = TempDirGuard::new("duplicates");
        let db = LibraryDb::new_in_memory().unwrap();
        let bytes = make_test_midi_bytes(&[62, 69]);
        let path_a = dir.path().join("a.mid");
        let path_b = dir.path().join("b.mid");
        std::fs::write(&path_a, &bytes).unwrap();
        std::fs::write(&path_b, &bytes).unwrap();

        let first = scan_folder_with_progress(dir.path(), &db, None).unwrap();
        assert_eq!(first.added, 1);
        let initial_path = db.get_all_songs().unwrap()[0].file_path.clone();

        // Repeated scans must report no changes and keep file_path stable
        let second = scan_folder_with_progress(dir.path(), &db, None).unwrap();
        assert!(!second.changed());
        assert_eq!(db.get_all_songs().unwrap()[0].file_path, initial_path);

        // Removing the currently indexed copy promotes the remaining copy while preserving metadata
        let hash = db.get_all_songs().unwrap()[0].content_hash.clone();
        db.toggle_favorite(&hash).unwrap();
        std::fs::remove_file(&initial_path).unwrap();

        let third = scan_folder_with_progress(dir.path(), &db, None).unwrap();
        assert_eq!(third.updated, 1);
        assert_eq!(third.removed, 0);
        let songs = db.get_all_songs().unwrap();
        assert_eq!(songs.len(), 1);
        assert_ne!(songs[0].file_path, initial_path);
        assert!(songs[0].is_favorite);
    }

    #[test]
    fn test_event_filter_dot_parent_root_dot_folder_and_access() {
        let root = Path::new("/tmp/.hidden_parent/midi_library");

        // MIDI file under a dot-prefixed ancestor of the library root must still trigger
        let midi_ev = Event::new(EventKind::Create(CreateKind::File))
            .add_path(root.join("Chopin/Op. 9/nocturne.mid"));
        assert!(is_relevant_fs_event(&midi_ev, root));

        // Removing/renaming a folder containing a dot (e.g. "Op. 9") must trigger
        let remove_dot_dir = Event::new(EventKind::Remove(RemoveKind::Folder))
            .add_path(root.join("Chopin/Op. 9"));
        assert!(is_relevant_fs_event(&remove_dot_dir, root));

        let rename_dot_dir = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Any)))
            .add_path(root.join("Op. 9"));
        assert!(is_relevant_fs_event(&rename_dot_dir, root));

        // Dotfiles inside the library root must be ignored
        let dotfile_ev = Event::new(EventKind::Remove(RemoveKind::File))
            .add_path(root.join(".DS_Store"));
        assert!(!is_relevant_fs_event(&dotfile_ev, root));

        // Access events must be ignored
        let access_ev = Event::new(EventKind::Access(AccessKind::Any))
            .add_path(root.join("nocturne.mid"));
        assert!(!is_relevant_fs_event(&access_ev, root));
    }

    #[test]
    fn test_empty_folder_tracking_in_scan_outcome() {
        let dir = TempDirGuard::new("empty_folders");
        let db = LibraryDb::new_in_memory().unwrap();
        let empty_a = dir.path().join("EmptyA");
        std::fs::create_dir_all(&empty_a).unwrap();

        let first = scan_folder_with_progress(dir.path(), &db, None).unwrap();
        assert_eq!(first.folders, vec!["EmptyA".to_string()]);

        let empty_b = dir.path().join("EmptyB");
        std::fs::rename(&empty_a, &empty_b).unwrap();
        let second = scan_folder_with_progress(dir.path(), &db, None).unwrap();
        assert_eq!(second.folders, vec!["EmptyB".to_string()]);

        std::fs::remove_dir_all(&empty_b).unwrap();
        let third = scan_folder_with_progress(dir.path(), &db, None).unwrap();
        assert!(third.folders.is_empty());
    }

    #[test]
    fn test_aborted_scan_does_not_wipe_db() {
        let dir = TempDirGuard::new("aborted_scan");
        let db = LibraryDb::new_in_memory().unwrap();
        std::fs::write(dir.path().join("keep.mid"), make_test_midi_bytes(&[60])).unwrap();

        scan_folder_with_progress(dir.path(), &db, None).unwrap();
        assert_eq!(db.get_all_songs().unwrap().len(), 1);

        // Aborting mid-scan must not call remove_stale_songs or wipe existing rows
        let aborted = scan_folder_with_abort(dir.path(), &db, None, || true).unwrap();
        assert_eq!(aborted.removed, 0);
        assert_eq!(db.get_all_songs().unwrap().len(), 1);
    }
}
