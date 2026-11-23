use std::path::Path;
use midly::num::{u15, u24, u28, u4, u7};
use midly::{Format, Header, MetaMessage, MidiMessage, Smf, Timing, Track, TrackEvent, TrackEventKind};
use serde::Deserialize;

const TICKS_PER_BEAT: u16 = 480;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedNoteInput {
    pub midi: u8,
    pub hand: u8, // 1 = Right, 2 = Left
    pub velocity: f64, // 0.0..=1.0
    pub start_sec: f64,
    pub end_sec: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedSustainInput {
    pub time_sec: f64,
    pub value: u8, // 0..=127
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeplayRecordingPayload {
    pub title: String,
    pub bpm: f64,
    pub notes: Vec<RecordedNoteInput>,
    pub sustain_events: Vec<RecordedSustainInput>,
}

#[derive(Debug, Clone, Copy)]
enum RawEventKind {
    Sustain { value: u8 },
    NoteOff { key: u8 },
    NoteOn { key: u8, vel: u8 },
}

#[derive(Debug, Clone, Copy)]
struct TimedEvent {
    tick: u64,
    order: u8, // 0 = Sustain, 1 = NoteOff, 2 = NoteOn
    sort_key: u8,
    kind: RawEventKind,
}

fn sec_to_tick(sec: f64, bpm: f64) -> u64 {
    let clamped_sec = if sec.is_finite() { sec.max(0.0) } else { 0.0 };
    (clamped_sec * (bpm / 60.0) * (TICKS_PER_BEAT as f64)).round() as u64
}

fn build_channel_track<'a>(
    name: &'a [u8],
    channel: u8,
    mut events: Vec<TimedEvent>,
) -> Track<'a> {
    events.sort_by(|a, b| {
        a.tick
            .cmp(&b.tick)
            .then_with(|| a.order.cmp(&b.order))
            .then_with(|| a.sort_key.cmp(&b.sort_key))
    });

    let ch = u4::new(channel.min(15));
    let mut track: Track<'a> = Vec::with_capacity(events.len() + 2);
    track.push(TrackEvent {
        delta: u28::new(0),
        kind: TrackEventKind::Meta(MetaMessage::TrackName(name)),
    });

    let mut prev_tick = 0u64;
    for ev in events {
        let delta = ev.tick.saturating_sub(prev_tick).min(0x0FFF_FFFF) as u32;
        prev_tick = ev.tick;

        let message = match ev.kind {
            RawEventKind::Sustain { value } => MidiMessage::Controller {
                controller: u7::new(64),
                value: u7::new(value.min(127)),
            },
            RawEventKind::NoteOff { key } => MidiMessage::NoteOff {
                key: u7::new(key.min(127)),
                vel: u7::new(0),
            },
            RawEventKind::NoteOn { key, vel } => MidiMessage::NoteOn {
                key: u7::new(key.min(127)),
                vel: u7::new(vel.clamp(1, 127)),
            },
        };

        track.push(TrackEvent {
            delta: u28::new(delta),
            kind: TrackEventKind::Midi { channel: ch, message },
        });
    }

    track.push(TrackEvent {
        delta: u28::new(0),
        kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
    });

    track
}

