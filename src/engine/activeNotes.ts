import { freeplayNotes } from "@/engine/freeplayNotes";

export class ActiveNotesBuffer {
  // 88 keys: 0..87 mapped from midi 21..108
  // Song playback layer: populated per frame by FallingNotes
  readonly songHand = new Uint8Array(88);
  readonly songVelocity = new Float32Array(88);

  // Live free-play layer: populated by pointer/QWERTY live input
  readonly liveHand = new Uint8Array(88);
  readonly liveVelocity = new Float32Array(88);

  // Study Mode waiting-key layer: 0=none, 1=right, 2=left
  readonly waitingHand = new Uint8Array(88);

  clearSong(): void {
    this.songHand.fill(0);
    this.songVelocity.fill(0);
  }

  setWaitingKeys(list: Array<{ midi: number; hand: number }>): void {
    this.waitingHand.fill(0);
    for (let i = 0; i < list.length; i++) {
      const idx = list[i].midi - 21;
      if (idx >= 0 && idx < 88) {
        this.waitingHand[idx] = list[i].hand;
      }
    }
  }

  clearWaiting(): void {
    this.waitingHand.fill(0);
  }

  setLiveNote(midi: number, hand: 1 | 2, velocity: number): void {
    const idx = midi - 21;
    if (idx < 0 || idx >= 88) return;
    this.liveHand[idx] = hand;
    this.liveVelocity[idx] = velocity;
    freeplayNotes.noteOn(midi, hand, velocity);
  }

  clearLiveNote(midi: number): void {
    const idx = midi - 21;
    if (idx < 0 || idx >= 88) return;
    this.liveHand[idx] = 0;
    this.liveVelocity[idx] = 0;
    freeplayNotes.noteOff(midi);
  }

  clearAllLive(): void {
    this.liveHand.fill(0);
    this.liveVelocity.fill(0);
    freeplayNotes.releaseAll();
  }

  getHand(keyIndex: number): number {
    return this.liveHand[keyIndex] !== 0
      ? this.liveHand[keyIndex]
      : this.songHand[keyIndex];
  }

  getVelocity(keyIndex: number): number {
    return this.liveHand[keyIndex] !== 0
      ? this.liveVelocity[keyIndex]
      : this.songVelocity[keyIndex];
  }

  // Backward compatibility helpers
  clear(): void {
    this.clearSong();
  }
}

export const activeNotes = new ActiveNotesBuffer();
