use serde::{Deserialize, Serialize};
use crate::midi::{HandRole, MidiNote, ParsedSong};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongPreviews {
    pub peak_start_sec: f64,
    pub preview_peak_json: String, // JSON array of [midi, relStartMs, durMs, hand] (hand: 1=R, 2=L)
    pub preview_start_json: String,
}

/// Extracts a compact tuple representation of notes overlapping [window_start, window_start + window_len].
/// Format: JSON array of [midi, relStartMs, durMs, hand] (hand: 1=R, 2=L), capped at max_notes.
pub fn extract_snippet(
    notes: &[MidiNote],
    window_start: f64,
    window_len: f64,
    max_notes: usize,
) -> String {
    let window_end = window_start + window_len;
    let mut snippet: Vec<(u8, i32, i32, u8)> = Vec::new();

    for note in notes {
        let note_end = note.start_sec + note.duration_sec;
        if note.start_sec < window_end && note_end > window_start {
            let rel_start_ms = ((note.start_sec - window_start) * 1000.0).max(0.0).round() as i32;
            let dur_ms = ((note.duration_sec * 1000.0).max(10.0)).round() as i32;
            let hand_val: u8 = match note.default_hand {
                HandRole::Left => 2,
                _ => 1,
            };
            snippet.push((note.midi, rel_start_ms, dur_ms, hand_val));
            if snippet.len() >= max_notes {
                break;
            }
        }
    }

    serde_json::to_string(&snippet).unwrap_or_else(|_| "[]".to_string())
}

