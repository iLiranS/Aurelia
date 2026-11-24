use std::collections::HashMap;
use std::fs::File;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use crossbeam_channel::{unbounded, Receiver, Sender};
use rustysynth::SoundFont;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::audio::backend::{AudioBackend, RustySynthBackend, SineFallbackBackend};
use crate::audio::dsp::{shape_velocity, SoundProfile, StudioDsp};
use crate::audio::sequencer::{SeqEvent, Sequencer};
use crate::midi::{HandRole, SongSettings};

pub enum AudioCommand {
    LoadSong {
        events: Vec<SeqEvent>,
        duration_sec: f64,
        settings: SongSettings,
    },
    Play,
    Pause,
    Seek(f64),
    SetVolume(f32),
    SetTempo(f64),
    SetLoop {
        enabled: bool,
        start_sec: Option<f64>,
        end_sec: Option<f64>,
    },
    SetHandFilters {
        right_enabled: bool,
        left_enabled: bool,
        track_hands: HashMap<u32, HandRole>,
        split_point_midi: u8,
        use_split_point: bool,
    },
    LiveNoteOn {
        key: u8,
        velocity: u8,
    },
    LiveNoteOff {
        key: u8,
    },
    LiveControlChange {
        controller: u8,
        value: u8,
    },
    LiveAllNotesOff,
    StartPreview {
        events: Vec<SeqEvent>,
        start_sec: f64,
        duration_sec: f64,
        volume: f32,
    },
    StopPreview,
    SetSoundProfile(SoundProfile),
    SetStudyMode {
        enabled: bool,
        wait_right: bool,
        wait_left: bool,
    },
    SetStudyRange {
        skip_out_of_range: bool,
        min_midi: u8,
        max_midi: u8,
    },
    SwapBackend(Box<dyn AudioBackend>),
}

