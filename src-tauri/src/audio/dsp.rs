use std::sync::OnceLock;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TouchPreset {
    Soft,     // gamma = 0.92, makeup_gain = 1.55
    Balanced, // gamma = 0.78, makeup_gain = 1.90
    Strong,   // gamma = 0.65, makeup_gain = 2.35
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SoundProfile {
    pub reverb_mix: f32, // 0.0 .. 0.45 (default 0.18)
    pub touch: TouchPreset,
}

impl Default for SoundProfile {
    fn default() -> Self {
        Self {
            reverb_mix: 0.18,
            touch: TouchPreset::Balanced,
        }
    }
}

struct VelocityLuts {
    soft: [u8; 128],
    balanced: [u8; 128],
    strong: [u8; 128],
}

impl VelocityLuts {
    fn new() -> Self {
        let mut soft = [0u8; 128];
        let mut balanced = [0u8; 128];
        let mut strong = [0u8; 128];

        for i in 1..128 {
            let norm = i as f32 / 127.0;
            soft[i] = (norm.powf(0.92) * 127.0).round().clamp(1.0, 127.0) as u8;
            balanced[i] = (norm.powf(0.78) * 127.0).round().clamp(1.0, 127.0) as u8;
            strong[i] = (norm.powf(0.65) * 127.0).round().clamp(1.0, 127.0) as u8;
        }

        Self {
            soft,
            balanced,
            strong,
        }
    }

    #[inline]
    fn lookup(&self, vel: u8, touch: TouchPreset) -> u8 {
        let idx = (vel as usize).min(127);
        match touch {
            TouchPreset::Soft => self.soft[idx],
            TouchPreset::Balanced => self.balanced[idx],
            TouchPreset::Strong => self.strong[idx],
        }
    }
}

static VELOCITY_LUTS: OnceLock<VelocityLuts> = OnceLock::new();

#[inline]
pub fn shape_velocity(vel: u8, touch: TouchPreset) -> u8 {
    if vel == 0 {
        return 0;
    }
    let luts = VELOCITY_LUTS.get_or_init(VelocityLuts::new);
    luts.lookup(vel, touch)
}

#[derive(Debug, Clone)]
pub struct BiquadShelf {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl BiquadShelf {
    pub fn new_low_shelf(sample_rate: f32, cutoff_hz: f32, gain_db: f32) -> Self {
        let a_val = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * cutoff_hz / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let alpha = sin_w0 / (2.0 * 0.70710678);
        let two_sqrt_a_alpha = 2.0 * a_val.sqrt() * alpha;

        let b0 = a_val * ((a_val + 1.0) - (a_val - 1.0) * cos_w0 + two_sqrt_a_alpha);
        let b1 = 2.0 * a_val * ((a_val - 1.0) - (a_val + 1.0) * cos_w0);
        let b2 = a_val * ((a_val + 1.0) - (a_val - 1.0) * cos_w0 - two_sqrt_a_alpha);
        let a0 = (a_val + 1.0) + (a_val - 1.0) * cos_w0 + two_sqrt_a_alpha;
        let a1 = -2.0 * ((a_val - 1.0) + (a_val + 1.0) * cos_w0);
        let a2 = (a_val + 1.0) + (a_val - 1.0) * cos_w0 - two_sqrt_a_alpha;

        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let out = self.b0 * input + self.z1;
        self.z1 = self.b1 * input - self.a1 * out + self.z2;
        self.z2 = self.b2 * input - self.a2 * out;

        if self.z1.abs() < 1e-20 {
            self.z1 = 0.0;
        }
        if self.z2.abs() < 1e-20 {
            self.z2 = 0.0;
        }

        out
    }
}

#[derive(Debug, Clone)]
struct CombFilter {
    buffer: Vec<f32>,
    index: usize,
    damp_state: f32,
    damp: f32,
    feedback: f32,
}

impl CombFilter {
    fn new(length: usize, damp: f32, feedback: f32) -> Self {
        Self {
            buffer: vec![0.0; length.max(1)],
            index: 0,
            damp_state: 0.0,
            damp,
            feedback,
        }
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let output = self.buffer[self.index];
        self.damp_state = (output * (1.0 - self.damp)) + (self.damp_state * self.damp);
        if self.damp_state.abs() < 1e-20 {
            self.damp_state = 0.0;
        }

        let mut fb = input + self.damp_state * self.feedback;
        if fb.abs() < 1e-20 {
            fb = 0.0;
        }
        self.buffer[self.index] = fb;

        self.index += 1;
        if self.index >= self.buffer.len() {
            self.index = 0;
        }

        output
    }
}

#[derive(Debug, Clone)]
struct AllpassFilter {
    buffer: Vec<f32>,
    index: usize,
    feedback: f32,
}

impl AllpassFilter {
    fn new(length: usize, feedback: f32) -> Self {
        Self {
            buffer: vec![0.0; length.max(1)],
            index: 0,
            feedback,
        }
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let mut bufout = self.buffer[self.index];
        if bufout.abs() < 1e-20 {
            bufout = 0.0;
        }
        let output = -input + bufout;
        let mut new_buf = input + bufout * self.feedback;
        if new_buf.abs() < 1e-20 {
            new_buf = 0.0;
        }
        self.buffer[self.index] = new_buf;

        self.index += 1;
        if self.index >= self.buffer.len() {
            self.index = 0;
        }

        output
    }
}

#[derive(Debug, Clone)]
pub struct StereoFreeverb {
    combs_l: [CombFilter; 4],
    combs_r: [CombFilter; 4],
    allpasses_l: [AllpassFilter; 2],
    allpasses_r: [AllpassFilter; 2],
}

impl StereoFreeverb {
    pub fn new(sample_rate: f32) -> Self {
        let scale = sample_rate / 44100.0;
        let damp = 0.35;
        let comb_feedback = 0.80;
        let allpass_feedback = 0.50;

        let comb_lens_l = [1116, 1188, 1277, 1356];
        let spread = 23;
        let allpass_lens_l = [556, 441];

        let scale_len = |base: usize, offset: usize| -> usize {
            (((base + offset) as f32 * scale).round() as usize).max(1)
        };

        let combs_l = [
            CombFilter::new(scale_len(comb_lens_l[0], 0), damp, comb_feedback),
            CombFilter::new(scale_len(comb_lens_l[1], 0), damp, comb_feedback),
            CombFilter::new(scale_len(comb_lens_l[2], 0), damp, comb_feedback),
            CombFilter::new(scale_len(comb_lens_l[3], 0), damp, comb_feedback),
        ];

        let combs_r = [
            CombFilter::new(scale_len(comb_lens_l[0], spread), damp, comb_feedback),
            CombFilter::new(scale_len(comb_lens_l[1], spread), damp, comb_feedback),
            CombFilter::new(scale_len(comb_lens_l[2], spread), damp, comb_feedback),
            CombFilter::new(scale_len(comb_lens_l[3], spread), damp, comb_feedback),
        ];

        let allpasses_l = [
            AllpassFilter::new(scale_len(allpass_lens_l[0], 0), allpass_feedback),
            AllpassFilter::new(scale_len(allpass_lens_l[1], 0), allpass_feedback),
        ];

        let allpasses_r = [
            AllpassFilter::new(scale_len(allpass_lens_l[0], spread), allpass_feedback),
            AllpassFilter::new(scale_len(allpass_lens_l[1], spread), allpass_feedback),
        ];

        Self {
            combs_l,
            combs_r,
            allpasses_l,
            allpasses_r,
        }
    }

    #[inline]
    pub fn process(&mut self, in_l: f32, in_r: f32) -> (f32, f32) {
        let mut out_l = 0.0;
        for c in &mut self.combs_l {
            out_l += c.process(in_l);
        }
        out_l *= 0.25;
        for a in &mut self.allpasses_l {
            out_l = a.process(out_l);
        }

        let mut out_r = 0.0;
        for c in &mut self.combs_r {
            out_r += c.process(in_r);
        }
        out_r *= 0.25;
        for a in &mut self.allpasses_r {
            out_r = a.process(out_r);
        }

        (out_l, out_r)
    }
}

#[inline]
pub fn soft_limit(x: f32) -> f32 {
    0.96 * (x / 0.96).tanh()
}

pub struct StudioDsp {
    warmth_l: BiquadShelf,
    warmth_r: BiquadShelf,
    reverb: StereoFreeverb,
    profile: SoundProfile,
    makeup_gain: f32,
}

impl StudioDsp {
    pub fn new(sample_rate: f32) -> Self {
        let profile = SoundProfile::default();
        let makeup_gain = match profile.touch {
            TouchPreset::Soft => 1.55,
            TouchPreset::Balanced => 1.90,
            TouchPreset::Strong => 2.35,
        };

        Self {
            warmth_l: BiquadShelf::new_low_shelf(sample_rate, 140.0, 1.5),
            warmth_r: BiquadShelf::new_low_shelf(sample_rate, 140.0, 1.5),
            reverb: StereoFreeverb::new(sample_rate),
            profile,
            makeup_gain,
        }
    }

    pub fn set_profile(&mut self, profile: SoundProfile) {
        self.profile = profile;
        self.makeup_gain = match profile.touch {
            TouchPreset::Soft => 1.55,
            TouchPreset::Balanced => 1.90,
            TouchPreset::Strong => 2.35,
        };
    }

    pub fn get_profile(&self) -> SoundProfile {
        self.profile
    }

    #[inline]
    pub fn process_stereo(&mut self, left: &mut [f32], right: &mut [f32]) {
        let reverb_mix = self.profile.reverb_mix.clamp(0.0, 0.45);
        let dry_gain = 1.0 - reverb_mix;
        let wet_gain = reverb_mix;
        let makeup = self.makeup_gain;

        let frames = left.len().min(right.len());
        for i in 0..frames {
            let w_l = self.warmth_l.process(left[i]);
            let w_r = self.warmth_r.process(right[i]);

            let (wet_l, wet_r) = self.reverb.process(w_l, w_r);

            let mix_l = (dry_gain * w_l + wet_gain * wet_l) * makeup;
            let mix_r = (dry_gain * w_r + wet_gain * wet_r) * makeup;

            left[i] = soft_limit(mix_l);
            right[i] = soft_limit(mix_r);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_velocity_shaping() {
        assert_eq!(shape_velocity(0, TouchPreset::Strong), 0);
        assert_eq!(shape_velocity(0, TouchPreset::Balanced), 0);
        assert_eq!(shape_velocity(0, TouchPreset::Soft), 0);

        let shaped_balanced_64 = shape_velocity(64, TouchPreset::Balanced);
        assert!(
            shaped_balanced_64 > 64,
            "Balanced touch at 64 should be > 64, got {}",
            shaped_balanced_64
        );

        let shaped_strong_64 = shape_velocity(64, TouchPreset::Strong);
        assert!(
            shaped_strong_64 > shaped_balanced_64,
            "Strong touch at 64 should be > Balanced touch, got {} vs {}",
            shaped_strong_64,
            shaped_balanced_64
        );

        assert_eq!(shape_velocity(127, TouchPreset::Soft), 127);
        assert_eq!(shape_velocity(127, TouchPreset::Balanced), 127);
        assert_eq!(shape_velocity(127, TouchPreset::Strong), 127);
    }

    #[test]
    fn test_soft_limiter_extreme_impulse() {
        let mut dsp = StudioDsp::new(48000.0);
        let mut left = vec![16.0f32; 512]; // +24 dB extreme burst
        let mut right = vec![16.0f32; 512];

        dsp.process_stereo(&mut left, &mut right);

        for (i, (&l, &r)) in left.iter().zip(right.iter()).enumerate() {
            assert!(!l.is_nan(), "Left sample at {} is NaN", i);
            assert!(!l.is_infinite(), "Left sample at {} is Inf", i);
            assert!(
                l >= -0.97 && l <= 0.97,
                "Left sample {} exceeded [-0.97, 0.97]: {}",
                i,
                l
            );

            assert!(!r.is_nan(), "Right sample at {} is NaN", i);
            assert!(!r.is_infinite(), "Right sample at {} is Inf", i);
            assert!(
                r >= -0.97 && r <= 0.97,
                "Right sample {} exceeded [-0.97, 0.97]: {}",
                i,
                r
            );
        }
    }

    #[test]
    fn test_reverb_tail_decay() {
        let mut dsp = StudioDsp::new(48000.0);
        // Set reverb mix to 0.45 for clear wet tail
        dsp.set_profile(SoundProfile {
            reverb_mix: 0.45,
            touch: TouchPreset::Balanced,
        });

        // 1 impulse sample
        let mut left = vec![0.0f32; 1024];
        let mut right = vec![0.0f32; 1024];
        left[0] = 1.0;
        right[0] = 1.0;

        dsp.process_stereo(&mut left, &mut right);

        // Process silence for 2 seconds (96 blocks of 1024 = 98304 samples at 48kHz)
        for _ in 0..96 {
            let mut l_block = vec![0.0f32; 1024];
            let mut r_block = vec![0.0f32; 1024];
            dsp.process_stereo(&mut l_block, &mut r_block);
            for (&s_l, &s_r) in l_block.iter().zip(r_block.iter()) {
                assert!(!s_l.is_nan());
                assert!(!s_r.is_nan());
                assert!(!s_l.is_infinite());
                assert!(!s_r.is_infinite());
            }
        }

        // At the end of 2 seconds, the tail should have decayed to near zero
        let mut final_l = vec![0.0f32; 1024];
        let mut final_r = vec![0.0f32; 1024];
        dsp.process_stereo(&mut final_l, &mut final_r);
        let final_max = final_l
            .iter()
            .chain(final_r.iter())
            .fold(0.0f32, |m, &x| m.max(x.abs()));
        assert!(
            final_max < 0.001,
            "Reverb tail should have decayed to near zero after 2 seconds, got {}",
            final_max
        );
    }
}
