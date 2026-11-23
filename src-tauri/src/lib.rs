use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub mod audio;
pub mod commands;
pub mod library;
pub mod midi;

use audio::engine::start_audio_engine;
use library::db::LibraryDb;
use library::scanner::FolderWatcherManager;
use midi::input::MidiInputManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");
            let db_path = app_data_dir.join("aurelia.db");
            let db = Arc::new(LibraryDb::new(&db_path).expect("Failed to initialize SQLite database"));

            let mut watcher_mgr = FolderWatcherManager::new();

            // If a root_folder was previously saved, scan it and start watcher
            if let Ok(Some(saved_root)) = db.get_setting("root_folder") {
                let path = PathBuf::from(&saved_root);
                if path.exists() && path.is_dir() {
                    let _ = crate::library::scanner::scan_folder(&path, &db);
                    let _ = watcher_mgr.watch(path, app.handle().clone(), db.clone());
                }
            }

            // SoundFont search candidates (bundled resource or local dev paths)
            let mut sf_candidates = Vec::new();

            // 1. Check user-saved active soundfont from SQLite
            if let Ok(Some(saved_sf)) = db.get_setting("active_soundfont_v1") {
                let p = PathBuf::from(saved_sf);
                if p.exists() {
                    sf_candidates.push(p);
                }
            }

            // 2. Bundled and dev candidates
            if let Ok(res_dir) = app.path().resource_dir() {
                sf_candidates.push(res_dir.join("resources").join("soundfonts").join("YDP-GrandPiano-20160804.sf2"));
                sf_candidates.push(res_dir.join("resources").join("piano.sf2"));
                sf_candidates.push(res_dir.join("piano.sf2"));
            }
            sf_candidates.push(PathBuf::from("resources/soundfonts/YDP-GrandPiano-20160804.sf2"));
            sf_candidates.push(PathBuf::from("src-tauri/resources/soundfonts/YDP-GrandPiano-20160804.sf2"));
            sf_candidates.push(PathBuf::from("resources/piano.sf2"));
            sf_candidates.push(PathBuf::from("src-tauri/resources/piano.sf2"));

            let audio_handle = start_audio_engine(app.handle().clone(), sf_candidates);
            let midi_manager = MidiInputManager::new(audio_handle.clone());
            // Initialize CoreMIDI on the main thread so its CFRunLoop processes hot-plug updates.
            let _ = MidiInputManager::list_devices();
            MidiInputManager::start_hotplug_watcher(midi_manager.clone(), app.handle().clone());

            app.manage(db);
            app.manage(Mutex::new(watcher_mgr));
            app.manage(audio_handle);
            app.manage(midi_manager);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library::get_root_folder,
            commands::library::set_root_folder,
            commands::library::get_library_songs,
            commands::library::load_song,
            commands::library::save_song_settings,
            commands::library::toggle_favorite,
            commands::library::get_app_setting,
            commands::library::set_app_setting,
            commands::library::get_song_preview_notes,
            commands::library::delete_library_song,
            commands::library::list_library_folders,
            commands::library::create_library_folder,
            commands::library::move_library_song,
            commands::library::rename_library_song,
            commands::library::rename_library_folder,
            commands::library::delete_library_folder,
            commands::playback::audio_load_song,
            commands::playback::audio_play,
            commands::playback::audio_pause,
            commands::playback::audio_seek,
            commands::playback::audio_set_volume,
            commands::playback::audio_set_tempo,
            commands::playback::audio_set_loop,
            commands::playback::audio_set_hand_filters,
            commands::playback::audio_live_note_on,
            commands::playback::audio_live_note_off,
            commands::playback::audio_live_all_notes_off,
            commands::playback::audio_set_study_mode,
            commands::playback::audio_start_preview,
            commands::playback::audio_stop_preview,
            commands::playback::audio_set_sound_profile,
            commands::playback::list_soundfonts,
            commands::playback::select_soundfont,
            commands::playback::import_soundfont,
            commands::midi_input::list_midi_devices,
            commands::midi_input::connect_midi_device,
            commands::midi_input::disconnect_midi_device,
            commands::midi_input::get_connected_midi_device,
            commands::recording::save_freeplay_midi,
            commands::recording::export_midi_copy,
            commands::recording::export_song_audio,
            commands::recording::export_freeplay_audio,
        ])
        .run(tauri::generate_context!())
        .expect("error while running aurelia application");
}
