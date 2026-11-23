use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::sync::Arc;

use hound::{SampleFormat, WavSpec, WavWriter};
use mp3lame_encoder::{Bitrate, Builder, DualPcm, FlushNoGap, Quality};
use rustysynth::SoundFont;

use crate::audio::backend::{AudioBackend, RustySynthBackend, SineFallbackBackend};
use crate::audio::dsp::{SoundProfile, StudioDsp};
use crate::audio::sequencer::{build_seq_events, Sequencer};
use crate::midi::SongSettings;

const SAMPLE_RATE: usize = 44_100;
const BLOCK_FRAMES: usize = 1024;
const TAIL_SEC: f64 = 2.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioExportFormat {
    Wav,
    Mp3,
}

impl AudioExportFormat {
    pub fn parse(raw: &str) -> Result<Self, String> {
        match raw.trim().to_lowercase().as_str() {
            "wav" => Ok(Self::Wav),
            "mp3" => Ok(Self::Mp3),
            other => Err(format!("Unsupported audio export format: {}", other)),
        }
    }
}

#[inline]
fn f32_to_i16(sample: f32) -> i16 {
    let clamped = sample.clamp(-1.0, 1.0);
    (clamped * i16::MAX as f32).round() as i16
}

fn create_backend(soundfont_path: Option<&Path>) -> Box<dyn AudioBackend> {
    if let Some(sf_path) = soundfont_path {
        if sf_path.exists() {
            if let Ok(mut file) = File::open(sf_path) {
                if let Ok(sf) = SoundFont::new(&mut file) {
                    if let Ok(backend) = RustySynthBackend::new(Arc::new(sf), SAMPLE_RATE as i32) {
                        return Box::new(backend);
                    }
                }
            }
        }
    }
    Box::new(SineFallbackBackend::new(SAMPLE_RATE as f32))
}

