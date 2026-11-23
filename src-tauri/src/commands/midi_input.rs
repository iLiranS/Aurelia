use tauri::{AppHandle, State};

use crate::midi::input::{MidiDeviceInfo, MidiInputManager};

#[tauri::command]
pub fn list_midi_devices() -> Result<Vec<MidiDeviceInfo>, String> {
    MidiInputManager::list_devices()
}

#[tauri::command]
pub fn connect_midi_device(
    app: AppHandle,
    manager: State<'_, MidiInputManager>,
    port_name: String,
) -> Result<MidiDeviceInfo, String> {
    manager.connect(&port_name, app)
}

#[tauri::command]
pub fn disconnect_midi_device(manager: State<'_, MidiInputManager>) -> Result<(), String> {
    manager.disconnect();
    Ok(())
}

#[tauri::command]
pub fn get_connected_midi_device(
    manager: State<'_, MidiInputManager>,
) -> Result<Option<String>, String> {
    Ok(manager.connected_device())
}
