use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SoundFontInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size_mb: f64,
    pub is_bundled: bool,
}

pub fn format_soundfont_name(filename: &str) -> String {
    let lower = filename.to_lowercase();
    if lower.contains("ydp") {
        return "YDP Grand Piano".to_string();
    }
    if lower.contains("salamander") {
        if lower.contains("v3") {
            return "Salamander Grand Piano V3".to_string();
        } else {
            return "Salamander Grand Piano".to_string();
        }
    }
    if lower.contains("upright") {
        return "Upright Piano KW".to_string();
    }
    if lower == "piano.sf2" || lower == "piano" {
        return "General MIDI Piano".to_string();
    }

    let stem = if let Some(dot_idx) = filename.rfind('.') {
        &filename[..dot_idx]
    } else {
        filename
    };

    let with_spaces = stem.replace(['_', '-', '+'], " ");
    let mut result = String::new();
    let mut prev_char: Option<char> = None;

    for ch in with_spaces.chars() {
        if let Some(prev) = prev_char {
            if prev.is_lowercase() && ch.is_uppercase() {
                result.push(' ');
            }
        }
        result.push(ch);
        prev_char = Some(ch);
    }

    let words: Vec<&str> = result
        .split_whitespace()
        .filter(|w| {
            let is_date = w.len() == 8 && w.chars().all(|c| c.is_ascii_digit());
            let is_sf2 = w.eq_ignore_ascii_case("sf2");
            !is_date && !is_sf2
        })
        .collect();

    if words.is_empty() {
        return stem.to_string();
    }

    words.join(" ")
}

pub fn validate_soundfont_header(path: &Path) -> Result<(), String> {
    let mut file = File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut header = [0u8; 12];
    file.read_exact(&mut header)
        .map_err(|e| format!("File too small to be a valid SoundFont: {}", e))?;

    if &header[0..4] != b"RIFF" || &header[8..12] != b"sfbk" {
        return Err("File is not a valid SF2 SoundFont (missing RIFF/sfbk header)".to_string());
    }
    Ok(())
}

pub fn import_soundfont_file(source: &Path, user_dir: &Path) -> Result<SoundFontInfo, String> {
    if !source.exists() || !source.is_file() {
        return Err(format!("Source SoundFont file does not exist: {:?}", source));
    }

    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext != "sf2" {
        return Err("File must have a .sf2 extension".to_string());
    }

    validate_soundfont_header(source)?;

    std::fs::create_dir_all(user_dir)
        .map_err(|e| format!("Failed to create user soundfonts directory: {}", e))?;

    let file_name = source
        .file_name()
        .ok_or_else(|| "Invalid source file name".to_string())?;
    let dest_path = user_dir.join(file_name);

    if source != dest_path {
        std::fs::copy(source, &dest_path)
            .map_err(|e| format!("Failed to copy SoundFont file: {}", e))?;
    }

    let metadata = std::fs::metadata(&dest_path)
        .map_err(|e| format!("Failed to read metadata: {}", e))?;
    let size_mb = ((metadata.len() as f64) / (1024.0 * 1024.0) * 10.0).round() / 10.0;
    let file_name_str = file_name.to_string_lossy();
    let name = format_soundfont_name(&file_name_str);
    let canonical = std::fs::canonicalize(&dest_path).unwrap_or_else(|_| dest_path.clone());
    let path_str = canonical.to_string_lossy().to_string();

    Ok(SoundFontInfo {
        id: path_str.clone(),
        name,
        path: path_str,
        size_mb,
        is_bundled: false,
    })
}

pub fn delete_soundfont_file(path: &Path, user_dir: &Path) -> Result<(), String> {
    if !user_dir.exists() {
        return Err("User soundfonts directory does not exist".to_string());
    }
    let canonical_user_dir = std::fs::canonicalize(user_dir)
        .map_err(|e| format!("Failed to resolve user soundfonts directory: {}", e))?;
    let canonical_target = std::fs::canonicalize(path)
        .map_err(|e| format!("SoundFont file not found: {}", e))?;

    if !canonical_target.starts_with(&canonical_user_dir) || canonical_target == canonical_user_dir {
        return Err("Bundled or external SoundFonts cannot be deleted".to_string());
    }
    if !canonical_target.is_file() {
        return Err("Target path is not a file".to_string());
    }
    let ext = canonical_target
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext != "sf2" {
        return Err("Only .sf2 SoundFont files can be deleted".to_string());
    }

    std::fs::remove_file(&canonical_target)
        .map_err(|e| format!("Failed to delete SoundFont file: {}", e))
}

