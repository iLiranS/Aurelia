pub mod backend;
pub mod dsp;
pub mod engine;
pub mod offline_render;
pub mod sequencer;
pub mod soundfonts;

pub use backend::{AudioBackend, RustySynthBackend, SineFallbackBackend};
pub use dsp::{shape_velocity, SoundProfile, StudioDsp, TouchPreset};
pub use engine::{AudioCommand, AudioEngineHandle};
pub use offline_render::{render_midi_to_audio, AudioExportFormat};
pub use sequencer::{build_seq_events, SeqEvent, SeqEventKind, Sequencer};
pub use soundfonts::{discover_soundfonts, format_soundfont_name, import_soundfont_file, SoundFontInfo};
