use std::sync::{Arc, Mutex};
use std::time::Duration;

use midir::{Ignore, MidiInput, MidiInputConnection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::audio::engine::{AudioCommand, AudioEngineHandle};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MidiDeviceInfo {
    pub name: String,
    pub suggested_key_count: Option<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiLiveEventPayload {
    pub kind: &'static str, // "noteOn" | "noteOff" | "sustain" | "volume"
    pub midi: u8,
    pub velocity: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParsedMidiMsg {
    NoteOn { key: u8, velocity: u8 },
    NoteOff { key: u8 },
    Sustain { value: u8 },
    Volume { value: u8 },
}

/// Infer keyboard key count from a USB MIDI device name when possible.
pub fn infer_key_count_from_name(name: &str) -> Option<u8> {
    let lower = name.to_lowercase();
    if lower.contains("88") {
        Some(88)
    } else if lower.contains("61") {
        Some(61)
    } else if lower.contains("49") {
        Some(49)
    } else if lower.contains("37") {
        Some(37)
    } else if lower.contains("32") || lower.contains("m32") || lower.contains("keystep") {
        Some(32)
    } else if lower.contains("25") {
        Some(25)
    } else {
        None
    }
}

/// Parse raw MIDI 1.0 channel voice bytes into NoteOn, NoteOff, or Sustain (CC64).
/// System realtime/common/sysex messages (0xF0..=0xFF) are ignored silently.
pub fn parse_midi_message(msg: &[u8]) -> Option<ParsedMidiMsg> {
    if msg.is_empty() || msg[0] >= 0xF0 {
        return None;
    }

    let status = msg[0] & 0xF0;
    match status {
        0x90 => {
            if msg.len() < 3 {
                return None;
            }
            let key = msg[1] & 0x7F;
            let velocity = msg[2] & 0x7F;
            if velocity > 0 {
                Some(ParsedMidiMsg::NoteOn { key, velocity })
            } else {
                Some(ParsedMidiMsg::NoteOff { key })
            }
        }
        0x80 => {
            if msg.len() < 2 {
                return None;
            }
            let key = msg[1] & 0x7F;
            Some(ParsedMidiMsg::NoteOff { key })
        }
        0xB0 => {
            if msg.len() < 3 {
                return None;
            }
            let controller = msg[1] & 0x7F;
            let value = msg[2] & 0x7F;
            match controller {
                64 => Some(ParsedMidiMsg::Sustain { value }),
                7 => Some(ParsedMidiMsg::Volume { value }),
                _ => None,
            }
        }
        _ => None,
    }
}

struct MidiInputManagerState {
    connection: Option<MidiInputConnection<()>>,
    connected_port_name: Option<String>,
}

#[derive(Clone)]
pub struct MidiInputManager {
    state: Arc<Mutex<MidiInputManagerState>>,
    engine: AudioEngineHandle,
}

impl MidiInputManager {
    pub fn new(engine: AudioEngineHandle) -> Self {
        Self {
            state: Arc::new(Mutex::new(MidiInputManagerState {
                connection: None,
                connected_port_name: None,
            })),
            engine,
        }
    }

    pub fn list_devices() -> Result<Vec<MidiDeviceInfo>, String> {
        let midi_in = MidiInput::new("Aurelia MIDI Probe")
            .map_err(|e| format!("Failed to initialize MIDI probe: {}", e))?;
        let mut devices = Vec::new();
        for port in midi_in.ports() {
            if let Ok(name) = midi_in.port_name(&port) {
                devices.push(MidiDeviceInfo {
                    suggested_key_count: infer_key_count_from_name(&name),
                    name,
                });
            }
        }
        Ok(devices)
    }

    pub fn connect(&self, port_name: &str, app: AppHandle) -> Result<MidiDeviceInfo, String> {
        // Drop any existing connection first so the port is released cleanly.
        self.disconnect();

        let mut midi_in = MidiInput::new("Aurelia MIDI Input")
            .map_err(|e| format!("Failed to initialize MIDI input: {}", e))?;
        midi_in.ignore(Ignore::SysexAndTime);

        let port = midi_in
            .ports()
            .into_iter()
            .find(|p| midi_in.port_name(p).ok().as_deref() == Some(port_name))
            .ok_or_else(|| format!("MIDI device '{}' not found", port_name))?;

        let engine_cb = self.engine.clone();
        let app_cb = app;

        let conn = midi_in
            .connect(
                &port,
                "aurelia-midi-in",
                move |_stamp, message, _| {
                    if let Some(parsed) = parse_midi_message(message) {
                        match parsed {
                            ParsedMidiMsg::NoteOn { key, velocity } => {
                                let _ = engine_cb.send(AudioCommand::LiveNoteOn { key, velocity });
                                let _ = app_cb.emit(
                                    "midi:live-event",
                                    MidiLiveEventPayload {
                                        kind: "noteOn",
                                        midi: key,
                                        velocity,
                                    },
                                );
                            }
                            ParsedMidiMsg::NoteOff { key } => {
                                let _ = engine_cb.send(AudioCommand::LiveNoteOff { key });
                                let _ = app_cb.emit(
                                    "midi:live-event",
                                    MidiLiveEventPayload {
                                        kind: "noteOff",
                                        midi: key,
                                        velocity: 0,
                                    },
                                );
                            }
                            ParsedMidiMsg::Sustain { value } => {
                                let _ = engine_cb.send(AudioCommand::LiveControlChange {
                                    controller: 64,
                                    value,
                                });
                                let _ = app_cb.emit(
                                    "midi:live-event",
                                    MidiLiveEventPayload {
                                        kind: "sustain",
                                        midi: 64,
                                        velocity: value,
                                    },
                                );
                            }
                            ParsedMidiMsg::Volume { value } => {
                                let normalized = (value as f32) / 127.0;
                                let _ = engine_cb.send(AudioCommand::SetLiveVolume(normalized));
                                let _ = app_cb.emit(
                                    "midi:live-event",
                                    MidiLiveEventPayload {
                                        kind: "volume",
                                        midi: 7,
                                        velocity: value,
                                    },
                                );
                            }
                        }
                    }
                },
                (),
            )
            .map_err(|e| format!("Failed to connect to MIDI device '{}': {}", port_name, e))?;

        let mut guard = self
            .state
            .lock()
            .map_err(|_| "MIDI input state lock poisoned".to_string())?;
        guard.connection = Some(conn);
        guard.connected_port_name = Some(port_name.to_string());

        Ok(MidiDeviceInfo {
            name: port_name.to_string(),
            suggested_key_count: infer_key_count_from_name(port_name),
        })
    }

    pub fn disconnect(&self) {
        if let Ok(mut guard) = self.state.lock() {
            guard.connection.take();
            guard.connected_port_name = None;
        }
        let _ = self.engine.send(AudioCommand::LiveAllNotesOff);
    }

    pub fn connected_device(&self) -> Option<String> {
        self.state
            .lock()
            .ok()
            .and_then(|g| g.connected_port_name.clone())
    }

    pub fn start_hotplug_watcher(manager: MidiInputManager, app: AppHandle) {
        std::thread::Builder::new()
            .name("aurelia-midi-hotplug".to_string())
            .spawn(move || {
                let mut last_names: Vec<String> = Vec::new();
                if let Ok(initial) = Self::list_devices() {
                    last_names = initial.into_iter().map(|d| d.name).collect();
                    last_names.sort();
                }

                loop {
                    std::thread::sleep(Duration::from_millis(2000));

                    if let Ok(devices) = Self::list_devices() {
                        let mut current_names: Vec<String> =
                            devices.iter().map(|d| d.name.clone()).collect();
                        current_names.sort();

                        if current_names != last_names {
                            last_names = current_names.clone();
                            let _ = app.emit("midi:devices-changed", &devices);

                            if let Some(active_name) = manager.connected_device() {
                                if !current_names.contains(&active_name) {
                                    manager.disconnect();
                                    let _ = app.emit("midi:disconnected", active_name);
                                }
                            }
                        }
                    }
                }
            })
            .ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_note_on_and_off() {
        assert_eq!(
            parse_midi_message(&[0x90, 60, 100]),
            Some(ParsedMidiMsg::NoteOn {
                key: 60,
                velocity: 100
            })
        );
        // Channel 3 NoteOn
        assert_eq!(
            parse_midi_message(&[0x92, 64, 85]),
            Some(ParsedMidiMsg::NoteOn {
                key: 64,
                velocity: 85
            })
        );
        // NoteOn with velocity 0 is NoteOff
        assert_eq!(
            parse_midi_message(&[0x90, 60, 0]),
            Some(ParsedMidiMsg::NoteOff { key: 60 })
        );
        // Explicit NoteOff
        assert_eq!(
            parse_midi_message(&[0x80, 60, 64]),
            Some(ParsedMidiMsg::NoteOff { key: 60 })
        );
    }

    #[test]
    fn parses_sustain_pedal_cc64() {
        assert_eq!(
            parse_midi_message(&[0xB0, 64, 127]),
            Some(ParsedMidiMsg::Sustain { value: 127 })
        );
        assert_eq!(
            parse_midi_message(&[0xB1, 64, 0]),
            Some(ParsedMidiMsg::Sustain { value: 0 })
        );
        // Other CCs (e.g. modulation CC1) are ignored
        assert_eq!(parse_midi_message(&[0xB0, 1, 64]), None);
    }

    #[test]
    fn parses_volume_slider_cc7() {
        assert_eq!(
            parse_midi_message(&[0xB0, 7, 100]),
            Some(ParsedMidiMsg::Volume { value: 100 })
        );
        assert_eq!(
            parse_midi_message(&[0xB2, 7, 0]),
            Some(ParsedMidiMsg::Volume { value: 0 })
        );
        assert_eq!(
            parse_midi_message(&[0xB0, 7, 127]),
            Some(ParsedMidiMsg::Volume { value: 127 })
        );
    }

    #[test]
    fn ignores_clock_sysex_and_invalid_messages() {
        assert_eq!(parse_midi_message(&[0xF8]), None); // Timing Clock
        assert_eq!(parse_midi_message(&[0xFE]), None); // Active Sensing
        assert_eq!(parse_midi_message(&[0xF0, 0x7E, 0x7F, 0xF7]), None); // SysEx
        assert_eq!(parse_midi_message(&[]), None);
        assert_eq!(parse_midi_message(&[0x90, 60]), None); // Truncated NoteOn
    }

    #[test]
    fn infers_key_count_from_device_names() {
        assert_eq!(infer_key_count_from_name("Komplete Kontrol M32"), Some(32));
        assert_eq!(infer_key_count_from_name("Arturia KeyStep"), Some(32));
        assert_eq!(infer_key_count_from_name("Arturia KeyStep 37"), Some(37));
        assert_eq!(infer_key_count_from_name("MPK Mini 25"), Some(25));
        assert_eq!(infer_key_count_from_name("Launchkey 49 MK3"), Some(49));
        assert_eq!(infer_key_count_from_name("Keystation 61"), Some(61));
        assert_eq!(infer_key_count_from_name("Studiologic SL88"), Some(88));
        assert_eq!(infer_key_count_from_name("IAC Driver Bus 1"), None);
    }

    #[test]
    fn list_devices_succeeds_without_error() {
        let devices = MidiInputManager::list_devices().expect("list_devices should not fail");
        println!("Detected MIDI devices: {:?}", devices);
    }
}