pub fn discover_soundfonts(bundled_dirs: &[PathBuf], user_dir: &Path) -> Vec<SoundFontInfo> {
    use std::collections::HashSet;

    let mut result = Vec::new();
    let mut seen_paths = HashSet::new();

    let mut scan_dir = |dir: &Path, is_bundled: bool| {
        if !dir.exists() {
            return;
        }

        if dir.is_file() {
            if let Some(ext) = dir.extension() {
                if ext.to_string_lossy().eq_ignore_ascii_case("sf2") {
                    if let Ok(canonical) = std::fs::canonicalize(dir) {
                        let path_str = canonical.to_string_lossy().to_string();
                        if seen_paths.insert(path_str.clone()) {
                            if let Ok(meta) = std::fs::metadata(&canonical) {
                                let size_mb = ((meta.len() as f64) / (1024.0 * 1024.0) * 10.0).round() / 10.0;
                                let file_name = canonical
                                    .file_name()
                                    .map(|f| f.to_string_lossy().to_string())
                                    .unwrap_or_else(|| "SoundFont".to_string());
                                let name = format_soundfont_name(&file_name);
                                result.push(SoundFontInfo {
                                    id: path_str.clone(),
                                    name,
                                    path: path_str,
                                    size_mb,
                                    is_bundled,
                                });
                            }
                        }
                    }
                }
            }
            return;
        }

        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(ext) = path.extension() {
                        if ext.to_string_lossy().eq_ignore_ascii_case("sf2") {
                            if let Ok(canonical) = std::fs::canonicalize(&path) {
                                let path_str = canonical.to_string_lossy().to_string();
                                if seen_paths.insert(path_str.clone()) {
                                    if let Ok(meta) = std::fs::metadata(&canonical) {
                                        let size_mb = ((meta.len() as f64) / (1024.0 * 1024.0) * 10.0).round() / 10.0;
                                        let file_name = canonical
                                            .file_name()
                                            .map(|f| f.to_string_lossy().to_string())
                                            .unwrap_or_else(|| "SoundFont".to_string());
                                        let name = format_soundfont_name(&file_name);
                                        result.push(SoundFontInfo {
                                            id: path_str.clone(),
                                            name,
                                            path: path_str,
                                            size_mb,
                                            is_bundled,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    };

    for b_dir in bundled_dirs {
        scan_dir(b_dir, true);
    }
    scan_dir(user_dir, false);

    result.sort_by(|a, b| {
        let priority = |name: &str| -> usize {
            let lower = name.to_lowercase();
            if lower.contains("ydp") {
                0
            } else if lower.contains("salamander") {
                1
            } else if lower.contains("upright") {
                2
            } else {
                3
            }
        };

        let p_a = priority(&a.name);
        let p_b = priority(&b.name);
        p_a.cmp(&p_b).then_with(|| a.name.cmp(&b.name))
    });

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_format_soundfont_name() {
        assert_eq!(
            format_soundfont_name("YDP-GrandPiano-20160804.sf2"),
            "YDP Grand Piano"
        );
        assert_eq!(
            format_soundfont_name("SalamanderGrandPiano-SF2-V3+20200602.sf2"),
            "Salamander Grand Piano V3"
        );
        assert_eq!(
            format_soundfont_name("SalamanderGrandPiano.sf2"),
            "Salamander Grand Piano"
        );
        assert_eq!(
            format_soundfont_name("UprightPianoKW-20190703.sf2"),
            "Upright Piano KW"
        );
        assert_eq!(format_soundfont_name("piano.sf2"), "General MIDI Piano");
        assert_eq!(format_soundfont_name("piano"), "General MIDI Piano");
        assert_eq!(
            format_soundfont_name("FazioliConcertGrand.sf2"),
            "Fazioli Concert Grand"
        );
    }

    #[test]
    fn test_soundfont_header_validation_and_import() {
        let temp_dir = std::env::temp_dir().join("aurelia_sf2_test");
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();

        let invalid_path = temp_dir.join("invalid.sf2");
        let mut f = File::create(&invalid_path).unwrap();
        f.write_all(b"not a valid riff soundfont").unwrap();
        drop(f);

        assert!(validate_soundfont_header(&invalid_path).is_err());

        // Create a valid dummy RIFF sfbk file (12 bytes min)
        let valid_path = temp_dir.join("ValidPiano.sf2");
        let mut f2 = File::create(&valid_path).unwrap();
        let mut dummy = Vec::new();
        dummy.extend_from_slice(b"RIFF");
        dummy.extend_from_slice(&100u32.to_le_bytes());
        dummy.extend_from_slice(b"sfbk");
        dummy.resize(100, 0);
        f2.write_all(&dummy).unwrap();
        drop(f2);

        assert!(validate_soundfont_header(&valid_path).is_ok());

        let user_soundfonts = temp_dir.join("user_soundfonts");
        let imported = import_soundfont_file(&valid_path, &user_soundfonts).unwrap();
        assert_eq!(imported.name, "Valid Piano");
        assert!(!imported.is_bundled);
        assert!(PathBuf::from(&imported.path).exists());

        // Test discovery
        let discovered = discover_soundfonts(&[], &user_soundfonts);
        assert_eq!(discovered.len(), 1);
        assert_eq!(discovered[0].name, "Valid Piano");

        // Deleting outside user_soundfonts must fail
        assert!(delete_soundfont_file(&valid_path, &user_soundfonts).is_err());
        assert!(valid_path.exists());

        // Deleting imported file inside user_soundfonts succeeds
        delete_soundfont_file(Path::new(&imported.path), &user_soundfonts).unwrap();
        assert!(!PathBuf::from(&imported.path).exists());
        assert!(discover_soundfonts(&[], &user_soundfonts).is_empty());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
