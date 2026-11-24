use std::collections::HashMap;
use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HandRole {
    Right,
    Left,
    Both,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiNote {
    pub id: u32,
    pub midi: u8,
    pub start_sec: f64,
    pub duration_sec: f64,
    pub velocity: u8,
    pub track_index: u32,
    pub channel: u8,
    pub default_hand: HandRole,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiTrackInfo {
    pub track_index: u32,
    pub name: String,
    pub note_count: u32,
    pub avg_pitch: f64,
    pub default_hand: HandRole,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PedalEvent {
    pub time_sec: f64,
    pub value: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeSignatureEvent {
    pub time_sec: f64,
    pub numerator: u8,
    pub denominator: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedSong {
    pub content_hash: String,
    pub file_path: String,
    pub title: String,
    pub duration_sec: f64,
    pub initial_bpm: f64,
    pub tracks: Vec<MidiTrackInfo>,
    pub notes: Vec<MidiNote>,
    pub pedal_events: Vec<PedalEvent>,
    pub time_signatures: Vec<TimeSignatureEvent>,
    pub measure_times_sec: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongSummary {
    pub content_hash: String,
    pub relative_path: String,
    pub file_path: String,
    pub title: String,
    pub folder: String,
    pub duration_sec: f64,
    pub initial_bpm: f64,
    pub track_count: u32,
    pub is_favorite: bool,
    pub last_played_at: Option<i64>,
    pub added_at: i64,
    pub peak_start_sec: f64,
    pub preview_peak_json: String,
    pub preview_start_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongSettings {
    pub content_hash: String,
    pub track_hands: HashMap<u32, HandRole>,
    pub split_point_midi: u8,
    pub use_split_point: bool,
    pub tempo_scale: f64,
    pub loop_enabled: bool,
    pub loop_start_sec: Option<f64>,
    pub loop_end_sec: Option<f64>,
    #[serde(default)]
    pub transpose_semitones: i8,
}

impl Default for SongSettings {
    fn default() -> Self {
        Self {
            content_hash: String::new(),
            track_hands: HashMap::new(),
            split_point_midi: 60,
            use_split_point: false,
            tempo_scale: 1.0,
            loop_enabled: false,
            loop_start_sec: None,
            loop_end_sec: None,
            transpose_semitones: 0,
        }
    }
}

#[derive(Debug, Clone)]
struct TempoPoint {
    tick: u64,
    time_sec: f64,
    us_per_beat: u32,
}

pub struct TempoMap {
    ticks_per_beat: f64,
    points: Vec<TempoPoint>,
}

impl TempoMap {
    pub fn new(ticks_per_beat: f64, mut raw_tempos: Vec<(u64, u32)>) -> Self {
        raw_tempos.sort_by_key(|&(tick, _)| tick);

        // Deduplicate events at the same tick, keeping the last one
        let mut deduped: Vec<(u64, u32)> = Vec::new();
        for (tick, us) in raw_tempos {
            if let Some(last) = deduped.last_mut() {
                if last.0 == tick {
                    last.1 = us;
                    continue;
                }
            }
            deduped.push((tick, us));
        }

        // Ensure tick 0 exists (default 120 BPM: 500_000 us)
        if deduped.is_empty() || deduped[0].0 != 0 {
            deduped.insert(0, (0, 500_000));
        }

        let mut points = Vec::with_capacity(deduped.len());
        let mut current_sec = 0.0;
        let mut prev_tick = 0u64;
        let mut prev_us = deduped[0].1;

        for (tick, us) in deduped {
            if tick > prev_tick {
                let dticks = (tick - prev_tick) as f64;
                current_sec += (dticks / ticks_per_beat) * (prev_us as f64 / 1_000_000.0);
            }
            points.push(TempoPoint {
                tick,
                time_sec: current_sec,
                us_per_beat: us,
            });
            prev_tick = tick;
            prev_us = us;
        }

        Self {
            ticks_per_beat,
            points,
        }
    }

    pub fn tick_to_sec(&self, tick: u64) -> f64 {
        // Binary search for the active tempo segment
        let idx = match self.points.binary_search_by_key(&tick, |p| p.tick) {
            Ok(exact) => exact,
            Err(insertion_point) => {
                if insertion_point == 0 {
                    0
                } else {
                    insertion_point - 1
                }
            }
        };

        let p = &self.points[idx];
        let dticks = (tick - p.tick) as f64;
        p.time_sec + (dticks / self.ticks_per_beat) * (p.us_per_beat as f64 / 1_000_000.0)
    }

    pub fn initial_bpm(&self) -> f64 {
        if let Some(p) = self.points.first() {
            if p.us_per_beat > 0 {
                return 60_000_000.0 / p.us_per_beat as f64;
            }
        }
        120.0
    }

    pub fn dominant_bpm(&self, total_duration_sec: f64) -> f64 {
        if self.points.is_empty() {
            return 120.0;
        }

        let mut bpm_duration: std::collections::HashMap<u32, f64> = std::collections::HashMap::new();

        for i in 0..self.points.len() {
            let p = &self.points[i];
            let seg_start = p.time_sec;
            let seg_end = if i + 1 < self.points.len() {
                self.points[i + 1].time_sec
            } else {
                total_duration_sec.max(seg_start)
            };

            let seg_dur = (seg_end - seg_start).max(0.0);
            if p.us_per_beat > 0 {
                let bpm = 60_000_000.0 / p.us_per_beat as f64;
                if (20.0..=300.0).contains(&bpm) {
                    let rounded = bpm.round() as u32;
                    *bpm_duration.entry(rounded).or_insert(0.0) += seg_dur;
                }
            }
        }

        if let Some((&best_bpm, _)) = bpm_duration
            .iter()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
        {
            return best_bpm as f64;
        }

        let initial = self.initial_bpm();
        if (20.0..=300.0).contains(&initial) {
            initial.round()
        } else {
            120.0
        }
    }
}

pub fn parse_midi_file(path: &Path) -> Result<ParsedSong, String> {
    let bytes = std::fs::read(path)
        .map_err(|e| format!("Failed to read MIDI file {:?}: {}", path, e))?;
    let file_path = path.to_string_lossy().to_string();
    let title_fallback = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".to_string());

    parse_midi_bytes(&bytes, &file_path, &title_fallback)
}

pub fn parse_midi_bytes(
    bytes: &[u8],
    file_path: &str,
    title_fallback: &str,
) -> Result<ParsedSong, String> {
    let content_hash = blake3::hash(bytes).to_hex().to_string();
    let smf = midly::Smf::parse(bytes)
        .map_err(|e| format!("MIDI parse error: {:?}", e))?;

    let ticks_per_beat = match smf.header.timing {
        midly::Timing::Metrical(tpb) => tpb.as_int() as f64,
        midly::Timing::Timecode(fps, subframe) => (fps.as_int() as f64) * (subframe as f64),
    };

    if ticks_per_beat <= 0.0 {
        return Err("Invalid ticks_per_beat in MIDI header".to_string());
    }

    // Pass 1: Collect tempo events, time signatures & song title
    let mut raw_tempos: Vec<(u64, u32)> = Vec::new();
    let mut raw_time_sigs: Vec<(u64, u8, u8)> = Vec::new();
    let mut song_title: Option<String> = None;

    for track in &smf.tracks {
        let mut abs_tick = 0u64;
        for event in track {
            abs_tick += event.delta.as_int() as u64;
            if let midly::TrackEventKind::Meta(meta) = event.kind {
                match meta {
                    midly::MetaMessage::Tempo(us) => {
                        raw_tempos.push((abs_tick, us.as_int()));
                    }
                    midly::MetaMessage::TimeSignature(num, den_pow, _, _) => {
                        let den = 2u32.pow((den_pow as u32).min(7)).clamp(1, 128) as u8;
                        raw_time_sigs.push((abs_tick, num.max(1), den));
                    }
                    midly::MetaMessage::TrackName(b) => {
                        if song_title.is_none() {
                            let text = String::from_utf8_lossy(b).trim().to_string();
                            if !text.is_empty() && text.to_lowercase() != "untitled" {
                                song_title = Some(text);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    let tempo_map = TempoMap::new(ticks_per_beat, raw_tempos);

    // Prefer clean file name as the title, as MIDI TrackName events almost always contain instrument names (e.g. "Acoustic Grand Piano")
    let final_title = if !title_fallback.trim().is_empty() {
        title_fallback.to_string()
    } else {
        song_title.unwrap_or_else(|| "Untitled".to_string())
    };

    // Pass 2: Extract notes and pedal events per track
    struct RawNote {
        midi: u8,
        start_sec: f64,
        duration_sec: f64,
        velocity: u8,
        track_index: u32,
        channel: u8,
    }

    let mut raw_notes: Vec<RawNote> = Vec::new();
    let mut pedal_events: Vec<PedalEvent> = Vec::new();
    let mut track_infos: Vec<MidiTrackInfo> = Vec::new();
    let mut max_song_tick: u64 = 0;

    for (track_idx, track) in smf.tracks.iter().enumerate() {
        let mut track_name = format!("Track {}", track_idx + 1);
        let mut open_notes: HashMap<(u8, u8), Vec<(u64, u8)>> = HashMap::new(); // (ch, key) -> Vec<(start_tick, vel)>
        let mut abs_tick = 0u64;
        let mut track_pitch_sum = 0u64;
        let mut track_note_count = 0u32;

        for event in track {
            abs_tick += event.delta.as_int() as u64;
            match event.kind {
                midly::TrackEventKind::Meta(midly::MetaMessage::TrackName(b)) => {
                    let name = String::from_utf8_lossy(b).trim().to_string();
                    if !name.is_empty() {
                        track_name = name;
                    }
                }
                midly::TrackEventKind::Midi { channel, message } => {
                    let ch = channel.as_int();
                    // Channel 9 is standard GM percussion
                    if ch == 9 {
                        continue;
                    }
                    match message {
                        midly::MidiMessage::NoteOn { key, vel } => {
                            let k = key.as_int();
                            let v = vel.as_int();
                            // Filter to 88-key piano range: 21 (A0) .. 108 (C8)
                            if (21..=108).contains(&k) {
                                if v > 0 {
                                    open_notes.entry((ch, k)).or_default().push((abs_tick, v));
                                } else if let Some(starts) = open_notes.get_mut(&(ch, k)) {
                                    if let Some((start_tick, start_vel)) = starts.pop() {
                                        let start_sec = tempo_map.tick_to_sec(start_tick);
                                        let end_sec = tempo_map.tick_to_sec(abs_tick);
                                        max_song_tick = max_song_tick.max(abs_tick);
                                        let duration_sec = (end_sec - start_sec).max(0.04);
                                        raw_notes.push(RawNote {
                                            midi: k,
                                            start_sec,
                                            duration_sec,
                                            velocity: start_vel,
                                            track_index: track_idx as u32,
                                            channel: ch,
                                        });
                                        track_pitch_sum += k as u64;
                                        track_note_count += 1;
                                    }
                                }
                            }
                        }
                        midly::MidiMessage::NoteOff { key, .. } => {
                            let k = key.as_int();
                            if let Some(starts) = open_notes.get_mut(&(ch, k)) {
                                if let Some((start_tick, start_vel)) = starts.pop() {
                                    let start_sec = tempo_map.tick_to_sec(start_tick);
                                    let end_sec = tempo_map.tick_to_sec(abs_tick);
                                    max_song_tick = max_song_tick.max(abs_tick);
                                    let duration_sec = (end_sec - start_sec).max(0.04);
                                    raw_notes.push(RawNote {
                                        midi: k,
                                        start_sec,
                                        duration_sec,
                                        velocity: start_vel,
                                        track_index: track_idx as u32,
                                        channel: ch,
                                    });
                                    track_pitch_sum += k as u64;
                                    track_note_count += 1;
                                }
                            }
                        }
                        midly::MidiMessage::Controller { controller, value } => {
                            if controller.as_int() == 64 {
                                max_song_tick = max_song_tick.max(abs_tick);
                                pedal_events.push(PedalEvent {
                                    time_sec: tempo_map.tick_to_sec(abs_tick),
                                    value: value.as_int(),
                                });
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }

        // Close dangling open notes
        for ((ch, k), starts) in open_notes {
            for (start_tick, start_vel) in starts {
                let start_sec = tempo_map.tick_to_sec(start_tick);
                let end_sec = tempo_map.tick_to_sec(abs_tick);
                max_song_tick = max_song_tick.max(abs_tick);
                let duration_sec = (end_sec - start_sec).max(0.04);
                raw_notes.push(RawNote {
                    midi: k,
                    start_sec,
                    duration_sec,
                    velocity: start_vel,
                    track_index: track_idx as u32,
                    channel: ch,
                });
                track_pitch_sum += k as u64;
                track_note_count += 1;
            }
        }

        let avg_pitch = if track_note_count > 0 {
            track_pitch_sum as f64 / track_note_count as f64
        } else {
            0.0
        };

        track_infos.push(MidiTrackInfo {
            track_index: track_idx as u32,
            name: track_name,
            note_count: track_note_count,
            avg_pitch,
            default_hand: HandRole::Both,
        });
    }

    // Smart default hand assignments
    let pitched_tracks: Vec<usize> = track_infos
        .iter()
        .enumerate()
        .filter(|(_, t)| t.note_count > 0)
        .map(|(i, _)| i)
        .collect();

    let mut track_hand_mapping: HashMap<u32, HandRole> = HashMap::new();

    if pitched_tracks.len() == 2 {
        let t1_idx = pitched_tracks[0];
        let t2_idx = pitched_tracks[1];
        if track_infos[t1_idx].avg_pitch >= track_infos[t2_idx].avg_pitch {
            track_infos[t1_idx].default_hand = HandRole::Right;
            track_infos[t2_idx].default_hand = HandRole::Left;
            track_hand_mapping.insert(track_infos[t1_idx].track_index, HandRole::Right);
            track_hand_mapping.insert(track_infos[t2_idx].track_index, HandRole::Left);
        } else {
            track_infos[t1_idx].default_hand = HandRole::Left;
            track_infos[t2_idx].default_hand = HandRole::Right;
            track_hand_mapping.insert(track_infos[t1_idx].track_index, HandRole::Left);
            track_hand_mapping.insert(track_infos[t2_idx].track_index, HandRole::Right);
        }
    } else {
        // 1 pitched track or 3+ tracks: each track is "both"
        for &idx in &pitched_tracks {
            track_infos[idx].default_hand = HandRole::Both;
            track_hand_mapping.insert(track_infos[idx].track_index, HandRole::Both);
        }
    }

    // Sort notes by start_sec, then midi pitch
    raw_notes.sort_by(|a, b| {
        a.start_sec
            .partial_cmp(&b.start_sec)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.midi.cmp(&b.midi))
    });

    let mut max_end_sec = 0.0f64;
    let mut final_notes: Vec<MidiNote> = Vec::with_capacity(raw_notes.len());

    for (i, rn) in raw_notes.into_iter().enumerate() {
        let end_sec = rn.start_sec + rn.duration_sec;
        if end_sec > max_end_sec {
            max_end_sec = end_sec;
        }

        let default_hand = match track_hand_mapping.get(&rn.track_index) {
            Some(HandRole::Right) => HandRole::Right,
            Some(HandRole::Left) => HandRole::Left,
            _ => {
                // Pitch split: 60 (C4) and above = right, below = left
                if rn.midi >= 60 {
                    HandRole::Right
                } else {
                    HandRole::Left
                }
            }
        };

        final_notes.push(MidiNote {
            id: (i + 1) as u32,
            midi: rn.midi,
            start_sec: rn.start_sec,
            duration_sec: rn.duration_sec,
            velocity: rn.velocity,
            track_index: rn.track_index,
            channel: rn.channel,
            default_hand,
        });
    }

    pedal_events.sort_by(|a, b| {
        a.time_sec
            .partial_cmp(&b.time_sec)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    if let Some(last_pedal) = pedal_events.last() {
        if last_pedal.time_sec > max_end_sec {
            max_end_sec = last_pedal.time_sec;
        }
    }

    let duration_sec = max_end_sec.max(1.0);
    let initial_bpm = tempo_map.dominant_bpm(duration_sec);

    // Build deduplicated time signatures and exact measure timestamps
    raw_time_sigs.sort_by_key(|&(tick, _, _)| tick);
    let mut deduped_ts: Vec<(u64, u8, u8)> = Vec::new();
    for (tick, num, den) in raw_time_sigs {
        if let Some(last) = deduped_ts.last_mut() {
            if last.0 == tick {
                last.1 = num;
                last.2 = den;
                continue;
            }
        }
        deduped_ts.push((tick, num, den));
    }
    if deduped_ts.is_empty() || deduped_ts[0].0 != 0 {
        deduped_ts.insert(0, (0, 4, 4));
    }

    let time_signatures: Vec<TimeSignatureEvent> = deduped_ts
        .iter()
        .map(|&(tick, numerator, denominator)| TimeSignatureEvent {
            time_sec: tempo_map.tick_to_sec(tick),
            numerator,
            denominator,
        })
        .collect();

    let mut measure_times_sec: Vec<f64> = Vec::new();
    const MAX_MEASURES: usize = 20_000;
    for i in 0..deduped_ts.len() {
        let (seg_start_tick, num, den) = deduped_ts[i];
        if seg_start_tick > max_song_tick {
            break;
        }
        let next_seg_tick = if i + 1 < deduped_ts.len() {
            deduped_ts[i + 1].0.min(max_song_tick + 1)
        } else {
            max_song_tick + 1
        };
        let measure_ticks =
            (ticks_per_beat * (num.max(1) as f64) * (4.0 / (den.max(1) as f64))).max(1.0);
        let mut cur_tick = seg_start_tick as f64;
        while (cur_tick.round() as u64) < next_seg_tick && measure_times_sec.len() < MAX_MEASURES {
            measure_times_sec.push(tempo_map.tick_to_sec(cur_tick.round() as u64));
            cur_tick += measure_ticks;
        }
        if measure_times_sec.len() >= MAX_MEASURES {
            break;
        }
    }

    Ok(ParsedSong {
        content_hash,
        file_path: file_path.to_string(),
        title: final_title,
        duration_sec,
        initial_bpm,
        tracks: track_infos,
        notes: final_notes,
        pedal_events,
        time_signatures,
        measure_times_sec,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tempo_map_piecewise_linear() {
        // 480 ticks per beat
        // tick 0: 500_000 us (120 bpm) -> 1 beat = 0.5s -> 1 tick = 0.5 / 480 s
        // tick 480: 250_000 us (240 bpm) -> 1 beat = 0.25s -> 1 tick = 0.25 / 480 s
        let raw = vec![(0, 500_000), (480, 250_000)];
        let tm = TempoMap::new(480.0, raw);

        assert!((tm.initial_bpm() - 120.0).abs() < 1e-4);
        assert!((tm.tick_to_sec(0) - 0.0).abs() < 1e-6);
        assert!((tm.tick_to_sec(480) - 0.5).abs() < 1e-6);
        // At tick 960 (480 ticks after tick 480 at 240bpm), time should be 0.5 + 0.25 = 0.75s
        assert!((tm.tick_to_sec(960) - 0.75).abs() < 1e-6);
    }

    #[test]
    fn test_in_memory_smf_parsing_and_hand_assignment() {
        use midly::{
            Header, Format, Timing, TrackEvent, TrackEventKind, MetaMessage, MidiMessage,
            num::{u4, u7, u15, u24, u28},
        };

        // Create SMF with 2 tracks:
        // Track 0: Tempo change at delta 0 (120 bpm = 500_000us) and note C5 (72, right hand range)
        // Track 1: Note C3 (48, left hand range)
        let header = Header::new(Format::Parallel, Timing::Metrical(u15::from(480)));

        let track0 = vec![
            TrackEvent {
                delta: u28::from(0),
                kind: TrackEventKind::Meta(MetaMessage::Tempo(u24::from(500_000))),
            },
            TrackEvent {
                delta: u28::from(0),
                kind: TrackEventKind::Midi {
                    channel: u4::from(0),
                    message: MidiMessage::NoteOn {
                        key: u7::from(72), // C5
                        vel: u7::from(100),
                    },
                },
            },
            TrackEvent {
                delta: u28::from(480), // 1 beat later = 0.5s
                kind: TrackEventKind::Midi {
                    channel: u4::from(0),
                    message: MidiMessage::NoteOff {
                        key: u7::from(72),
                        vel: u7::from(0),
                    },
                },
            },
        ];

        let track1 = vec![
            TrackEvent {
                delta: u28::from(0),
                kind: TrackEventKind::Midi {
                    channel: u4::from(1),
                    message: MidiMessage::NoteOn {
                        key: u7::from(48), // C3
                        vel: u7::from(90),
                    },
                },
            },
            TrackEvent {
                delta: u28::from(960), // 2 beats later = 1.0s
                kind: TrackEventKind::Midi {
                    channel: u4::from(1),
                    message: MidiMessage::NoteOff {
                        key: u7::from(48),
                        vel: u7::from(0),
                    },
                },
            },
        ];

        let mut smf_bytes = Vec::new();
        let smf = midly::Smf {
            header,
            tracks: vec![track0, track1],
        };
        smf.write(&mut smf_bytes).expect("Failed to serialize test SMF");

        let parsed = parse_midi_bytes(&smf_bytes, "/test/song.mid", "Test Song")
            .expect("Failed to parse test song");

        assert_eq!(parsed.title, "Test Song");
        assert_eq!(parsed.initial_bpm, 120.0);
        assert_eq!(parsed.notes.len(), 2);
        assert!((parsed.duration_sec - 1.0).abs() < 1e-4);

        // Track 0 has pitch 72 (higher) -> Right hand
        // Track 1 has pitch 48 (lower) -> Left hand
        assert_eq!(parsed.tracks[0].default_hand, HandRole::Right);
        assert_eq!(parsed.tracks[1].default_hand, HandRole::Left);

        let note_c5 = parsed.notes.iter().find(|n| n.midi == 72).unwrap();
        assert_eq!(note_c5.default_hand, HandRole::Right);
        assert!((note_c5.start_sec - 0.0).abs() < 1e-6);
        assert!((note_c5.duration_sec - 0.5).abs() < 1e-4);

        let note_c3 = parsed.notes.iter().find(|n| n.midi == 48).unwrap();
        assert_eq!(note_c3.default_hand, HandRole::Left);
        assert!((note_c3.start_sec - 0.0).abs() < 1e-6);
        assert!((note_c3.duration_sec - 1.0).abs() < 1e-4);
    }

    #[test]
    fn test_dominant_bpm_ignores_tick_0_spike() {
        // 750 BPM = 60_000_000 / 750 = 80_000 us_per_beat
        // 128 BPM = 60_000_000 / 128 = 468_750 us_per_beat
        // 480 ticks_per_beat: at 750 BPM, 1 beat = 0.08s. For ~0.05s, 300 ticks = 0.05s
        let raw_tempos = vec![
            (0, 80_000),      // 750 BPM spike at tick 0 lasting ~0.05s
            (300, 468_750),   // 128 BPM from tick 300 onward
        ];
        let tm = TempoMap::new(480.0, raw_tempos);
        // Total song duration = 10.05s, dominated by 128 BPM (10s)
        let dominant = tm.dominant_bpm(10.05);
        assert_eq!(dominant, 128.0);
    }

    #[test]
    fn test_measure_times_default_4_4() {
        use midly::num::{u15, u28, u4, u7};
        use midly::{Format, Header, MidiMessage, Timing, TrackEvent, TrackEventKind};

        let header = Header {
            format: Format::Parallel,
            timing: Timing::Metrical(u15::from(480)),
        };

        // No TimeSignature event -> defaults to 4/4 at 120 BPM (2.0s per bar).
        // Note spans 0..=3840 ticks (0.0s..=4.0s).
        let track0 = vec![
            TrackEvent {
                delta: u28::from(0),
                kind: TrackEventKind::Midi {
                    channel: u4::from(0),
                    message: MidiMessage::NoteOn {
                        key: u7::from(60),
                        vel: u7::from(100),
                    },
                },
            },
            TrackEvent {
                delta: u28::from(3840),
                kind: TrackEventKind::Midi {
                    channel: u4::from(0),
                    message: MidiMessage::NoteOff {
                        key: u7::from(60),
                        vel: u7::from(0),
                    },
                },
            },
        ];

        let mut smf_bytes = Vec::new();
        let smf = midly::Smf {
            header,
            tracks: vec![track0],
        };
        smf.write(&mut smf_bytes).unwrap();

        let parsed = parse_midi_bytes(&smf_bytes, "/test/4_4.mid", "4_4").unwrap();
        assert_eq!(parsed.time_signatures.len(), 1);
        assert_eq!(parsed.time_signatures[0].numerator, 4);
        assert_eq!(parsed.time_signatures[0].denominator, 4);
        assert_eq!(parsed.measure_times_sec.len(), 3);
        assert!((parsed.measure_times_sec[0] - 0.0).abs() < 1e-6);
        assert!((parsed.measure_times_sec[1] - 2.0).abs() < 1e-6);
        assert!((parsed.measure_times_sec[2] - 4.0).abs() < 1e-6);
    }

    #[test]
    fn test_measure_times_3_4_and_tempo_change() {
        use midly::num::{u15, u24, u28, u4, u7};
        use midly::{Format, Header, MetaMessage, MidiMessage, Timing, TrackEvent, TrackEventKind};

        let header = Header {
            format: Format::Parallel,
            timing: Timing::Metrical(u15::from(480)),
        };

        // 3/4 at 120 BPM (bar 0 = 0.0s, bar 1 = 1.5s @ tick 1440),
        // then tempo changes to 240 BPM (250_000 us/beat) at tick 1440 -> bar 2 = 2.25s @ tick 2880.
        let track0 = vec![
            TrackEvent {
                delta: u28::from(0),
                kind: TrackEventKind::Meta(MetaMessage::TimeSignature(3, 2, 24, 8)),
            },
            TrackEvent {
                delta: u28::from(0),
                kind: TrackEventKind::Meta(MetaMessage::Tempo(u24::from(500_000))),
            },
            TrackEvent {
                delta: u28::from(0),
                kind: TrackEventKind::Midi {
                    channel: u4::from(0),
                    message: MidiMessage::NoteOn {
                        key: u7::from(60),
                        vel: u7::from(100),
                    },
                },
            },
            TrackEvent {
                delta: u28::from(1440),
                kind: TrackEventKind::Meta(MetaMessage::Tempo(u24::from(250_000))),
            },
            TrackEvent {
                delta: u28::from(1440),
                kind: TrackEventKind::Midi {
                    channel: u4::from(0),
                    message: MidiMessage::NoteOff {
                        key: u7::from(60),
                        vel: u7::from(0),
                    },
                },
            },
        ];

        let mut smf_bytes = Vec::new();
        let smf = midly::Smf {
            header,
            tracks: vec![track0],
        };
        smf.write(&mut smf_bytes).unwrap();

        let parsed = parse_midi_bytes(&smf_bytes, "/test/3_4.mid", "3_4").unwrap();
        assert_eq!(parsed.time_signatures.len(), 1);
        assert_eq!(parsed.time_signatures[0].numerator, 3);
        assert_eq!(parsed.time_signatures[0].denominator, 4);
        assert_eq!(parsed.measure_times_sec.len(), 3);
        assert!((parsed.measure_times_sec[0] - 0.0).abs() < 1e-6);
        assert!((parsed.measure_times_sec[1] - 1.5).abs() < 1e-6);
        assert!((parsed.measure_times_sec[2] - 2.25).abs() < 1e-6);
    }
}