impl std::fmt::Debug for AudioCommand {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::LoadSong { .. } => write!(f, "AudioCommand::LoadSong"),
            Self::Play => write!(f, "AudioCommand::Play"),
            Self::Pause => write!(f, "AudioCommand::Pause"),
            Self::Seek(s) => write!(f, "AudioCommand::Seek({})", s),
            Self::SetVolume(v) => write!(f, "AudioCommand::SetVolume({})", v),
            Self::SetTempo(t) => write!(f, "AudioCommand::SetTempo({})", t),
            Self::SetLoop { .. } => write!(f, "AudioCommand::SetLoop"),
            Self::SetHandFilters { .. } => write!(f, "AudioCommand::SetHandFilters"),
            Self::LiveNoteOn { key, velocity } => {
                write!(f, "AudioCommand::LiveNoteOn({}, {})", key, velocity)
            }
            Self::LiveNoteOff { key } => write!(f, "AudioCommand::LiveNoteOff({})", key),
            Self::LiveControlChange { controller, value } => {
                write!(f, "AudioCommand::LiveControlChange({}, {})", controller, value)
            }
            Self::LiveAllNotesOff => write!(f, "AudioCommand::LiveAllNotesOff"),
            Self::StartPreview { .. } => write!(f, "AudioCommand::StartPreview"),
            Self::StopPreview => write!(f, "AudioCommand::StopPreview"),
            Self::SetSoundProfile(p) => write!(f, "AudioCommand::SetSoundProfile({:?})", p),
            Self::SetStudyMode {
                enabled,
                wait_right,
                wait_left,
            } => write!(
                f,
                "AudioCommand::SetStudyMode({}, {}, {})",
                enabled, wait_right, wait_left
            ),
            Self::SetStudyRange {
                skip_out_of_range,
                min_midi,
                max_midi,
            } => write!(
                f,
                "AudioCommand::SetStudyRange({}, {}, {})",
                skip_out_of_range, min_midi, max_midi
            ),
            Self::SwapBackend(_) => write!(f, "AudioCommand::SwapBackend"),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackClockPayload {
    pub song_time_sec: f64,
    pub is_playing: bool,
    pub tempo_scale: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyWaitKey {
    pub midi: u8,
    pub hand: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyWaitPayload {
    pub is_waiting: bool,
    pub waiting_keys: Vec<StudyWaitKey>,
    pub song_time_sec: f64,
}

#[derive(Clone, Copy)]
struct StudyWaitSnapshot {
    is_waiting: bool,
    waiting_keys_hand: [u8; 128],
}

#[derive(Clone)]
pub struct AudioEngineHandle {
    cmd_tx: Sender<AudioCommand>,
    clock_bits: Arc<AtomicU64>,
    is_playing: Arc<AtomicBool>,
    tempo_scale_bits: Arc<AtomicU64>,
    sample_rate: Arc<AtomicU32>,
}

impl AudioEngineHandle {
    pub fn send(&self, cmd: AudioCommand) -> Result<(), String> {
        self.cmd_tx
            .send(cmd)
            .map_err(|e| format!("Failed to send audio command: {}", e))
    }

    pub fn get_song_time_sec(&self) -> f64 {
        f64::from_bits(self.clock_bits.load(Ordering::Relaxed))
    }

    pub fn get_is_playing(&self) -> bool {
        self.is_playing.load(Ordering::Relaxed)
    }

    pub fn get_tempo_scale(&self) -> f64 {
        f64::from_bits(self.tempo_scale_bits.load(Ordering::Relaxed))
    }

    pub fn get_sample_rate(&self) -> u32 {
        self.sample_rate.load(Ordering::Relaxed)
    }
}

pub fn start_audio_engine(
    app_handle: AppHandle,
    soundfont_candidates: Vec<PathBuf>,
) -> AudioEngineHandle {
    let (cmd_tx, cmd_rx) = unbounded::<AudioCommand>();
    let (wait_tx, wait_rx) = crossbeam_channel::bounded::<StudyWaitSnapshot>(8);
    let clock_bits = Arc::new(AtomicU64::new(0.0f64.to_bits()));
    let is_playing = Arc::new(AtomicBool::new(false));
    let tempo_scale_bits = Arc::new(AtomicU64::new(1.0f64.to_bits()));
    let sample_rate_atomic = Arc::new(AtomicU32::new(44100));

    let handle = AudioEngineHandle {
        cmd_tx,
        clock_bits: clock_bits.clone(),
        is_playing: is_playing.clone(),
        tempo_scale_bits: tempo_scale_bits.clone(),
        sample_rate: sample_rate_atomic.clone(),
    };

    let sample_rate_thread = sample_rate_atomic.clone();
    // Dedicated thread owning the cpal::Stream (which is !Send on macOS)
    thread::spawn(move || {
        run_audio_thread(
            cmd_rx,
            wait_tx,
            clock_bits,
            is_playing,
            tempo_scale_bits,
            sample_rate_thread,
            soundfont_candidates,
        );
    });

    // Background thread emitting ~30Hz clock updates & study-wait changes to frontend
    let app_handle_clone = app_handle.clone();
    let handle_for_ticker = handle.clone();
    thread::spawn(move || {
        let mut last_was_playing = false;
        let mut last_emitted_time = 0.0f64;

        loop {
            thread::sleep(Duration::from_millis(33)); // ~30Hz

            let mut latest_wait: Option<StudyWaitSnapshot> = None;
            while let Ok(snap) = wait_rx.try_recv() {
                latest_wait = Some(snap);
            }

            let current_playing = handle_for_ticker.get_is_playing();
            let current_time = handle_for_ticker.get_song_time_sec();
            let current_tempo = handle_for_ticker.get_tempo_scale();

            if let Some(snap) = latest_wait {
                let mut waiting_keys = Vec::new();
                for (midi, &hand) in snap.waiting_keys_hand.iter().enumerate() {
                    if hand != 0 {
                        waiting_keys.push(StudyWaitKey {
                            midi: midi as u8,
                            hand,
                        });
                    }
                }
                let _ = app_handle_clone.emit(
                    "playback:study-wait",
                    StudyWaitPayload {
                        is_waiting: snap.is_waiting,
                        waiting_keys,
                        song_time_sec: current_time,
                    },
                );
                let _ = app_handle_clone.emit(
                    "playback:clock",
                    PlaybackClockPayload {
                        song_time_sec: current_time,
                        is_playing: current_playing,
                        tempo_scale: current_tempo,
                    },
                );
                last_emitted_time = current_time;
                last_was_playing = current_playing;
                continue;
            }

            // Emit if playing or just changed playback state
            if current_playing || last_was_playing != current_playing || (current_time - last_emitted_time).abs() > 0.05 {
                let payload = PlaybackClockPayload {
                    song_time_sec: current_time,
                    is_playing: current_playing,
                    tempo_scale: current_tempo,
                };
                let _ = app_handle_clone.emit("playback:clock", payload);
                last_emitted_time = current_time;
            }

            last_was_playing = current_playing;
        }
    });

    handle
}

fn load_soundfont(candidates: &[PathBuf]) -> Option<Arc<SoundFont>> {
    for path in candidates {
        if path.exists() {
            if let Ok(mut file) = File::open(path) {
                if let Ok(sf) = SoundFont::new(&mut file) {
                    println!("[Aurelia Audio] Loaded SoundFont from {:?}", path);
                    return Some(Arc::new(sf));
                }
            }
        }
    }
    None
}

fn run_audio_thread(
    cmd_rx: Receiver<AudioCommand>,
    wait_tx: crossbeam_channel::Sender<StudyWaitSnapshot>,
    clock_bits: Arc<AtomicU64>,
    is_playing_atomic: Arc<AtomicBool>,
    tempo_scale_bits: Arc<AtomicU64>,
    sample_rate_atomic: Arc<AtomicU32>,
    soundfont_candidates: Vec<PathBuf>,
) {
    let host = cpal::default_host();
    let device = match host.default_output_device() {
        Some(d) => d,
        None => {
            eprintln!("[Aurelia Audio] No default audio output device available");
            return;
        }
    };

    let supported_config = match device.default_output_config() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[Aurelia Audio] Failed to get default output config: {}", e);
            return;
        }
    };

    let sample_format = supported_config.sample_format();
    let config: StreamConfig = supported_config.into();
    let sample_rate = config.sample_rate.0 as f64;
    sample_rate_atomic.store(config.sample_rate.0, Ordering::Relaxed);
    let channels = config.channels as usize;

    let sound_font_opt = load_soundfont(&soundfont_candidates);
    let mut backend: Box<dyn AudioBackend> = if let Some(sf) = sound_font_opt {
        match RustySynthBackend::new(sf, sample_rate as i32) {
            Ok(b) => Box::new(b),
            Err(e) => {
                eprintln!("[Aurelia Audio] RustySynth init error: {}. Using fallback sine synth.", e);
                Box::new(SineFallbackBackend::new(sample_rate as f32))
            }
        }
    } else {
        eprintln!("[Aurelia Audio] No piano.sf2 found in candidates. Using fallback sine synth.");
        Box::new(SineFallbackBackend::new(sample_rate as f32))
    };

    let mut sequencer = Sequencer::new();
    let mut dsp = StudioDsp::new(sample_rate as f32);

    // Off-thread drop channel: whenever a backend is swapped, old backend is sent here
    // so deallocation happens safely off the real-time audio thread
    let (drop_tx, drop_rx) = crossbeam_channel::bounded::<Box<dyn AudioBackend>>(8);
    thread::spawn(move || {
        while let Ok(old_backend) = drop_rx.recv() {
            drop(old_backend);
        }
    });

    // Reusable buffers to guarantee zero allocation in the audio loop
    let mut left_buf = vec![0.0f32; 1024];
    let mut right_buf = vec![0.0f32; 1024];

    let err_fn = |err| eprintln!("[Aurelia Audio] Output stream error: {}", err);

    let stream = match sample_format {
        SampleFormat::F32 => {
            let clock_bits_cb = clock_bits.clone();
            let is_playing_cb = is_playing_atomic.clone();
            let tempo_cb = tempo_scale_bits.clone();
            let mut is_preview_mode = false;
            let mut preview_end_sec = 0.0f64;
            let mut last_wait_version = 0u64;

            device.build_output_stream(
                &config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    process_audio_block(
                        data,
                        channels,
                        sample_rate,
                        &cmd_rx,
                        &wait_tx,
                        &mut last_wait_version,
                        &mut sequencer,
                        &mut backend,
                        &drop_tx,
                        &mut dsp,
                        &mut left_buf,
                        &mut right_buf,
                        &clock_bits_cb,
                        &is_playing_cb,
                        &tempo_cb,
                        &mut is_preview_mode,
                        &mut preview_end_sec,
                    );
                },
                err_fn,
                None,
            )
        }
        _ => {
            eprintln!("[Aurelia Audio] Unsupported sample format {:?}, fallback stream not built", sample_format);
            return;
        }
    };

