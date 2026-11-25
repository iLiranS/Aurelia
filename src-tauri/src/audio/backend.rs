use std::f32::consts::PI;
use std::sync::Arc;
use rustysynth::{SoundFont, Synthesizer, SynthesizerSettings};

pub trait AudioBackend: Send {
    fn note_on(&mut self, channel: i32, key: i32, velocity: i32);
    fn note_off(&mut self, channel: i32, key: i32);
    fn control_change(&mut self, channel: i32, controller: i32, value: i32);
    fn all_notes_off(&mut self);
    fn render(&mut self, left: &mut [f32], right: &mut [f32]);
}

pub struct RustySynthBackend {
    synth: Synthesizer,
}

impl RustySynthBackend {
    pub fn new(sound_font: Arc<SoundFont>, sample_rate: i32) -> Result<Self, String> {
        let settings = SynthesizerSettings::new(sample_rate);
        let synth = Synthesizer::new(&sound_font, &settings)
            .map_err(|e| format!("Failed to create synthesizer: {:?}", e))?;
        Ok(Self { synth })
    }
}

impl AudioBackend for RustySynthBackend {
    fn note_on(&mut self, channel: i32, key: i32, velocity: i32) {
        self.synth.note_on(channel, key, velocity);
    }

    fn note_off(&mut self, channel: i32, key: i32) {
        self.synth.note_off(channel, key);
    }

    fn control_change(&mut self, channel: i32, controller: i32, value: i32) {
        self.synth.process_midi_message(channel, 0xB0, controller, value);
    }

    fn all_notes_off(&mut self) {
        // Release sustain pedal (CC64) on both Song (ch 0) and Live (ch 1) channels
        self.synth.process_midi_message(0, 0xB0, 64, 0);
        self.synth.process_midi_message(1, 0xB0, 64, 0);
        self.synth.note_off_all(false);
    }

    fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        self.synth.render(left, right);
    }
}

// Fallback synth with smooth envelope used when soundfont is not available or for tests
struct SineVoice {
    channel: i32,
    key: i32,
    phase: f32,
    phase_inc: f32,
    amplitude: f32,
    decay_rate: f32,
    is_released: bool,
}

pub struct SineFallbackBackend {
    sample_rate: f32,
    voices: Vec<SineVoice>,
    sustain_pedal: [bool; 2],
    channel_volume: [f32; 2],
}

impl SineFallbackBackend {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            voices: Vec::with_capacity(32),
            sustain_pedal: [false; 2],
            channel_volume: [1.0; 2],
        }
    }

    #[inline]
    fn ch_idx(channel: i32) -> usize {
        if channel == 1 { 1 } else { 0 }
    }
}

impl AudioBackend for SineFallbackBackend {
    fn note_on(&mut self, channel: i32, key: i32, velocity: i32) {
        let freq = 440.0 * 2.0f32.powf((key as f32 - 69.0) / 12.0);
        let phase_inc = (2.0 * PI * freq) / self.sample_rate;
        let amplitude = (velocity as f32 / 127.0).clamp(0.0, 1.0) * 0.25;

        // Replace voice with same channel+key or append
        if let Some(existing) = self
            .voices
            .iter_mut()
            .find(|v| v.channel == channel && v.key == key)
        {
            existing.phase = 0.0;
            existing.phase_inc = phase_inc;
            existing.amplitude = amplitude;
            existing.decay_rate = 0.9997;
            existing.is_released = false;
        } else {
            self.voices.push(SineVoice {
                channel,
                key,
                phase: 0.0,
                phase_inc,
                amplitude,
                decay_rate: 0.9997,
                is_released: false,
            });
        }
    }

    fn note_off(&mut self, channel: i32, key: i32) {
        let ch = Self::ch_idx(channel);
        if let Some(voice) = self
            .voices
            .iter_mut()
            .find(|v| v.channel == channel && v.key == key)
        {
            voice.is_released = true;
            if !self.sustain_pedal[ch] {
                voice.decay_rate = 0.992; // faster release
            }
        }
    }

    fn control_change(&mut self, channel: i32, controller: i32, value: i32) {
        let ch = Self::ch_idx(channel);
        if controller == 64 {
            let was_sustain = self.sustain_pedal[ch];
            self.sustain_pedal[ch] = value >= 64;
            if was_sustain && !self.sustain_pedal[ch] {
                for voice in &mut self.voices {
                    if Self::ch_idx(voice.channel) == ch && voice.is_released {
                        voice.decay_rate = 0.992;
                    }
                }
            }
        } else if controller == 7 {
            self.channel_volume[ch] = (value as f32 / 127.0).clamp(0.0, 1.0);
        }
    }

    fn all_notes_off(&mut self) {
        self.sustain_pedal = [false; 2];
        for voice in &mut self.voices {
            voice.amplitude = 0.0;
        }
        self.voices.clear();
    }

    fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        for sample_idx in 0..left.len() {
            let mut mixed = 0.0f32;
            for voice in &mut self.voices {
                let ch_gain = self.channel_volume[Self::ch_idx(voice.channel)];
                mixed += (voice.phase).sin() * voice.amplitude * ch_gain;
                voice.phase = (voice.phase + voice.phase_inc) % (2.0 * PI);
                voice.amplitude *= voice.decay_rate;
            }
            left[sample_idx] = mixed;
            right[sample_idx] = mixed;
        }

        self.voices.retain(|v| v.amplitude > 0.0001);
    }
}
