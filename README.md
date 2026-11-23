# Aurelia

A fast, native desktop MIDI piano visualizer and practice studio built with **Tauri 2**, **Rust**, **React**, and **Three.js (React Three Fiber)**.

## Features

- **60fps 3D Waterfall & 88-Key Piano:** Instanced WebGL rendering with selective bloom, hit-glow particles, key depression physics, and customizable themes.
- **Native Rust Audio Engine:** Low-latency SoundFont synthesis via `cpal` and `rustysynth` with studio reverb, touch presets, and support for custom `.sf2` SoundFonts.
- **Hardware USB MIDI Input:** Plug-and-play `midir` input with direct Rust-to-Rust audio routing, sustain pedal (`CC64`) support, compact keyboard range dimming (`25 / 32 / 37 / 49 / 61 / 88` keys), and automatic octave-window tracking.
- **Study Mode (Wait-for-Input):** Pauses the waterfall at the hit line until you play the expected note(s) via USB MIDI, mouse, or QWERTY keyboard—supporting hand separation (`Left Only`, `Right Only`, `Both Hands`), chord grouping, and early-hit forgiveness.
- **Practice & Library Tools:** Folder-watched MIDI library with SQLite persistence, hover audio previews, A–B looping, tempo scaling (`0.25x–2.0x`), track-level hand assignment / pitch split, and customizable keyboard shortcuts (`⌘/`).

## Getting Started

### Prerequisites

- **Node.js** (v18+)
- **Rust** toolchain (`rustup` / `cargo`)
- **SoundFont (`.sf2`):** Large `.sf2` files are excluded from Git. Place a SoundFont (e.g. `piano.sf2` or `YDP-GrandPiano-20160804.sf2`) in `src-tauri/resources/` or `src-tauri/resources/soundfonts/`, or import one directly from the in-app **Appearance & Studio** popover.

### Development

```bash
npm install
npm run tauri dev
```

### Production Build & Checks

```bash
npx tsc --noEmit
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

## License & Attributions

See [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) for open-source library and SoundFont attributions.
