use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use rustysynth::SoundFont;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::audio::backend::RustySynthBackend;
use crate::audio::dsp::SoundProfile;
use crate::audio::engine::{AudioCommand, AudioEngineHandle, PlaybackClockPayload};
use crate::audio::sequencer::build_seq_events;
use crate::audio::soundfonts::{
    delete_soundfont_file, discover_soundfonts, import_soundfont_file, SoundFontInfo,
};
use crate::library::db::LibraryDb;
use crate::midi::{parse_midi_file, HandRole, SongSettings};

#[tauri::command]
pub fn audio_load_song(
    engine: State<'_, AudioEngineHandle>,
    file_path: String,
    settings: SongSettings,
) -> Result<(), String> {
    let path = Path::new(&file_path);
    let parsed = parse_midi_file(path)?;
    let events = build_seq_events(&parsed, &settings);

    engine.send(AudioCommand::LoadSong {
        events,
        duration_sec: parsed.duration_sec,
        settings,
    })
}

#[tauri::command]
pub fn audio_play(app: AppHandle, engine: State<'_, AudioEngineHandle>) -> Result<(), String> {
    engine.send(AudioCommand::Play)?;
    let _ = app.emit(
        "playback:clock",
        PlaybackClockPayload {
            song_time_sec: engine.get_song_time_sec(),
            is_playing: true,
            tempo_scale: engine.get_tempo_scale(),
        },
    );
    Ok(())
}

#[tauri::command]
pub fn audio_pause(app: AppHandle, engine: State<'_, AudioEngineHandle>) -> Result<(), String> {
    engine.send(AudioCommand::Pause)?;
    let _ = app.emit(
        "playback:clock",
        PlaybackClockPayload {
            song_time_sec: engine.get_song_time_sec(),
            is_playing: false,
            tempo_scale: engine.get_tempo_scale(),
        },
    );
    Ok(())
}

#[tauri::command]
pub fn audio_seek(
    app: AppHandle,
    engine: State<'_, AudioEngineHandle>,
    time_sec: f64,
) -> Result<(), String> {
    engine.send(AudioCommand::Seek(time_sec))?;
    let _ = app.emit(
        "playback:clock",
        PlaybackClockPayload {
            song_time_sec: time_sec,
            is_playing: engine.get_is_playing(),
            tempo_scale: engine.get_tempo_scale(),
        },
    );
    Ok(())
}

#[tauri::command]
pub fn audio_set_song_volume(
    engine: State<'_, AudioEngineHandle>,
    volume: f32,
) -> Result<(), String> {
    engine.send(AudioCommand::SetSongVolume(volume))
}

#[tauri::command]
pub fn audio_set_live_volume(
    engine: State<'_, AudioEngineHandle>,
    volume: f32,
) -> Result<(), String> {
    engine.send(AudioCommand::SetLiveVolume(volume))
}

