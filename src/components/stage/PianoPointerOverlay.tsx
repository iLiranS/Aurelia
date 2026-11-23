import React, { useRef, useEffect, useCallback } from "react";
import { hitTestPianoKey } from "@/engine/pianoLayout";
import { activeNotes } from "@/engine/activeNotes";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { useMidiStore } from "@/stores/useMidiStore";
import { audioLiveNoteOn, audioLiveNoteOff, audioLiveAllNotesOff } from "@/services/tauriApi";

export const PianoPointerOverlay: React.FC = () => {
  const activePointerMidiRef = useRef<number | null>(null);
  const isPointerDownRef = useRef<boolean>(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const releaseActiveNote = useCallback(() => {
    if (activePointerMidiRef.current !== null) {
      const midi = activePointerMidiRef.current;
      activePointerMidiRef.current = null;
      activeNotes.clearLiveNote(midi);
      audioLiveNoteOff(midi);
    }
  }, []);

  const triggerNote = useCallback((midi: number, relY: number) => {
    const velocity = Math.min(127, Math.max(35, Math.round(75 + relY * 45)));
    const splitPointMidi = usePlaybackStore.getState().splitPointMidi;
    const hand: 1 | 2 = midi >= splitPointMidi ? 1 : 2;

    activePointerMidiRef.current = midi;
    activeNotes.setLiveNote(midi, hand, velocity / 127);
    audioLiveNoteOn(midi, velocity);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only primary mouse button or touch
    isPointerDownRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const worldX = ((e.clientX - rect.left) / rect.width) * 52;
    const relY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    const key = hitTestPianoKey(worldX, relY);
    if (key) {
      triggerNote(key.midi, relY);
      if (e.altKey) {
        const vel = Math.min(127, Math.max(35, Math.round(75 + relY * 45)));
        useMidiStore.getState().handleMidiLiveEvent({
          kind: "noteOn",
          midi: key.midi,
          velocity: vel,
        });
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const worldX = ((e.clientX - rect.left) / rect.width) * 52;
    const relY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    const key = hitTestPianoKey(worldX, relY);

    if (key) {
      if (key.midi !== activePointerMidiRef.current) {
        // Glissando drag transition: release old note, trigger new note
        releaseActiveNote();
        triggerNote(key.midi, relY);
      }
    } else {
      // Pointer moved off keyboard area
      releaseActiveNote();
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isPointerDownRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    releaseActiveNote();
  };

  const handlePointerCancel = () => {
    isPointerDownRef.current = false;
    releaseActiveNote();
  };

  // Window blur or tab switch cleanup
  useEffect(() => {
    const handleBlur = () => {
      isPointerDownRef.current = false;
      releaseActiveNote();
      audioLiveAllNotesOff();
    };

    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("blur", handleBlur);
      releaseActiveNote();
      activeNotes.clearAllLive();
      audioLiveAllNotesOff();
    };
  }, [releaseActiveNote]);

  return (
    <div
      ref={overlayRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={(e) => e.stopPropagation()}
      className="absolute bottom-0 left-0 right-0 h-[18%] z-20 cursor-pointer touch-none select-none"
      aria-label="Interactive Piano Keyboard"
      role="region"
    />
  );
};
