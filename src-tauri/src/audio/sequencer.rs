use std::collections::HashMap;
use crate::audio::backend::AudioBackend;
use crate::audio::dsp::{shape_velocity, TouchPreset};
use crate::midi::{HandRole, ParsedSong, SongSettings};

pub const CHORD_WINDOW_SEC: f64 = 0.045; // 45 ms chord grouping
pub const EARLY_HIT_WINDOW_SEC: f64 = 0.150; // 150 ms early-hit forgiveness

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeqEventKind {
    NoteOn { key: u8, velocity: u8, track_index: u32, hand: u8 }, // hand: 0=right, 1=left
    NoteOff { key: u8, track_index: u32, hand: u8 },
    Sustain { value: u8 },
}

#[derive(Debug, Clone)]
pub struct SeqEvent {
    pub time_sec: f64,
    pub kind: SeqEventKind,
}

pub struct Sequencer {
    pub events: Vec<SeqEvent>,
    pub cursor: usize,
    pub song_time_sec: f64,
    pub duration_sec: f64,
    pub is_playing: bool,
    pub tempo_scale: f64,
    pub volume: f32,
    pub touch: TouchPreset,
    pub right_hand_enabled: bool,
    pub left_hand_enabled: bool,
    pub track_hands: HashMap<u32, HandRole>,
    pub split_point_midi: u8,
    pub use_split_point: bool,
    pub loop_enabled: bool,
    pub loop_start_sec: Option<f64>,
    pub loop_end_sec: Option<f64>,
    pub transpose_semitones: i8,
    pub study_mode: bool,
    pub preview_bypass_study: bool,
    pub study_wait_right: bool,
    pub study_wait_left: bool,
    pub study_skip_out_of_range: bool,
    pub study_min_midi: u8,
    pub study_max_midi: u8,
    pub is_waiting: bool,
    pub waiting_keys: [bool; 128],
    pub waiting_keys_hand: [u8; 128], // 0=none, 1=right, 2=left
    pub recent_live_hits: [f64; 128], // song_time_sec of last live NoteOn per key (-1.0 = none)
    pub wait_state_version: u64,
}

impl Sequencer {
    pub fn new() -> Self {
        Self {
            events: Vec::new(),
            cursor: 0,
            song_time_sec: 0.0,
            duration_sec: 0.0,
            is_playing: false,
            tempo_scale: 1.0,
            volume: 0.85,
            touch: TouchPreset::Balanced,
            right_hand_enabled: true,
            left_hand_enabled: true,
            track_hands: HashMap::new(),
            split_point_midi: 60,
            use_split_point: false,
            loop_enabled: false,
            loop_start_sec: None,
            loop_end_sec: None,
            transpose_semitones: 0,
            study_mode: false,
            preview_bypass_study: false,
            study_wait_right: true,
            study_wait_left: true,
            study_skip_out_of_range: true,
            study_min_midi: 21,
            study_max_midi: 108,
            is_waiting: false,
            waiting_keys: [false; 128],
            waiting_keys_hand: [0; 128],
            recent_live_hits: [-1.0; 128],
            wait_state_version: 0,
        }
    }

    pub fn load_song(&mut self, events: Vec<SeqEvent>, duration_sec: f64, settings: &SongSettings) {
        self.events = events;
        self.duration_sec = duration_sec;
        self.cursor = 0;
        self.song_time_sec = 0.0;
        self.is_playing = false;
        self.tempo_scale = settings.tempo_scale;
        self.track_hands = settings.track_hands.clone();
        self.split_point_midi = settings.split_point_midi;
        self.use_split_point = settings.use_split_point;
        self.loop_enabled = settings.loop_enabled;
        self.loop_start_sec = settings.loop_start_sec;
        self.loop_end_sec = settings.loop_end_sec;
        self.transpose_semitones = settings.transpose_semitones.clamp(-12, 12);
        self.preview_bypass_study = false;
        self.clear_wait_state();
    }

    pub fn seek(&mut self, target_sec: f64) {
        self.song_time_sec = target_sec.clamp(0.0, self.duration_sec);
        self.cursor = self
            .events
            .partition_point(|ev| ev.time_sec < self.song_time_sec);
        self.clear_wait_state();
    }