/// Computes the Smart Intensity Peak and 6-second compact preview note arrays for a song.
pub fn compute_song_previews(parsed: &ParsedSong) -> SongPreviews {
    if parsed.notes.is_empty() {
        return SongPreviews {
            peak_start_sec: 0.0,
            preview_peak_json: "[]".to_string(),
            preview_start_json: "[]".to_string(),
        };
    }

    let first_note_sec = parsed.notes[0].start_sec;
    let preview_start_json = extract_snippet(&parsed.notes, first_note_sec, 6.0, 180);

    if parsed.duration_sec <= 8.0 {
        return SongPreviews {
            peak_start_sec: first_note_sec,
            preview_peak_json: preview_start_json.clone(),
            preview_start_json,
        };
    }

    let t_start = parsed.duration_sec * 0.08;
    let t_end = (parsed.duration_sec * 0.88 - 4.0).max(t_start);

    let mut best_t = t_start;
    let mut best_score = -1.0f64;

    let mut t = t_start;
    while t <= t_end + 1e-6 {
        let window_end = t + 4.0;
        let mut count = 0usize;
        let mut min_midi = u8::MAX;
        let mut max_midi = u8::MIN;
        let mut vel_sum = 0u64;

        for note in &parsed.notes {
            if note.start_sec >= t && note.start_sec < window_end {
                count += 1;
                min_midi = min_midi.min(note.midi);
                max_midi = max_midi.max(note.midi);
                vel_sum += note.velocity as u64;
            }
        }

        let score = if count > 0 {
            let pitch_span = (max_midi - min_midi) as f64;
            let avg_vel = (vel_sum as f64) / (count as f64);
            (count as f64) * (1.0 + pitch_span / 36.0) * (0.5 + avg_vel / 127.0)
        } else {
            0.0
        };

        if score > best_score {
            best_score = score;
            best_t = t;
        }

        t += 0.5;
    }

    let preview_peak_json = extract_snippet(&parsed.notes, best_t, 6.0, 180);

    SongPreviews {
        peak_start_sec: best_t,
        preview_peak_json,
        preview_start_json,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_note(id: u32, midi: u8, start_sec: f64, duration_sec: f64, velocity: u8, hand: HandRole) -> MidiNote {
        MidiNote {
            id,
            midi,
            start_sec,
            duration_sec,
            velocity,
            track_index: 0,
            channel: 0,
            default_hand: hand,
        }
    }

    #[test]
    fn test_empty_song_previews() {
        let parsed = ParsedSong {
            content_hash: "empty".to_string(),
            file_path: "/empty.mid".to_string(),
            title: "Empty".to_string(),
            duration_sec: 0.0,
            initial_bpm: 120.0,
            tracks: Vec::new(),
            notes: Vec::new(),
            pedal_events: Vec::new(),
        };

        let previews = compute_song_previews(&parsed);
        assert_eq!(previews.peak_start_sec, 0.0);
        assert_eq!(previews.preview_peak_json, "[]");
        assert_eq!(previews.preview_start_json, "[]");
    }

    #[test]
    fn test_short_song_previews() {
        let notes = vec![
            make_test_note(1, 60, 1.0, 0.5, 80, HandRole::Right),
            make_test_note(2, 64, 1.5, 0.5, 85, HandRole::Right),
        ];

        let parsed = ParsedSong {
            content_hash: "short".to_string(),
            file_path: "/short.mid".to_string(),
            title: "Short".to_string(),
            duration_sec: 5.0,
            initial_bpm: 120.0,
            tracks: Vec::new(),
            notes,
            pedal_events: Vec::new(),
        };

        let previews = compute_song_previews(&parsed);
        assert_eq!(previews.peak_start_sec, 1.0);
        assert_eq!(previews.preview_peak_json, previews.preview_start_json);
        assert!(previews.preview_start_json.contains("[60,0,500,1]"));
        assert!(previews.preview_start_json.contains("[64,500,500,1]"));
    }

    #[test]
    fn test_smart_peak_chorus_detection() {
        let mut notes = Vec::new();
        let mut id = 0;

        // Quiet sparse intro from 0s to 10s: 1 note every 2 seconds, velocity 40, middle C only
        for i in 0..5 {
            id += 1;
            notes.push(make_test_note(id, 60, i as f64 * 2.0, 0.8, 40, HandRole::Right));
        }

        // Dense, energetic two-hand chorus at 20s to 24s:
        // 20 notes spread across low bass (pitch 36..48) and high treble (pitch 72..84), velocity 110
        for i in 0..10 {
            id += 1;
            let t = 20.0 + (i as f64) * 0.35;
            notes.push(make_test_note(id, 36 + (i as u8 % 12), t, 0.3, 110, HandRole::Left));
            id += 1;
            notes.push(make_test_note(id, 72 + (i as u8 % 12), t, 0.3, 115, HandRole::Right));
        }

        // Outro from 30s to 35s
        for i in 0..3 {
            id += 1;
            notes.push(make_test_note(id, 62, 30.0 + i as f64 * 1.5, 1.0, 50, HandRole::Right));
        }

        notes.sort_by(|a, b| a.start_sec.partial_cmp(&b.start_sec).unwrap());

        let parsed = ParsedSong {
            content_hash: "chorus_test".to_string(),
            file_path: "/chorus.mid".to_string(),
            title: "Chorus Test".to_string(),
            duration_sec: 40.0,
            initial_bpm: 120.0,
            tracks: Vec::new(),
            notes,
            pedal_events: Vec::new(),
        };

        let previews = compute_song_previews(&parsed);

        // Peak start should select a window covering the chorus at t = 20s
        assert!(
            previews.peak_start_sec >= 17.0 && previews.peak_start_sec <= 24.0,
            "Expected peak_start_sec to land around the chorus at ~20s, but got {}",
            previews.peak_start_sec
        );

        // Preview peak JSON must contain notes from both hands (hand 1 and hand 2)
        assert!(previews.preview_peak_json.contains(",1]"));
        assert!(previews.preview_peak_json.contains(",2]"));

        // Preview start JSON captures the intro starting at 0.0s
        assert!(previews.preview_start_json.contains("[60,0,800,1]"));
    }
}
