import React, { useRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { useThemeStore } from "@/stores/useThemeStore";
import { useViewStore } from "@/stores/useViewStore";
import { playbackClock } from "@/engine/playbackClock";
import { activeNotes } from "@/engine/activeNotes";
import { freeplayNotes } from "@/engine/freeplayNotes";
import { getKeyByMidi, resolveNoteHand } from "@/engine/pianoLayout";
import { createNoteShaderMaterial } from "./noteShader";
import type { MidiNote } from "@/types/midi";

const MAX_VISIBLE_NOTES = 2048;

function findStartIndex(notes: MidiNote[], targetSec: number): number {
  let low = 0;
  let high = notes.length - 1;
  let result = notes.length;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (notes[mid].startSec >= targetSec) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return result;
}

export const FallingNotes: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Pre-allocate temporary objects to ensure ZERO garbage collection in useFrame
  const tempObject = useMemo(() => new THREE.Object3D(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);
  const rightThreeColor = useMemo(() => new THREE.Color(), []);
  const leftThreeColor = useMemo(() => new THREE.Color(), []);

  // Pre-allocated instanced attribute buffers (zero GC in useFrame)
  const noteDimsArray = useMemo(() => new Float32Array(MAX_VISIBLE_NOTES * 2), []);
  const noteColorArray = useMemo(() => new Float32Array(MAX_VISIBLE_NOTES * 3), []);
  const noteStrikeArray = useMemo(() => new Float32Array(MAX_VISIBLE_NOTES), []);

  const dimsAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(noteDimsArray, 2),
    [noteDimsArray]
  );
  const colorAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(noteColorArray, 3),
    [noteColorArray]
  );
  const strikeAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(noteStrikeArray, 1),
    [noteStrikeArray]
  );

  // Shared geometry & SDF shader material
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute("aNoteDims", dimsAttr);
    geo.setAttribute("aNoteColor", colorAttr);
    geo.setAttribute("aStrike", strikeAttr);
    return geo;
  }, [dimsAttr, colorAttr, strikeAttr]);

  const material = useMemo(() => createNoteShaderMaterial(), []);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame(({ size }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const pxPerWorldX = Math.max(1, size.width) / 52;
    const pxPerWorldY = Math.max(1, size.height) / 100;
    material.uniforms.uPxPerWorld.value.set(pxPerWorldX, pxPerWorldY);

    const { rightHandColor, leftHandColor, lookaheadSec, noteGlowEnabled } =
      useThemeStore.getState();

    const haloPadPx = noteGlowEnabled ? 13.0 : 0.0;
    material.uniforms.uHaloPadPx.value = haloPadPx;
    const padWorldX = haloPadPx / pxPerWorldX;
    const padWorldY = haloPadPx / pxPerWorldY;

    // In Home view, waterfall is hidden behind HomeExplorer, and ListPreviewDriver controls activeNotes
    const viewMode = useViewStore.getState().viewMode;
    if (viewMode === "home") {
      activeNotes.clearSong();
      if (mesh.count > 0) {
        mesh.count = 0;
        mesh.instanceMatrix.needsUpdate = true;
      }
      return;
    }

    // Clear song active keys buffer for this frame
    activeNotes.clearSong();

    rightThreeColor.set(rightHandColor);
    leftThreeColor.set(leftHandColor);

    // Waterfall: Y=18 (hit line) to Y=100 (top). Total waterfall height = 82
    const pixelsPerSec = 82 / Math.max(0.5, lookaheadSec);

    const pushNoteInstance = (
      count: number,
      midi: number,
      visibleBottom: number,
      visibleTop: number,
      hand: 1 | 2,
      isHandActive: boolean,
      isStriking: boolean,
      anchorBottomToHitLine: boolean
    ): number => {
      if (count >= MAX_VISIBLE_NOTES) return count;
      const key = getKeyByMidi(midi);
      if (!key) return count;

      const rawHeight = visibleTop - visibleBottom;
      const noteHeight = Math.max(0.25, rawHeight);
      const centerY =
        anchorBottomToHitLine && rawHeight < 0.25
          ? 18 + noteHeight * 0.5
          : (visibleBottom + visibleTop) * 0.5;
      const noteWidth = key.width * 0.88;
      const z = key.isBlack ? 0.35 : 0.25;

      tempObject.position.set(key.centerX, centerY, z);
      tempObject.scale.set(
        noteWidth + padWorldX * 2,
        noteHeight + padWorldY * 2,
        1
      );
      tempObject.updateMatrix();
      mesh.setMatrixAt(count, tempObject.matrix);

      const dimsOffset = count * 2;
      noteDimsArray[dimsOffset] = noteWidth;
      noteDimsArray[dimsOffset + 1] = noteHeight;

      const baseColor = hand === 1 ? rightThreeColor : leftThreeColor;
      const colorOffset = count * 3;

      if (!isHandActive) {
        // Ghosted appearance: faint 18% tint of the hand color so it's subtly visible without distracting
        tempColor.copy(baseColor).multiplyScalar(0.18);
        noteStrikeArray[count] = 0.0;
      } else {
        noteStrikeArray[count] = isStriking ? 1.0 : 0.0;
        if (key.isBlack) {
          tempColor.copy(baseColor).multiplyScalar(0.86);
        } else {
          tempColor.copy(baseColor);
        }
      }

      noteColorArray[colorOffset] = tempColor.r;
      noteColorArray[colorOffset + 1] = tempColor.g;
      noteColorArray[colorOffset + 2] = tempColor.b;

      return count + 1;
    };

    if (viewMode === "freeplay") {
      const now = performance.now() / 1000;
      freeplayNotes.prune(now - Math.max(0.5, lookaheadSec) - 0.1);
      const liveNotes = freeplayNotes.getNotes();

      let count = 0;
      for (let i = 0; i < liveNotes.length; i++) {
        const note = liveNotes[i];
        const isHeld = note.endSec === null;
        const bottomY = isHeld ? 18 : 18 + (now - note.endSec!) * pixelsPerSec;
        const topY = 18 + (now - note.startSec) * pixelsPerSec;

        const visibleBottom = Math.max(18, bottomY);
        const visibleTop = Math.min(100, topY);
        if (visibleTop <= visibleBottom) {
          continue;
        }

        count = pushNoteInstance(
          count,
          note.midi,
          visibleBottom,
          visibleTop,
          note.hand,
          true,
          isHeld,
          isHeld
        );
        if (count >= MAX_VISIBLE_NOTES) {
          break;
        }
      }

      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (count > 0) {
        dimsAttr.needsUpdate = true;
        colorAttr.needsUpdate = true;
        strikeAttr.needsUpdate = true;
      }
      return;
    }

    const now = playbackClock.getTime();
    const activeSong = useLibraryStore.getState().activeSong;
    const {
      rightHandActive,
      leftHandActive,
      trackHands,
      splitPointMidi,
      useSplitPoint,
      transposeSemitones,
    } = usePlaybackStore.getState();

    if (!activeSong || activeSong.notes.length === 0) {
      if (mesh.count > 0) {
        mesh.count = 0;
        mesh.instanceMatrix.needsUpdate = true;
      }
      return;
    }

    const notes = activeSong.notes;

    // Search window: notes starting up to 20s prior to now (for long sustained notes)
    const startIndex = findStartIndex(notes, Math.max(0, now - 20));
    let count = 0;

    for (let i = startIndex; i < notes.length; i++) {
      const note = notes[i];
      if (note.startSec > now + lookaheadSec) {
        break; // All subsequent notes are far above the waterfall
      }

      const noteEndSec = note.startSec + note.durationSec;
      if (noteEndSec < now) {
        continue; // Finished playing
      }

      const shiftedMidi = note.midi + transposeSemitones;
      if (shiftedMidi < 21 || shiftedMidi > 108) {
        continue;
      }

      const hand = resolveNoteHand(
        note,
        trackHands,
        splitPointMidi,
        useSplitPoint,
        shiftedMidi
      );
      if (hand === "none") {
        continue;
      }

      const isHandActive =
        (hand === "right" && rightHandActive) ||
        (hand === "left" && leftHandActive);

      // Active key hit registration (when note is striking the hit line right now)
      if (note.startSec <= now && noteEndSec >= now && isHandActive) {
        const keyIdx = shiftedMidi - 21;
        if (keyIdx >= 0 && keyIdx < 88) {
          activeNotes.songHand[keyIdx] = hand === "right" ? 1 : 2;
          const vel = note.velocity / 127;
          if (vel > activeNotes.songVelocity[keyIdx]) {
            activeNotes.songVelocity[keyIdx] = vel;
          }
        }
      }

      // Waterfall vertical position calculation
      const bottomY = 18 + (note.startSec - now) * pixelsPerSec;
      const topY = 18 + (noteEndSec - now) * pixelsPerSec;

      const visibleBottom = Math.max(18, bottomY);
      const visibleTop = Math.min(100, topY);

      if (visibleTop <= visibleBottom) {
        continue;
      }

      const isStrikingHitLine = note.startSec <= now && noteEndSec >= now;
      count = pushNoteInstance(
        count,
        shiftedMidi,
        visibleBottom,
        visibleTop,
        hand === "right" ? 1 : 2,
        isHandActive,
        isStrikingHitLine,
        false
      );
      if (count >= MAX_VISIBLE_NOTES) {
        break;
      }
    }

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    dimsAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    strikeAttr.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_VISIBLE_NOTES]}
      frustumCulled={false}
    />
  );
};