    pub fn clear_wait_state(&mut self) {
        let changed = self.is_waiting || self.waiting_keys.iter().any(|&w| w);
        self.is_waiting = false;
        self.waiting_keys = [false; 128];
        self.waiting_keys_hand = [0; 128];
        self.recent_live_hits.fill(-1.0);
        if changed {
            self.wait_state_version += 1;
        }
    }

    pub fn set_study_mode(&mut self, enabled: bool, wait_right: bool, wait_left: bool) {
        self.study_mode = enabled;
        self.study_wait_right = wait_right;
        self.study_wait_left = wait_left;
        if !enabled {
            self.clear_wait_state();
            return;
        }
        if self.is_waiting {
            let mut changed = false;
            for k in 0..128 {
                if self.waiting_keys[k] {
                    let h = self.waiting_keys_hand[k];
                    if (h == 1 && !wait_right) || (h == 2 && !wait_left) {
                        self.waiting_keys[k] = false;
                        self.waiting_keys_hand[k] = 0;
                        changed = true;
                    }
                }
            }
            if !self.waiting_keys.iter().any(|&w| w) {
                self.is_waiting = false;
                changed = true;
            }
            if changed {
                self.wait_state_version += 1;
            }
        }
    }

    pub fn set_study_range(&mut self, skip_out_of_range: bool, min_midi: u8, max_midi: u8) {
        self.study_skip_out_of_range = skip_out_of_range;
        self.study_min_midi = min_midi.min(max_midi);
        self.study_max_midi = max_midi.max(min_midi);

        if self.is_waiting && self.study_skip_out_of_range {
            let mut changed = false;
            for k in 0..128 {
                if self.waiting_keys[k]
                    && ((k as u8) < self.study_min_midi || (k as u8) > self.study_max_midi)
                {
                    self.waiting_keys[k] = false;
                    self.waiting_keys_hand[k] = 0;
                    changed = true;
                }
            }
            if !self.waiting_keys.iter().any(|&w| w) {
                self.is_waiting = false;
                changed = true;
            }
            if changed {
                self.wait_state_version += 1;
            }
        }
    }

    pub fn on_live_note_on(&mut self, key: u8) {
        let idx = key as usize;
        if idx >= 128 {
            return;
        }
        self.recent_live_hits[idx] = self.song_time_sec;
        if self.is_waiting && self.waiting_keys[idx] {
            self.waiting_keys[idx] = false;
            self.waiting_keys_hand[idx] = 0;
            if !self.waiting_keys.iter().any(|&w| w) {
                self.is_waiting = false;
            }
            self.wait_state_version += 1;
        }
    }

    #[inline]
    pub fn apply_transpose(&self, key: u8) -> Option<u8> {
        let shifted = key as i16 + self.transpose_semitones as i16;
        if (21..=108).contains(&shifted) {
            Some(shifted as u8)
        } else {
            None
        }
    }

    pub fn is_required_in_study(&self, key: u8, track_index: u32, default_hand: u8) -> Option<u8> {
        if !self.study_mode || self.preview_bypass_study {
            return None;
        }
        if self.study_skip_out_of_range && (key < self.study_min_midi || key > self.study_max_midi) {
            return None;
        }
        if !self.use_split_point
            && matches!(self.track_hands.get(&track_index), Some(HandRole::None))
        {
            return None;
        }
        let is_right = self.resolve_is_right(key, track_index, default_hand);
        if is_right && self.study_wait_right {
            Some(1)
        } else if !is_right && self.study_wait_left {
            Some(2)
        } else {
            None
        }
    }

    #[inline]
    pub fn is_note_audible(&self, key: u8, track_index: u32, default_hand: u8) -> bool {
        if !self.use_split_point
            && matches!(self.track_hands.get(&track_index), Some(HandRole::None))
        {
            return false;
        }
        let is_right = self.resolve_is_right(key, track_index, default_hand);
        if is_right {
            self.right_hand_enabled
        } else {
            self.left_hand_enabled
        }
    }

    pub fn resolve_is_right(&self, key: u8, track_index: u32, default_hand: u8) -> bool {
        if self.use_split_point {
            return key >= self.split_point_midi;
        }

        match self.track_hands.get(&track_index) {
            Some(HandRole::Right) => true,
            Some(HandRole::Left) => false,
            Some(HandRole::Both) => key >= self.split_point_midi,
            _ => default_hand == 0,
        }
    }