pub fn render_midi_to_audio(
    midi_path: &Path,
    output_path: &Path,
    format: AudioExportFormat,
    soundfont_path: Option<&Path>,
    profile: SoundProfile,
) -> Result<(), String> {
    let parsed = crate::midi::parser::parse_midi_file(midi_path)?;
    let default_settings = SongSettings::default();
    let events = build_seq_events(&parsed, &default_settings);

    let mut backend = create_backend(soundfont_path);
    let mut sequencer = Sequencer::new();
    sequencer.load_song(events, parsed.duration_sec, &default_settings);
    sequencer.touch = profile.touch;
    sequencer.is_playing = true;
    sequencer.preview_bypass_study = true;

    let mut dsp = StudioDsp::new(SAMPLE_RATE as f32);
    dsp.set_profile(profile);

    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create output directory: {}", e))?;
        }
    }

    let total_frames = ((parsed.duration_sec + TAIL_SEC) * SAMPLE_RATE as f64).ceil() as usize;
    let mut left = vec![0.0f32; BLOCK_FRAMES];
    let mut right = vec![0.0f32; BLOCK_FRAMES];

    match format {
        AudioExportFormat::Wav => {
            let spec = WavSpec {
                channels: 2,
                sample_rate: SAMPLE_RATE as u32,
                bits_per_sample: 16,
                sample_format: SampleFormat::Int,
            };
            let mut writer = WavWriter::create(output_path, spec)
                .map_err(|e| format!("Failed to create WAV file {:?}: {}", output_path, e))?;

            let mut rendered = 0usize;
            while rendered < total_frames {
                let frames = (total_frames - rendered).min(BLOCK_FRAMES);
                let l_slice = &mut left[..frames];
                let r_slice = &mut right[..frames];
                l_slice.fill(0.0);
                r_slice.fill(0.0);

                sequencer.render_block(&mut *backend, l_slice, r_slice, SAMPLE_RATE as f64);
                dsp.process_stereo(l_slice, r_slice);

                for i in 0..frames {
                    writer
                        .write_sample(f32_to_i16(l_slice[i]))
                        .map_err(|e| format!("WAV write error: {}", e))?;
                    writer
                        .write_sample(f32_to_i16(r_slice[i]))
                        .map_err(|e| format!("WAV write error: {}", e))?;
                }
                rendered += frames;
            }

            writer
                .finalize()
                .map_err(|e| format!("Failed to finalize WAV file: {}", e))?;
        }
        AudioExportFormat::Mp3 => {
            let mut builder =
                Builder::new().ok_or_else(|| "Failed to initialize MP3 encoder".to_string())?;
            builder
                .set_num_channels(2)
                .map_err(|e| format!("MP3 channel config error: {:?}", e))?;
            builder
                .set_sample_rate(SAMPLE_RATE as u32)
                .map_err(|e| format!("MP3 sample rate config error: {:?}", e))?;
            builder
                .set_brate(Bitrate::Kbps192)
                .map_err(|e| format!("MP3 bitrate config error: {:?}", e))?;
            builder
                .set_quality(Quality::Best)
                .map_err(|e| format!("MP3 quality config error: {:?}", e))?;

            let mut mp3_encoder = builder
                .build()
                .map_err(|e| format!("Failed to build MP3 encoder: {:?}", e))?;

            let out_file = File::create(output_path)
                .map_err(|e| format!("Failed to create MP3 file {:?}: {}", output_path, e))?;
            let mut writer = BufWriter::new(out_file);

            let mut left_i16 = vec![0i16; BLOCK_FRAMES];
            let mut right_i16 = vec![0i16; BLOCK_FRAMES];
            let min_buf = mp3lame_encoder::max_required_buffer_size(BLOCK_FRAMES).max(16_384);
            let mut mp3_buf: Vec<u8> = Vec::with_capacity(min_buf);

            let mut rendered = 0usize;
            while rendered < total_frames {
                let frames = (total_frames - rendered).min(BLOCK_FRAMES);
                let l_slice = &mut left[..frames];
                let r_slice = &mut right[..frames];
                l_slice.fill(0.0);
                r_slice.fill(0.0);

                sequencer.render_block(&mut *backend, l_slice, r_slice, SAMPLE_RATE as f64);
                dsp.process_stereo(l_slice, r_slice);

                for i in 0..frames {
                    left_i16[i] = f32_to_i16(l_slice[i]);
                    right_i16[i] = f32_to_i16(r_slice[i]);
                }

                let input = DualPcm {
                    left: &left_i16[..frames],
                    right: &right_i16[..frames],
                };
                mp3_buf.clear();
                mp3_encoder
                    .encode_to_vec(input, &mut mp3_buf)
                    .map_err(|e| format!("MP3 encode error: {:?}", e))?;
                writer
                    .write_all(&mp3_buf)
                    .map_err(|e| format!("MP3 write error: {}", e))?;

                rendered += frames;
            }

            mp3_buf.clear();
            if mp3_buf.capacity() < 16_384 {
                mp3_buf.reserve(16_384);
            }
            mp3_encoder
                .flush_to_vec::<FlushNoGap>(&mut mp3_buf)
                .map_err(|e| format!("MP3 flush error: {:?}", e))?;
            writer
                .write_all(&mp3_buf)
                .map_err(|e| format!("MP3 flush write error: {}", e))?;
            writer
                .flush()
                .map_err(|e| format!("MP3 file flush error: {}", e))?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::midi::writer::{
        write_freeplay_midi, FreeplayRecordingPayload, RecordedNoteInput,
    };

    #[test]
    fn render_mp3_and_wav_succeeds() {
        let mid_path = std::env::temp_dir().join(format!("aurelia_render_{}.mid", std::process::id()));
        let mp3_path = std::env::temp_dir().join(format!("aurelia_render_{}.mp3", std::process::id()));
        let wav_path = std::env::temp_dir().join(format!("aurelia_render_{}.wav", std::process::id()));

        let payload = FreeplayRecordingPayload {
            title: "Test".to_string(),
            bpm: 120.0,
            notes: vec![RecordedNoteInput {
                midi: 60,
                hand: 1,
                velocity: 0.8,
                start_sec: 0.0,
                end_sec: 0.5,
            }],
            sustain_events: vec![],
        };
        write_freeplay_midi(&mid_path, &payload).unwrap();

        render_midi_to_audio(
            &mid_path,
            &mp3_path,
            AudioExportFormat::Mp3,
            None,
            SoundProfile::default(),
        )
        .expect("MP3 render should succeed");

        render_midi_to_audio(
            &mid_path,
            &wav_path,
            AudioExportFormat::Wav,
            None,
            SoundProfile::default(),
        )
        .expect("WAV render should succeed");

        assert!(std::fs::metadata(&mp3_path).unwrap().len() > 500);
        assert!(std::fs::metadata(&wav_path).unwrap().len() > 1000);

        let _ = std::fs::remove_file(&mid_path);
        let _ = std::fs::remove_file(&mp3_path);
        let _ = std::fs::remove_file(&wav_path);
    }
}