    let stream = match stream {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[Aurelia Audio] Failed to build output stream: {}", e);
            return;
        }
    };

    if let Err(e) = stream.play() {
        eprintln!("[Aurelia Audio] Failed to start output stream: {}", e);
        return;
    }

    println!("[Aurelia Audio] Output stream started cleanly at {} Hz ({} channels)", sample_rate, channels);

    // Keep thread alive while channel is open
    loop {
        thread::park();
    }
}

#[inline]
fn process_audio_block(
    data: &mut [f32],
    channels: usize,
    sample_rate: f64,
    cmd_rx: &Receiver<AudioCommand>,
    wait_tx: &crossbeam_channel::Sender<StudyWaitSnapshot>,
    last_wait_version: &mut u64,
    sequencer: &mut Sequencer,
    backend: &mut Box<dyn AudioBackend>,
    drop_tx: &Sender<Box<dyn AudioBackend>>,
    dsp: &mut StudioDsp,
    left_buf: &mut Vec<f32>,
    right_buf: &mut Vec<f32>,
    clock_bits: &Arc<AtomicU64>,
    is_playing_atomic: &Arc<AtomicBool>,
    tempo_scale_bits: &Arc<AtomicU64>,
    is_preview_mode: &mut bool,
    preview_end_sec: &mut f64,
) {
    // 1. Drain incoming commands without locking or allocating
    while let Ok(cmd) = cmd_rx.try_recv() {
        match cmd {
            AudioCommand::LoadSong {
                events,
                duration_sec,
                settings,
            } => {
                *is_preview_mode = false;
                backend.all_notes_off();
                sequencer.load_song(events, duration_sec, &settings);
            }
            AudioCommand::Play => {
                *is_preview_mode = false;
                sequencer.is_playing = true;
            }
            AudioCommand::Pause => {
                *is_preview_mode = false;
                sequencer.is_playing = false;
                sequencer.clear_wait_state();
                backend.all_notes_off();
            }
            AudioCommand::Seek(sec) => {
                *is_preview_mode = false;
                backend.all_notes_off();
                sequencer.seek(sec);
            }
            AudioCommand::SetVolume(vol) => {
                sequencer.volume = vol;
            }
            AudioCommand::SetTempo(scale) => {
                sequencer.tempo_scale = scale;
            }
            AudioCommand::SetLoop {
                enabled,
                start_sec,
                end_sec,
            } => {
                sequencer.loop_enabled = enabled;
                sequencer.loop_start_sec = start_sec;
                sequencer.loop_end_sec = end_sec;
            }
            AudioCommand::SetHandFilters {
                right_enabled,
                left_enabled,
                track_hands,
                split_point_midi,
                use_split_point,
            } => {
                sequencer.right_hand_enabled = right_enabled;
                sequencer.left_hand_enabled = left_enabled;
                sequencer.track_hands = track_hands;
                sequencer.split_point_midi = split_point_midi;
                sequencer.use_split_point = use_split_point;
            }
            AudioCommand::LiveNoteOn { key, velocity } => {
                let shaped_vel = shape_velocity(velocity, sequencer.touch);
                backend.note_on(0, key as i32, shaped_vel as i32);
                sequencer.on_live_note_on(key);
            }
            AudioCommand::LiveNoteOff { key } => {
                backend.note_off(0, key as i32);
            }
            AudioCommand::LiveControlChange { controller, value } => {
                backend.control_change(0, controller as i32, value as i32);
            }
            AudioCommand::LiveAllNotesOff => {
                backend.all_notes_off();
            }
            AudioCommand::StartPreview {
                events,
                start_sec,
                duration_sec,
                volume,
            } => {
                *is_preview_mode = true;
                *preview_end_sec = start_sec + duration_sec;
                backend.all_notes_off();
                let preview_settings = SongSettings::default();
                let max_dur = if events.is_empty() {
                    0.0
                } else {
                    events.last().map(|e| e.time_sec).unwrap_or(0.0)
                };
                sequencer.load_song(events, max_dur, &preview_settings);
                sequencer.preview_bypass_study = true;
                sequencer.seek(start_sec);
                sequencer.tempo_scale = 1.0;
                sequencer.volume = volume;
                sequencer.is_playing = true;
            }
            AudioCommand::StopPreview => {
                if *is_preview_mode {
                    *is_preview_mode = false;
                    sequencer.preview_bypass_study = false;
                    sequencer.is_playing = false;
                    backend.all_notes_off();
                }
            }
            AudioCommand::SetSoundProfile(profile) => {
                dsp.set_profile(profile);
                sequencer.touch = profile.touch;
            }
            AudioCommand::SetStudyMode {
                enabled,
                wait_right,
                wait_left,
            } => {
                sequencer.set_study_mode(enabled, wait_right, wait_left);
            }
            AudioCommand::SetStudyRange {
                skip_out_of_range,
                min_midi,
                max_midi,
            } => {
                sequencer.set_study_range(skip_out_of_range, min_midi, max_midi);
            }
            AudioCommand::SwapBackend(new_backend) => {
                backend.all_notes_off();
                let old = std::mem::replace(backend, new_backend);
                let _ = drop_tx.try_send(old);
            }
        }
    }

    let frames = data.len() / channels;
    if left_buf.len() < frames {
        left_buf.resize(frames, 0.0);
        right_buf.resize(frames, 0.0);
    }

    let left = &mut left_buf[..frames];
    let right = &mut right_buf[..frames];

    // 2. Render sequencer & synth block
    sequencer.render_block(&mut **backend, left, right, sample_rate);

    if !*is_preview_mode && sequencer.wait_state_version != *last_wait_version {
        *last_wait_version = sequencer.wait_state_version;
        let _ = wait_tx.try_send(StudyWaitSnapshot {
            is_waiting: sequencer.is_waiting,
            waiting_keys_hand: sequencer.waiting_keys_hand,
        });
    }

    // 3. Process studio DSP chain (warmth shelf EQ, stereo reverb, makeup gain, soft limiter)
    dsp.process_stereo(left, right);

    if *is_preview_mode && sequencer.song_time_sec >= *preview_end_sec {
        *is_preview_mode = false;
        sequencer.is_playing = false;
        backend.all_notes_off();
    }

    // 4. Interleave into output stream buffer
    if channels == 2 {
        for i in 0..frames {
            data[i * 2] = left[i];
            data[i * 2 + 1] = right[i];
        }
    } else if channels == 1 {
        for i in 0..frames {
            data[i] = 0.5 * (left[i] + right[i]);
        }
    } else {
        // Multi-channel (e.g. 5.1 / 7.1)
        for i in 0..frames {
            data[i * channels] = left[i];
            data[i * channels + 1] = right[i];
            for ch in 2..channels {
                data[i * channels + ch] = 0.0;
            }
        }
    }

    // 4. Update shared lock-free clock atomics
    if !*is_preview_mode {
        clock_bits.store(sequencer.song_time_sec.to_bits(), Ordering::Relaxed);
        is_playing_atomic.store(sequencer.is_playing, Ordering::Relaxed);
        tempo_scale_bits.store(sequencer.tempo_scale.to_bits(), Ordering::Relaxed);
    } else {
        // In preview mode, ensure main clock reports not playing so Song View is unaffected
        is_playing_atomic.store(false, Ordering::Relaxed);
    }
}