    pub fn render_block(
        &mut self,
        backend: &mut dyn AudioBackend,
        left: &mut [f32],
        right: &mut [f32],
        sample_rate: f64,
    ) {
        if !self.is_playing || self.is_waiting {
            backend.render(left, right);
            self.apply_volume(left, right);
            return;
        }

        let dt_song = (left.len() as f64 / sample_rate) * self.tempo_scale;
        let next_time = self.song_time_sec + dt_song;

        // Dispatch all events up to next_time
        while self.cursor < self.events.len() && self.events[self.cursor].time_sec <= next_time {
            let ev = &self.events[self.cursor];
            match ev.kind {
                SeqEventKind::NoteOn {
                    key: raw_key,
                    velocity,
                    track_index,
                    hand,
                } => {
                    let Some(key) = self.apply_transpose(raw_key) else {
                        self.cursor += 1;
                        continue;
                    };
                    if let Some(_req_hand) = self.is_required_in_study(key, track_index, hand) {
                        let k_idx = key as usize;
                        if k_idx < 128
                            && self.recent_live_hits[k_idx] >= 0.0
                            && (ev.time_sec - self.recent_live_hits[k_idx]).abs()
                                <= EARLY_HIT_WINDOW_SEC
                        {
                            self.recent_live_hits[k_idx] = -1.0;
                            self.cursor += 1;
                            continue;
                        }

                        // Enter Wait State at t_target and group all required NoteOns in [t_target, t_target + CHORD_WINDOW_SEC]
                        let t_target = ev.time_sec;
                        let group_end = t_target + CHORD_WINDOW_SEC;
                        while self.cursor < self.events.len()
                            && self.events[self.cursor].time_sec <= group_end
                        {
                            let g_ev = &self.events[self.cursor];
                            match g_ev.kind {
                                SeqEventKind::NoteOn {
                                    key: raw_gk,
                                    velocity: gvel,
                                    track_index: gtrack,
                                    hand: ghand,
                                } => {
                                    if let Some(gk) = self.apply_transpose(raw_gk) {
                                        if let Some(g_req_hand) =
                                            self.is_required_in_study(gk, gtrack, ghand)
                                        {
                                            let gk_idx = gk as usize;
                                            if gk_idx < 128
                                                && self.recent_live_hits[gk_idx] >= 0.0
                                                && (g_ev.time_sec - self.recent_live_hits[gk_idx])
                                                    .abs()
                                                    <= EARLY_HIT_WINDOW_SEC
                                            {
                                                self.recent_live_hits[gk_idx] = -1.0;
                                            } else if gk_idx < 128 {
                                                self.waiting_keys[gk_idx] = true;
                                                self.waiting_keys_hand[gk_idx] = g_req_hand;
                                            }
                                        } else if self.is_note_audible(gk, gtrack, ghand) {
                                            let shaped_vel = shape_velocity(gvel, self.touch);
                                            backend.note_on(0, gk as i32, shaped_vel as i32);
                                        }
                                    }
                                }
                                SeqEventKind::NoteOff { key: raw_gk, .. } => {
                                    if let Some(gk) = self.apply_transpose(raw_gk) {
                                        backend.note_off(0, gk as i32);
                                    }
                                }
                                SeqEventKind::Sustain { value } => {
                                    backend.control_change(0, 64, value as i32);
                                }
                            }
                            self.cursor += 1;
                        }

                        if self.waiting_keys.iter().any(|&w| w) {
                            self.song_time_sec = t_target;
                            self.is_waiting = true;
                            self.wait_state_version += 1;
                            backend.render(left, right);
                            self.apply_volume(left, right);
                            return;
                        }
                        continue;
                    }

                    if self.is_note_audible(key, track_index, hand) {
                        let shaped_vel = shape_velocity(velocity, self.touch);
                        backend.note_on(0, key as i32, shaped_vel as i32);
                    }
                }
                SeqEventKind::NoteOff { key: raw_key, .. } => {
                    // Always forward note-off to prevent hung notes
                    if let Some(key) = self.apply_transpose(raw_key) {
                        backend.note_off(0, key as i32);
                    }
                }
                SeqEventKind::Sustain { value } => {
                    backend.control_change(0, 64, value as i32);
                }
            }
            self.cursor += 1;
        }

        // Loop boundary check
        if self.loop_enabled {
            let loop_end = self.loop_end_sec.unwrap_or(self.duration_sec);
            let loop_start = self.loop_start_sec.unwrap_or(0.0);
            if next_time >= loop_end && loop_end > loop_start {
                backend.all_notes_off();
                self.song_time_sec = loop_start;
                self.seek(loop_start);
                backend.render(left, right);
                self.apply_volume(left, right);
                return;
            }
        }

        // End of song check
        if next_time >= self.duration_sec && self.duration_sec > 0.0 {
            backend.all_notes_off();
            self.song_time_sec = self.duration_sec;
            self.is_playing = false;
            self.clear_wait_state();
            backend.render(left, right);
            self.apply_volume(left, right);
            return;
        }

        self.song_time_sec = next_time;
        backend.render(left, right);
        self.apply_volume(left, right);
    }