pub fn write_freeplay_midi(
    path: &Path,
    payload: &FreeplayRecordingPayload,
) -> Result<(), String> {
    if payload.notes.is_empty() {
        return Err("Cannot save an empty recording with zero notes".to_string());
    }

    let bpm = if payload.bpm.is_finite() {
        payload.bpm.clamp(40.0, 240.0)
    } else {
        120.0
    };
    let us_per_quarter = (60_000_000.0 / bpm).round() as u32;

    let mut smf = Smf::new(Header::new(
        Format::Parallel,
        Timing::Metrical(u15::new(TICKS_PER_BEAT)),
    ));

    let clean_title = if payload.title.trim().is_empty() {
        "Freeplay Recording"
    } else {
        payload.title.trim()
    };

    // Track 0: Conductor (title + tempo)
    let conductor_track: Track<'_> = vec![
        TrackEvent {
            delta: u28::new(0),
            kind: TrackEventKind::Meta(MetaMessage::TrackName(clean_title.as_bytes())),
        },
        TrackEvent {
            delta: u28::new(0),
            kind: TrackEventKind::Meta(MetaMessage::Tempo(u24::new(us_per_quarter))),
        },
        TrackEvent {
            delta: u28::new(0),
            kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
        },
    ];
    smf.tracks.push(conductor_track);

    let mut right_events: Vec<TimedEvent> = Vec::new();
    let mut left_events: Vec<TimedEvent> = Vec::new();

    for ev in &payload.sustain_events {
        let tick = sec_to_tick(ev.time_sec, bpm);
        right_events.push(TimedEvent {
            tick,
            order: 0,
            sort_key: 64,
            kind: RawEventKind::Sustain {
                value: ev.value.min(127),
            },
        });
    }

    for note in &payload.notes {
        if !(21..=108).contains(&note.midi) {
            continue;
        }
        let vel = if note.velocity.is_finite() {
            (note.velocity.clamp(0.0, 1.0) * 127.0)
                .round()
                .clamp(1.0, 127.0) as u8
        } else {
            90
        };
        let start_tick = sec_to_tick(note.start_sec, bpm);
        let end_tick = sec_to_tick(note.end_sec, bpm).max(start_tick + 1);

        let target = if note.hand == 2 {
            &mut left_events
        } else {
            &mut right_events
        };

        target.push(TimedEvent {
            tick: start_tick,
            order: 2,
            sort_key: note.midi,
            kind: RawEventKind::NoteOn {
                key: note.midi,
                vel,
            },
        });
        target.push(TimedEvent {
            tick: end_tick,
            order: 1,
            sort_key: note.midi,
            kind: RawEventKind::NoteOff { key: note.midi },
        });
    }

    // Track 1: Right Hand (Channel 0) + CC64 sustain
    smf.tracks
        .push(build_channel_track(b"Right Hand", 0, right_events));

    // Track 2: Left Hand (Channel 1) — emitted when left-hand notes exist, mirroring CC64 sustain
    if !left_events.is_empty() {
        for ev in &payload.sustain_events {
            let tick = sec_to_tick(ev.time_sec, bpm);
            left_events.push(TimedEvent {
                tick,
                order: 0,
                sort_key: 64,
                kind: RawEventKind::Sustain {
                    value: ev.value.min(127),
                },
            });
        }
        smf.tracks
            .push(build_channel_track(b"Left Hand", 1, left_events));
    }

    smf.save(path)
        .map_err(|e| format!("Failed to write MIDI file {:?}: {}", path, e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::midi::parser::{parse_midi_file, HandRole};

    #[test]
    fn round_trip_freeplay_midi_preserves_notes_hands_and_sustain() {
        let payload = FreeplayRecordingPayload {
            title: "Test Take".to_string(),
            bpm: 120.0,
            notes: vec![
                RecordedNoteInput {
                    midi: 64,
                    hand: 1,
                    velocity: 0.8,
                    start_sec: 0.0,
                    end_sec: 0.5,
                },
                RecordedNoteInput {
                    midi: 48,
                    hand: 2,
                    velocity: 0.65,
                    start_sec: 0.5,
                    end_sec: 1.5,
                },
                RecordedNoteInput {
                    midi: 67,
                    hand: 1,
                    velocity: 0.9,
                    start_sec: 1.0,
                    end_sec: 2.0,
                },
            ],
            sustain_events: vec![
                RecordedSustainInput {
                    time_sec: 0.0,
                    value: 127,
                },
                RecordedSustainInput {
                    time_sec: 1.8,
                    value: 0,
                },
            ],
        };

        let tmp_path = std::env::temp_dir().join(format!(
            "aurelia_writer_test_{}.mid",
            std::process::id()
        ));

        write_freeplay_midi(&tmp_path, &payload).expect("write_freeplay_midi should succeed");
        let parsed = parse_midi_file(&tmp_path).expect("parse_midi_file should succeed");
        let _ = std::fs::remove_file(&tmp_path);

        assert_eq!(parsed.notes.len(), 3);
        assert_eq!(parsed.pedal_events.len(), 4);
        assert!((parsed.initial_bpm - 120.0).abs() < 0.5);
        assert!((parsed.duration_sec - 2.0).abs() < 0.05);

        let right_notes: Vec<_> = parsed
            .notes
            .iter()
            .filter(|n| n.default_hand == HandRole::Right)
            .collect();
        let left_notes: Vec<_> = parsed
            .notes
            .iter()
            .filter(|n| n.default_hand == HandRole::Left)
            .collect();

        assert_eq!(right_notes.len(), 2);
        assert_eq!(left_notes.len(), 1);
        assert_eq!(left_notes[0].midi, 48);
        assert_eq!(parsed.pedal_events[0].value, 127);
        assert_eq!(parsed.pedal_events.last().unwrap().value, 0);
    }
}