#[tauri::command]
pub fn audio_set_tempo(
    app: AppHandle,
    engine: State<'_, AudioEngineHandle>,
    tempo_scale: f64,
) -> Result<(), String> {
    engine.send(AudioCommand::SetTempo(tempo_scale))?;
    let _ = app.emit(
        "playback:clock",
        PlaybackClockPayload {
            song_time_sec: engine.get_song_time_sec(),
            is_playing: engine.get_is_playing(),
            tempo_scale,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn audio_set_loop(
    engine: State<'_, AudioEngineHandle>,
    enabled: bool,
    start_sec: Option<f64>,
    end_sec: Option<f64>,
    pause_on_wrap: Option<bool>,
) -> Result<(), String> {
    engine.send(AudioCommand::SetLoop {
        enabled,
        start_sec,
        end_sec,
        pause_on_wrap: pause_on_wrap.unwrap_or(false),
    })
}

#[tauri::command]
pub fn audio_set_hand_filters(
    engine: State<'_, AudioEngineHandle>,
    right_enabled: bool,
    left_enabled: bool,
    track_hands: HashMap<u32, HandRole>,
    split_point_midi: u8,
    use_split_point: bool,
) -> Result<(), String> {
    engine.send(AudioCommand::SetHandFilters {
        right_enabled,
        left_enabled,
        track_hands,
        split_point_midi,
        use_split_point,
    })
}

#[tauri::command]
pub fn audio_live_note_on(
    engine: State<'_, AudioEngineHandle>,
    key: u8,
    velocity: u8,
) -> Result<(), String> {
    engine.send(AudioCommand::LiveNoteOn { key, velocity })
}

#[tauri::command]
pub fn audio_live_note_off(
    engine: State<'_, AudioEngineHandle>,
    key: u8,
) -> Result<(), String> {
    engine.send(AudioCommand::LiveNoteOff { key })
}

#[tauri::command]
pub fn audio_live_all_notes_off(
    engine: State<'_, AudioEngineHandle>,
) -> Result<(), String> {
    engine.send(AudioCommand::LiveAllNotesOff)
}

#[tauri::command]
pub fn audio_set_study_mode(
    engine: State<'_, AudioEngineHandle>,
    enabled: bool,
    wait_right: bool,
    wait_left: bool,
    melody_only: bool,
    mute_harmony_audio: bool,
) -> Result<(), String> {
    engine.send(AudioCommand::SetStudyMode {
        enabled,
        wait_right,
        wait_left,
        melody_only,
        mute_harmony_audio,
    })
}

#[tauri::command]
pub fn audio_set_study_range(
    engine: State<'_, AudioEngineHandle>,
    skip_out_of_range: bool,
    min_midi: u8,
    max_midi: u8,
) -> Result<(), String> {
    engine.send(AudioCommand::SetStudyRange {
        skip_out_of_range,
        min_midi,
        max_midi,
    })
}

#[tauri::command]
pub fn audio_set_transpose(
    engine: State<'_, AudioEngineHandle>,
    semitones: i8,
) -> Result<(), String> {
    engine.send(AudioCommand::SetTranspose(semitones))
}

#[tauri::command]
pub fn audio_start_preview(
    engine: State<'_, AudioEngineHandle>,
    file_path: String,
    start_sec: f64,
    volume: f32,
) -> Result<(), String> {
    let path = Path::new(&file_path);
    let parsed = crate::midi::parse_midi_file(path)?;
    let default_settings = SongSettings::default();
    let events = build_seq_events(&parsed, &default_settings);
    let remaining_dur = (parsed.duration_sec - start_sec).max(1.0);

    engine.send(AudioCommand::StartPreview {
        events,
        start_sec,
        duration_sec: remaining_dur,
        volume,
    })
}

#[tauri::command]
pub fn audio_stop_preview(
    engine: State<'_, AudioEngineHandle>,
) -> Result<(), String> {
    engine.send(AudioCommand::StopPreview)
}

#[tauri::command]
pub fn audio_set_sound_profile(
    engine: State<'_, AudioEngineHandle>,
    profile: SoundProfile,
) -> Result<(), String> {
    engine.send(AudioCommand::SetSoundProfile(profile))
}

fn get_soundfont_dirs(app: &AppHandle) -> (Vec<PathBuf>, PathBuf) {
    let mut bundled = Vec::new();
    if let Ok(res_dir) = app.path().resource_dir() {
        bundled.push(res_dir.join("resources").join("soundfonts"));
        bundled.push(res_dir.join("resources"));
        bundled.push(res_dir.join("soundfonts"));
        bundled.push(res_dir);
    }
    bundled.push(PathBuf::from("resources/soundfonts"));
    bundled.push(PathBuf::from("src-tauri/resources/soundfonts"));
    bundled.push(PathBuf::from("resources"));
    bundled.push(PathBuf::from("src-tauri/resources"));

    let user_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("soundfonts");

    (bundled, user_dir)
}

#[tauri::command]
pub fn list_soundfonts(app: AppHandle) -> Result<Vec<SoundFontInfo>, String> {
    let (bundled, user_dir) = get_soundfont_dirs(&app);
    Ok(discover_soundfonts(&bundled, &user_dir))
}

#[tauri::command]
pub fn select_soundfont(
    app: AppHandle,
    engine: State<'_, AudioEngineHandle>,
    db: State<'_, Arc<LibraryDb>>,
    path: String,
) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    if !file_path.exists() {
        return Err(format!("SoundFont file not found: {}", path));
    }

    // Persist to SQLite app_settings key "active_soundfont_v1"
    db.set_setting("active_soundfont_v1", &path)?;

    let sample_rate = engine.get_sample_rate() as i32;
    let engine_handle = engine.inner().clone();
    let app_handle = app.clone();
    let path_clone = path.clone();

    // Spawn background loader thread so main UI and audio stream never freeze
    std::thread::spawn(move || {
        let p = PathBuf::from(&path_clone);
        match File::open(&p) {
            Ok(mut file) => match SoundFont::new(&mut file) {
                Ok(sf) => match RustySynthBackend::new(Arc::new(sf), sample_rate) {
                    Ok(backend) => {
                        if let Err(e) = engine_handle.send(AudioCommand::SwapBackend(Box::new(backend))) {
                            eprintln!("[Aurelia Audio] Failed to send SwapBackend command: {}", e);
                        } else {
                            println!("[Aurelia Audio] Swapped SoundFont to {:?}", path_clone);
                            let _ = app_handle.emit("audio:soundfont-changed", &path_clone);
                        }
                    }
                    Err(e) => eprintln!("[Aurelia Audio] Failed to create RustySynthBackend: {}", e),
                },
                Err(e) => eprintln!("[Aurelia Audio] Failed to parse SoundFont: {:?}", e),
            },
            Err(e) => eprintln!("[Aurelia Audio] Failed to open SoundFont file: {}", e),
        }
    });

    Ok(())
}

#[tauri::command]
pub fn import_soundfont(
    app: AppHandle,
    engine: State<'_, AudioEngineHandle>,
    db: State<'_, Arc<LibraryDb>>,
    source_path: String,
) -> Result<SoundFontInfo, String> {
    let (_, user_dir) = get_soundfont_dirs(&app);
    let info = import_soundfont_file(Path::new(&source_path), &user_dir)?;

    // Automatically select the newly imported soundfont
    select_soundfont(app, engine, db, info.path.clone())?;

    Ok(info)
}

#[tauri::command]
pub fn delete_soundfont(
    app: AppHandle,
    engine: State<'_, AudioEngineHandle>,
    db: State<'_, Arc<LibraryDb>>,
    path: String,
) -> Result<Option<String>, String> {
    let (bundled, user_dir) = get_soundfont_dirs(&app);
    delete_soundfont_file(Path::new(&path), &user_dir)?;

    let saved_active = db.get_setting("active_soundfont_v1").ok().flatten();
    let target_canon = std::fs::canonicalize(&path).ok();
    let is_active = saved_active.as_deref().is_some_and(|saved| {
        saved == path
            || target_canon
                .as_ref()
                .zip(std::fs::canonicalize(saved).ok().as_ref())
                .is_some_and(|(a, b)| a == b)
    });

    if is_active {
        let remaining = discover_soundfonts(&bundled, &user_dir);
        if let Some(fallback) = remaining.first() {
            select_soundfont(app, engine, db, fallback.path.clone())?;
            return Ok(Some(fallback.path.clone()));
        }
        let _ = db.set_setting("active_soundfont_v1", "");
        return Ok(None);
    }

    Ok(saved_active.filter(|s| !s.is_empty()))
}