    #[inline]
    fn apply_volume(&self, left: &mut [f32], right: &mut [f32]) {
        for sample in left.iter_mut() {
            *sample *= self.volume;
        }
        for sample in right.iter_mut() {
            *sample *= self.volume;
        }
    }
}

pub fn build_seq_events(parsed: &ParsedSong, _settings: &SongSettings) -> Vec<SeqEvent> {
    let mut events: Vec<SeqEvent> =
        Vec::with_capacity(parsed.notes.len() * 2 + parsed.pedal_events.len());

    for note in &parsed.notes {
        let hand_byte = match note.default_hand {
            HandRole::Right => 0,
            HandRole::Left => 1,
            _ => {
                if note.midi >= 60 {
                    0
                } else {
                    1
                }
            }
        };

        events.push(SeqEvent {
            time_sec: note.start_sec,
            kind: SeqEventKind::NoteOn {
                key: note.midi,
                velocity: note.velocity,
                track_index: note.track_index,
                hand: hand_byte,
            },
        });

        events.push(SeqEvent {
            time_sec: note.start_sec + note.duration_sec,
            kind: SeqEventKind::NoteOff {
                key: note.midi,
                track_index: note.track_index,
                hand: hand_byte,
            },
        });
    }

    for pedal in &parsed.pedal_events {
        events.push(SeqEvent {
            time_sec: pedal.time_sec,
            kind: SeqEventKind::Sustain { value: pedal.value },
        });
    }

    events.sort_by(|a, b| {
        a.time_sec
            .partial_cmp(&b.time_sec)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| match (&a.kind, &b.kind) {
                // Sustain first, then NoteOff, then NoteOn
                (SeqEventKind::Sustain { .. }, _) => std::cmp::Ordering::Less,
                (_, SeqEventKind::Sustain { .. }) => std::cmp::Ordering::Greater,
                (SeqEventKind::NoteOff { .. }, SeqEventKind::NoteOn { .. }) => {
                    std::cmp::Ordering::Less
                }
                (SeqEventKind::NoteOn { .. }, SeqEventKind::NoteOff { .. }) => {
                    std::cmp::Ordering::Greater
                }
                _ => std::cmp::Ordering::Equal,
            })
    });

    events
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockBackend {
        pub notes_on: Vec<(i32, i32, i32)>, // (channel, key, velocity)
        pub notes_off: Vec<(i32, i32)>,
        pub all_notes_off_count: usize,
    }

    impl MockBackend {
        fn new() -> Self {
            Self {
                notes_on: Vec::new(),
                notes_off: Vec::new(),
                all_notes_off_count: 0,
            }
        }
    }

    impl AudioBackend for MockBackend {
        fn note_on(&mut self, channel: i32, key: i32, velocity: i32) {
            self.notes_on.push((channel, key, velocity));
        }

        fn note_off(&mut self, channel: i32, key: i32) {
            self.notes_off.push((channel, key));
        }

        fn control_change(&mut self, _channel: i32, _controller: i32, _value: i32) {}

        fn all_notes_off(&mut self) {
            self.all_notes_off_count += 1;
        }

        fn render(&mut self, _left: &mut [f32], _right: &mut [f32]) {}
    }

    #[test]
    fn test_sequencer_tempo_scaling() {
        let mut seq = Sequencer::new();
        let events = vec![
            SeqEvent {
                time_sec: 1.0,
                kind: SeqEventKind::NoteOn {
                    key: 60,
                    velocity: 100,
                    track_index: 0,
                    hand: 0,
                },
            },
        ];
        seq.events = events;
        seq.duration_sec = 10.0;
        seq.is_playing = true;

        // Sample rate = 1000 Hz, buffer = 500 samples -> real time elapsed = 0.5s
        let mut left = vec![0.0f32; 500];
        let mut right = vec![0.0f32; 500];
        let mut mock = MockBackend::new();

        // 1. With tempo_scale = 1.0, 0.5s elapsed -> song_time = 0.5s -> note at 1.0s should NOT trigger
        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);
        assert_eq!(seq.song_time_sec, 0.5);
        assert!(mock.notes_on.is_empty());

        // 2. Change tempo_scale to 2.0x -> another 0.5s buffer advances song by 0.5 * 2.0 = 1.0s -> song_time = 1.5s
        seq.tempo_scale = 2.0;
        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);
        assert_eq!(seq.song_time_sec, 1.5);
        assert_eq!(mock.notes_on.len(), 1);
        assert_eq!(mock.notes_on[0].1, 60);
    }

    #[test]
    fn test_sequencer_hand_mute_filtering() {
        let mut seq = Sequencer::new();
        let events = vec![
            SeqEvent {
                time_sec: 0.1,
                kind: SeqEventKind::NoteOn {
                    key: 72, // Right hand
                    velocity: 100,
                    track_index: 0,
                    hand: 0,
                },
            },
            SeqEvent {
                time_sec: 0.2,
                kind: SeqEventKind::NoteOn {
                    key: 48, // Left hand
                    velocity: 90,
                    track_index: 1,
                    hand: 1,
                },
            },
        ];
        seq.events = events;
        seq.duration_sec = 5.0;
        seq.is_playing = true;

        // Mute right hand (hand 0)
        seq.right_hand_enabled = false;
        seq.left_hand_enabled = true;

        let mut left = vec![0.0f32; 1000];
        let mut right = vec![0.0f32; 1000];
        let mut mock = MockBackend::new();

        // Render 1.0s (all events pass)
        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);

        // Right hand note (72) should have been filtered out, only Left hand note (48) played
        assert_eq!(mock.notes_on.len(), 1);
        assert_eq!(mock.notes_on[0].1, 48);
    }

    #[test]
    fn test_sequencer_ab_loop_wrap() {
        let mut seq = Sequencer::new();
        seq.events = vec![];
        seq.duration_sec = 10.0;
        seq.is_playing = true;
        seq.loop_enabled = true;
        seq.loop_start_sec = Some(2.0);
        seq.loop_end_sec = Some(4.0);
        seq.song_time_sec = 3.8;

        let mut left = vec![0.0f32; 500]; // 0.5s at 1000Hz -> would reach 4.3s (> 4.0s loop_end)
        let mut right = vec![0.0f32; 500];
        let mut mock = MockBackend::new();

        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);

        // Should wrap to loop_start (2.0) and call all_notes_off
        assert_eq!(seq.song_time_sec, 2.0);
        assert!(mock.all_notes_off_count >= 1);
    }

    #[test]
    fn test_study_mode_single_note_wait_and_resume() {
        let mut seq = Sequencer::new();
        seq.events = vec![SeqEvent {
            time_sec: 0.5,
            kind: SeqEventKind::NoteOn {
                key: 60,
                velocity: 100,
                track_index: 0,
                hand: 0,
            },
        }];
        seq.duration_sec = 5.0;
        seq.is_playing = true;
        seq.set_study_mode(true, true, true);

        let mut left = vec![0.0f32; 1000]; // 1.0s at 1000Hz
        let mut right = vec![0.0f32; 1000];
        let mut mock = MockBackend::new();

        // Crosses t=0.5s -> freezes at t_target=0.5s without triggering sequencer NoteOn
        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);
        assert!(seq.is_waiting);
        assert_eq!(seq.song_time_sec, 0.5);
        assert!(seq.waiting_keys[60]);
        assert!(mock.notes_on.is_empty());

        // Subsequent block while waiting stays frozen at 0.5s
        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);
        assert!(seq.is_waiting);
        assert_eq!(seq.song_time_sec, 0.5);

        // User plays key 60 -> unblocks immediately
        seq.on_live_note_on(60);
        assert!(!seq.is_waiting);
        assert!(!seq.waiting_keys[60]);

        // Next block advances past 0.5s
        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);
        assert_eq!(seq.song_time_sec, 1.5);
    }

    #[test]
    fn test_study_mode_chord_grouping() {
        let mut seq = Sequencer::new();
        seq.events = vec![
            SeqEvent {
                time_sec: 0.50,
                kind: SeqEventKind::NoteOn {
                    key: 60,
                    velocity: 100,
                    track_index: 0,
                    hand: 0,
                },
            },
            SeqEvent {
                time_sec: 0.52,
                kind: SeqEventKind::NoteOn {
                    key: 64,
                    velocity: 100,
                    track_index: 0,
                    hand: 0,
                },
            },
            SeqEvent {
                time_sec: 0.54,
                kind: SeqEventKind::NoteOn {
                    key: 67,
                    velocity: 100,
                    track_index: 0,
                    hand: 0,
                },
            },
        ];
        seq.duration_sec = 5.0;
        seq.is_playing = true;
        seq.set_study_mode(true, true, true);

        let mut left = vec![0.0f32; 1000];
        let mut right = vec![0.0f32; 1000];
        let mut mock = MockBackend::new();

        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);
        assert!(seq.is_waiting);
        assert_eq!(seq.song_time_sec, 0.50);
        assert!(seq.waiting_keys[60] && seq.waiting_keys[64] && seq.waiting_keys[67]);

        seq.on_live_note_on(60);
        seq.on_live_note_on(64);
        assert!(seq.is_waiting);

        seq.on_live_note_on(67);
        assert!(!seq.is_waiting);
    }

    #[test]
    fn test_study_mode_right_only_ignores_left_hand() {
        let mut seq = Sequencer::new();
        seq.events = vec![
            SeqEvent {
                time_sec: 0.2,
                kind: SeqEventKind::NoteOn {
                    key: 48, // Left hand
                    velocity: 90,
                    track_index: 1,
                    hand: 1,
                },
            },
            SeqEvent {
                time_sec: 0.8,
                kind: SeqEventKind::NoteOn {
                    key: 72, // Right hand
                    velocity: 100,
                    track_index: 0,
                    hand: 0,
                },
            },
        ];
        seq.duration_sec = 5.0;
        seq.is_playing = true;
        seq.set_study_mode(true, true, false); // Right-only

        let mut left = vec![0.0f32; 500]; // 0.5s at 1000Hz
        let mut right = vec![0.0f32; 500];
        let mut mock = MockBackend::new();

        // First 0.5s: Left-hand note at 0.2s plays freely without pausing
        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);
        assert!(!seq.is_waiting);
        assert_eq!(seq.song_time_sec, 0.5);
        assert_eq!(mock.notes_on.len(), 1);
        assert_eq!(mock.notes_on[0].1, 48);

        // Next 0.5s (0.5 -> 1.0): Right-hand note at 0.8s pauses at 0.8s
        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);
        assert!(seq.is_waiting);
        assert_eq!(seq.song_time_sec, 0.8);
        assert!(seq.waiting_keys[72]);
    }

    #[test]
    fn test_study_mode_early_hit_forgiveness() {
        let mut seq = Sequencer::new();
        seq.events = vec![SeqEvent {
            time_sec: 0.5,
            kind: SeqEventKind::NoteOn {
                key: 60,
                velocity: 100,
                track_index: 0,
                hand: 0,
            },
        }];
        seq.duration_sec = 5.0;
        seq.is_playing = true;
        seq.set_study_mode(true, true, true);
        seq.song_time_sec = 0.42; // 80ms before 0.5s

        // Player hits key 60 80ms early (within 150ms forgiveness window)
        seq.on_live_note_on(60);

        let mut left = vec![0.0f32; 500]; // advances 0.5s -> 0.92s
        let mut right = vec![0.0f32; 500];
        let mut mock = MockBackend::new();

        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);
        assert!(!seq.is_waiting);
        assert!((seq.song_time_sec - 0.92).abs() < 1e-6);
        assert!(mock.notes_on.is_empty()); // No double-triggering
    }

    #[test]
    fn test_study_mode_disable_or_hand_switch_unblocks() {
        let mut seq = Sequencer::new();
        seq.events = vec![SeqEvent {
            time_sec: 0.2,
            kind: SeqEventKind::NoteOn {
                key: 48, // Left hand
                velocity: 90,
                track_index: 1,
                hand: 1,
            },
        }];
        seq.duration_sec = 5.0;
        seq.is_playing = true;
        seq.set_study_mode(true, true, true);

        let mut left = vec![0.0f32; 500];
        let mut right = vec![0.0f32; 500];
        let mut mock = MockBackend::new();

        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);
        assert!(seq.is_waiting);
        assert!(seq.waiting_keys[48]);

        // Switching to Right-Only drops the Left-hand wait immediately
        seq.set_study_mode(true, true, false);
        assert!(!seq.is_waiting);
        assert!(!seq.waiting_keys[48]);

        // Re-wait and test turning study mode off
        seq.seek(0.0);
        seq.set_study_mode(true, true, true);
        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);
        assert!(seq.is_waiting);
        seq.set_study_mode(false, true, true);
        assert!(!seq.is_waiting);
    }

    #[test]
    fn test_study_mode_skips_out_of_range_notes() {
        let mut seq = Sequencer::new();
        seq.events = vec![
            SeqEvent {
                time_sec: 0.1,
                kind: SeqEventKind::NoteOn {
                    key: 48, // Out of range (below 53)
                    velocity: 90,
                    track_index: 1,
                    hand: 1,
                },
            },
            SeqEvent {
                time_sec: 0.3,
                kind: SeqEventKind::NoteOn {
                    key: 60, // Inside 53..=84
                    velocity: 100,
                    track_index: 0,
                    hand: 0,
                },
            },
        ];
        seq.duration_sec = 5.0;
        seq.is_playing = true;
        seq.set_study_mode(true, true, true);
        seq.set_study_range(true, 53, 84);

        let mut left = vec![0.0f32; 200]; // 0.0 -> 0.2s
        let mut right = vec![0.0f32; 200];
        let mut mock = MockBackend::new();

        // Note 48 should play automatically without freezing Study Mode
        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);
        assert!(!seq.is_waiting);
        assert_eq!(mock.notes_on.len(), 1);
        assert_eq!(mock.notes_on[0].1, 48);

        // Advance past 0.3s -> Note 60 is inside range, so Study Mode freezes
        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);
        assert!(seq.is_waiting);
        assert!(seq.waiting_keys[60]);

        // Pressing 60 unblocks
        seq.on_live_note_on(60);
        assert!(!seq.is_waiting);
    }

    #[test]
    fn test_study_mode_range_update_unblocks_waiting_key() {
        let mut seq = Sequencer::new();
        seq.events = vec![SeqEvent {
            time_sec: 0.2,
            kind: SeqEventKind::NoteOn {
                key: 48,
                velocity: 90,
                track_index: 1,
                hand: 1,
            },
        }];
        seq.duration_sec = 5.0;
        seq.is_playing = true;
        seq.set_study_mode(true, true, true);
        seq.set_study_range(false, 53, 84);

        let mut left = vec![0.0f32; 500];
        let mut right = vec![0.0f32; 500];
        let mut mock = MockBackend::new();

        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);
        assert!(seq.is_waiting);
        assert!(seq.waiting_keys[48]);

        seq.set_study_range(true, 53, 84);
        assert!(!seq.is_waiting);
        assert!(!seq.waiting_keys[48]);
    }

    #[test]
    fn test_sequencer_transpose_audio_and_study_mode() {
        let mut seq = Sequencer::new();
        seq.events = vec![
            SeqEvent {
                time_sec: 0.1,
                kind: SeqEventKind::NoteOn {
                    key: 108, // 108 + 2 = 110 -> out of 21..=108, must be skipped cleanly
                    velocity: 90,
                    track_index: 0,
                    hand: 0,
                },
            },
            SeqEvent {
                time_sec: 0.2,
                kind: SeqEventKind::NoteOn {
                    key: 60, // 60 + 2 = 62
                    velocity: 100,
                    track_index: 0,
                    hand: 0,
                },
            },
        ];
        seq.duration_sec = 5.0;
        seq.is_playing = true;
        seq.transpose_semitones = 2;

        // First verify audio playback without Study Mode plays key 62 and skips 108
        let mut left = vec![0.0f32; 300];
        let mut right = vec![0.0f32; 300];
        let mut mock = MockBackend::new();
        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);
        assert_eq!(mock.notes_on.len(), 1);
        assert_eq!(mock.notes_on[0].1, 62);

        // Now verify Study Mode waits on transposed key 62
        seq.seek(0.0);
        seq.set_study_mode(true, true, true);
        mock.notes_on.clear();
        seq.render_block(&mut mock, &mut left, &mut right, 1000.0);
        assert!(seq.is_waiting);
        assert!(seq.waiting_keys[62]);
        assert!(!seq.waiting_keys[60]);

        seq.on_live_note_on(62);
        assert!(!seq.is_waiting);
    }
}
