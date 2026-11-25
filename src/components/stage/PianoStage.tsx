import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import { FallingNotes } from "./FallingNotes";
import { NoteHighlight } from "./NoteHighlight";
import { MeasureLines } from "./MeasureLines";
import { CountInOverlay } from "./CountInOverlay";
import { ListPreviewDriver } from "./ListPreviewDriver";
import { PianoKeyboard } from "./PianoKeyboard";
import { HitEffects } from "./HitEffects";
import { PianoPointerOverlay } from "./PianoPointerOverlay";
import { NoteLabelsOverlay } from "./NoteLabelsOverlay";
import { useThemeStore } from "@/stores/useThemeStore";
import { usePlaybackStore, cancelCountIn } from "@/stores/usePlaybackStore";
import { useMidiStore } from "@/stores/useMidiStore";
import { useViewStore } from "@/stores/useViewStore";
import { activeNotes } from "@/engine/activeNotes";
import { playbackClock } from "@/engine/playbackClock";
import { audioPause, audioPlay, audioSeek } from "@/services/tauriApi";
import {
  BLACK_KEYS,
  PIANO_KEYS,
  WHITE_KEYS,
  getKeyDisplayLabel,
  getKeySplitX,
  getNoteBaseName,
  getRangeBoundsX,
} from "@/engine/pianoLayout";

const C_WHITE_INDICES = [2, 9, 16, 23, 30, 37, 44, 51];

/**
 * Enforces the exact [0..52] x [0..100] normalized orthographic coordinate space
 * regardless of window resize or canvas aspect ratio changes.
 */
function StageCameraLock() {
  const { camera, size } = useThree();

  useLayoutEffect(() => {
    if (camera instanceof THREE.OrthographicCamera) {
      camera.left = 0;
      camera.right = 52;
      camera.top = 100;
      camera.bottom = 0;
      camera.near = -10;
      camera.far = 50;
      camera.position.set(0, 0, 10);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    }
  }, [camera, size]);

  return null;
}

/**
 * Faint vertical octave divider lanes extending across the waterfall
 */
const OctaveDividers: React.FC = () => {
  const showOctaveGuides = useThemeStore((s) => s.showOctaveGuides);
  const { size } = useThree();

  if (!showOctaveGuides) return null;

  const lineWidth = (1.25 / Math.max(1, size.width)) * 52;

  return (
    <group position={[0, 0, 0.05]}>
      {C_WHITE_INDICES.map((whiteIdx) => (
        <mesh key={whiteIdx} position={[whiteIdx, 59, 0]}>
          <planeGeometry args={[lineWidth, 82]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.085}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
};

/**
 * Visual split-by-pitch line across the waterfall when split mode is active
 */
const SplitPointGuide: React.FC = () => {
  const useSplitPoint = usePlaybackStore((s) => s.useSplitPoint);
  const splitPointMidi = usePlaybackStore((s) => s.splitPointMidi);
  const rightHandColor = useThemeStore((s) => s.rightHandColor);
  const { size } = useThree();

  if (!useSplitPoint) return null;

  const splitX = getKeySplitX(splitPointMidi);
  const lineWidth = (2.0 / Math.max(1, size.width)) * 52;

  return (
    <group position={[0, 0, 0.4]}>
      <mesh position={[splitX, 59, 0]}>
        <planeGeometry args={[lineWidth, 82]} />
        <meshBasicMaterial
          color={rightHandColor}
          transparent
          opacity={0.4}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
};

const ATMOSPHERE_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const AURORA_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uBgColor;
uniform vec3 uLeftColor;
uniform vec3 uRightColor;
uniform float uTime;
varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    v += amp * noise2D(p);
    p = p * 2.04 + vec2(11.3, 7.1);
    amp *= 0.5;
  }
  return v;
}

float starLayer(vec2 uv, float scale, float density, float time) {
  vec2 gv = fract(uv * scale) - 0.5;
  vec2 id = floor(uv * scale);
  float rnd = hash21(id);
  if (rnd < density) return 0.0;

  vec2 offset = vec2(hash21(id + 13.7), hash21(id + 29.3)) - 0.5;
  float d = length(gv - offset * 0.65);
  float size = mix(0.025, 0.055, fract(rnd * 31.7));
  float star = smoothstep(size, 0.0, d);

  float twinkleSpeed = mix(1.2, 2.8, fract(rnd * 17.3));
  float twinkle = 0.45 + 0.55 * sin(time * twinkleSpeed + rnd * 62.83);
  return star * twinkle;
}

void main() {
  // Subtle sweeping aurora curtains across the waterfall sky
  vec2 uv = vec2(vUv.x * 2.6, vUv.y * 1.4);
  float n = fbm(uv + vec2(uTime * 0.035, -uTime * 0.02));

  // Two soft diagonal aurora ribbons
  float r1 = sin(vUv.x * 4.2 + n * 3.4 + uTime * 0.14) * 0.5 + 0.5;
  float r2 = sin(vUv.x * 6.5 - n * 2.8 - uTime * 0.10 + 1.7) * 0.5 + 0.5;
  float curtain = pow(r1, 2.2) * 0.65 + pow(r2, 2.6) * 0.45;

  // Vertical envelope: softest near bottom mist and top edge, richest in mid-upper sky
  float vMask = smoothstep(0.05, 0.42, vUv.y) * smoothstep(1.0, 0.62, vUv.y);
  float intensity = curtain * vMask * (0.45 + 0.55 * n);

  vec3 auroraCol = mix(uLeftColor, uRightColor, smoothstep(0.15, 0.85, vUv.x + (n - 0.5) * 0.35));
  // Subtle glow lift over uBgColor without competing with falling notes
  float strength = 0.18;
  vec3 col = mix(uBgColor, auroraCol, clamp(intensity * strength, 0.0, 0.35));

  // Twinkling stars in the upper sky (aspect-corrected for 52 x 82 stage)
  vec2 starUv = vec2(vUv.x * 1.6, vUv.y);
  float stars = starLayer(starUv, 18.0, 0.86, uTime) * 0.9
              + starLayer(starUv + vec2(4.2, 1.9), 30.0, 0.90, uTime * 0.8) * 0.55;
  float starMask = smoothstep(0.10, 0.38, vUv.y);
  vec3 starCol = mix(vec3(0.92, 0.95, 1.0), auroraCol, 0.25);
  col += starCol * stars * starMask * 0.55;

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const GLOW_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uLeftColor;
uniform vec3 uRightColor;
uniform float uTime;
uniform sampler2D uKeyEnergyTex;
varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise2D(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    amp *= 0.5;
  }
  return v;
}

void main() {
  // Wide aspect-ratio coordinates for sweeping horizontal smoke billows
  vec2 uv = vec2(vUv.x * 5.5, vUv.y * 2.1);

  // Animated domain-warp so smoke curls and twists organically rather than sliding
  float warpX = fbm(uv * 1.15 + vec2(uTime * 0.16, -uTime * 0.12));
  float warpY = fbm(uv * 1.15 + vec2(-uTime * 0.14, uTime * 0.11) + vec2(5.2, 1.3));
  vec2 warpedUv = uv + vec2(warpX - 0.5, warpY - 0.5) * 1.65;

  // Two counter-drifting, rising smoke layers
  float n1 = fbm(warpedUv + vec2(uTime * 0.24, -uTime * 0.20));
  float n2 = fbm(warpedUv * 1.75 + vec2(-uTime * 0.19, -uTime * 0.15) + vec2(3.1, 5.4));
  float smoke = smoothstep(0.30, 0.80, n1 * 0.60 + n2 * 0.40);

  // Sample 104x1 smoothed per-key energy + hand color texture
  vec4 keyHit = texture2D(uKeyEnergyTex, vec2(vUv.x, 0.5));

  // Smooth vertical falloff from keybed (vUv.y = 0) to top (vUv.y = 1)
  float bodyFalloff = pow(1.0 - vUv.y, 1.65);
  float bodyDensity = (0.05 + 0.95 * smoke) * bodyFalloff;
  bodyDensity *= 1.0 + keyHit.a * 0.90 * pow(1.0 - vUv.y, 1.15);

  // Lively rippling horizon ridge right along the keybed edge
  float h1 = noise2D(vec2(vUv.x * 36.0 + uTime * 1.4, uTime * 0.3));
  float h2 = noise2D(vec2(vUv.x * 58.0 - uTime * 0.9, 2.7));
  float horizonNoise = 0.45 + 0.55 * (h1 * 0.6 + h2 * 0.4);
  float horizonLine = exp(-vUv.y * 26.0) * horizonNoise;
  horizonLine *= 1.0 + keyHit.a * 1.45;

  // Theme color gradient across the keyboard width, tinted by active keys
  vec3 themeCol = mix(uLeftColor, uRightColor, smoothstep(0.15, 0.85, vUv.x));
  themeCol = mix(themeCol, keyHit.rgb, keyHit.a * 0.65);
  vec3 deepCol = themeCol * 0.68;
  vec3 brightCol = mix(themeCol, vec3(1.0), 0.38);
  vec3 col = mix(deepCol, brightCol, clamp(horizonLine * 0.85 + smoke * 0.32, 0.0, 1.0));

  float bodyAlpha = bodyDensity * 0.48;
  float lineAlpha = horizonLine * 0.60;
  float alpha = clamp(bodyAlpha + lineAlpha, 0.0, 0.9);

  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

const TOP_FADE_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uBgColor;
varying vec2 vUv;
void main() {
  float alpha = smoothstep(0.0, 1.0, vUv.y) * 0.92;
  gl_FragColor = vec4(uBgColor, alpha);
  #include <colorspace_fragment>
}
`;

/**
 * Stage atmosphere: lightweight aurora sky, drifting theme smoke mist & top-edge waterfall fade
 */
const StageAtmosphere: React.FC = () => {
  const stageGlowEnabled = useThemeStore((s) => s.stageGlowEnabled);
  const bgColor = useThemeStore((s) => s.bgColor);
  const leftHandColor = useThemeStore((s) => s.leftHandColor);
  const rightHandColor = useThemeStore((s) => s.rightHandColor);
  const viewMode = useViewStore((s) => s.viewMode);

  const leftThreeColor = useMemo(() => new THREE.Color(leftHandColor), []);
  const rightThreeColor = useMemo(() => new THREE.Color(rightHandColor), []);

  const { energyFloat, energyBytes, keyEnergyTex } = useMemo(() => {
    const eFloat = new Float32Array(104 * 4);
    const eBytes = new Uint8Array(104 * 4);
    const tex = new THREE.DataTexture(eBytes, 104, 1, THREE.RGBAFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return { energyFloat: eFloat, energyBytes: eBytes, keyEnergyTex: tex };
  }, []);

  const auroraMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uBgColor: { value: new THREE.Color("#080a10") },
          uLeftColor: { value: new THREE.Color("#a78bfa") },
          uRightColor: { value: new THREE.Color("#7dd3fc") },
          uTime: { value: 0 },
        },
        vertexShader: ATMOSPHERE_VERTEX_SHADER,
        fragmentShader: AURORA_FRAGMENT_SHADER,
        transparent: false,
        depthWrite: false,
        toneMapped: false,
      }),
    []
  );

  const mistMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uLeftColor: { value: new THREE.Color("#a78bfa") },
          uRightColor: { value: new THREE.Color("#7dd3fc") },
          uTime: { value: 0 },
          uKeyEnergyTex: { value: keyEnergyTex },
        },
        vertexShader: ATMOSPHERE_VERTEX_SHADER,
        fragmentShader: GLOW_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [keyEnergyTex]
  );

  const topFadeMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uBgColor: { value: new THREE.Color("#080a10") },
        },
        vertexShader: ATMOSPHERE_VERTEX_SHADER,
        fragmentShader: TOP_FADE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    []
  );

  useEffect(() => {
    leftThreeColor.set(leftHandColor);
    rightThreeColor.set(rightHandColor);
    auroraMaterial.uniforms.uLeftColor.value.set(leftHandColor);
    auroraMaterial.uniforms.uRightColor.value.set(rightHandColor);
    mistMaterial.uniforms.uLeftColor.value.set(leftHandColor);
    mistMaterial.uniforms.uRightColor.value.set(rightHandColor);
  }, [
    leftHandColor,
    rightHandColor,
    auroraMaterial,
    mistMaterial,
    leftThreeColor,
    rightThreeColor,
  ]);

  useEffect(() => {
    auroraMaterial.uniforms.uBgColor.value.set(bgColor);
    topFadeMaterial.uniforms.uBgColor.value.set(bgColor);
  }, [bgColor, auroraMaterial, topFadeMaterial]);

  useEffect(() => {
    return () => {
      auroraMaterial.dispose();
      mistMaterial.dispose();
      topFadeMaterial.dispose();
      keyEnergyTex.dispose();
    };
  }, [auroraMaterial, mistMaterial, topFadeMaterial, keyEnergyTex]);

  useFrame((state, delta) => {
    if (!stageGlowEnabled) return;

    auroraMaterial.uniforms.uTime.value = state.clock.elapsedTime;
    mistMaterial.uniforms.uTime.value = state.clock.elapsedTime;

    const decay = Math.exp(-Math.min(0.1, delta) * 7.5);
    for (let i = 0; i < 104; i++) {
      energyFloat[i * 4 + 3] *= decay;
    }

    for (let k = 0; k < 88; k++) {
      const hand = activeNotes.getHand(k);
      if (hand === 0) continue;

      const vel = activeNotes.getVelocity(k);
      const col = hand === 2 ? leftThreeColor : rightThreeColor;
      const centerBucket = Math.round((PIANO_KEYS[k].centerX / 52) * 103);
      const peakEnergy = 0.45 + 0.55 * vel;

      for (let offset = -1; offset <= 1; offset++) {
        const b = centerBucket + offset;
        if (b < 0 || b >= 104) continue;
        const weight = offset === 0 ? 1.0 : 0.45;
        const energy = weight * peakEnergy;
        const idx = b * 4;
        if (energy > energyFloat[idx + 3]) {
          energyFloat[idx] = col.r;
          energyFloat[idx + 1] = col.g;
          energyFloat[idx + 2] = col.b;
          energyFloat[idx + 3] = energy;
        }
      }
    }

    for (let i = 0; i < 104 * 4; i++) {
      energyBytes[i] = Math.min(255, Math.max(0, Math.round(energyFloat[i] * 255)));
    }
    keyEnergyTex.needsUpdate = true;
  });

  return (
    <group>
      {/* Lightweight Aurora & Stars Background behind waterfall & library (z = 0.01) */}
      {stageGlowEnabled && (
        <mesh position={[26, 59.0, 0.01]} material={auroraMaterial}>
          <planeGeometry args={[52, 82.0]} />
        </mesh>
      )}

      {/* Full-width drifting theme smoke mist above piano (z = 0.08) */}
      {stageGlowEnabled && (
        <mesh position={[26, 24.0, 0.08]} material={mistMaterial}>
          <planeGeometry args={[52, 12.0]} />
        </mesh>
      )}

      {/* Top-edge waterfall fade (z = 0.45) */}
      {viewMode !== "home" && (
        <mesh position={[26, 96.25, 0.45]} material={topFadeMaterial}>
          <planeGeometry args={[52, 7.5]} />
        </mesh>
      )}
    </group>
  );
};

/**
 * Translucent obsidian veils and hairline brackets framing the active hardware MIDI range
 */
const ActiveRangeVeils: React.FC = () => {
  const leftVeilRef = useRef<THREE.Mesh>(null);
  const rightVeilRef = useRef<THREE.Mesh>(null);
  const leftLineRef = useRef<THREE.Mesh>(null);
  const rightLineRef = useRef<THREE.Mesh>(null);

  const currentLeftRef = useRef<number>(0);
  const currentRightRef = useRef<number>(52);

  useFrame((_, delta) => {
    const { minMidi, keyCount, dimOutOfRange } = useMidiStore.getState();
    const { viewMode } = useViewStore.getState();
    const isRangeActive = viewMode !== "home" && dimOutOfRange && keyCount < 88;
    const maxMidi = Math.min(108, minMidi + keyCount - 1);

    const bounds = isRangeActive ? getRangeBoundsX(minMidi, maxMidi) : null;
    const targetLeft = bounds ? bounds.leftX : 0;
    const targetRight = bounds ? bounds.rightX : 52;

    const alpha = Math.min(1, 14 * delta);
    currentLeftRef.current += (targetLeft - currentLeftRef.current) * alpha;
    currentRightRef.current += (targetRight - currentRightRef.current) * alpha;

    const leftX = currentLeftRef.current;
    const rightX = currentRightRef.current;

    if (leftVeilRef.current) {
      const w = Math.max(0, leftX);
      leftVeilRef.current.visible = w > 0.01;
      leftVeilRef.current.position.x = w / 2;
      leftVeilRef.current.scale.x = Math.max(0.0001, w);
    }

    if (rightVeilRef.current) {
      const w = Math.max(0, 52 - rightX);
      rightVeilRef.current.visible = w > 0.01;
      rightVeilRef.current.position.x = rightX + w / 2;
      rightVeilRef.current.scale.x = Math.max(0.0001, w);
    }

    if (leftLineRef.current) {
      leftLineRef.current.visible = isRangeActive && leftX > 0.01;
      leftLineRef.current.position.x = leftX;
    }

    if (rightLineRef.current) {
      rightLineRef.current.visible = isRangeActive && rightX < 51.99;
      rightLineRef.current.position.x = rightX;
    }
  });

  return (
    <group>
      <mesh ref={leftVeilRef} position={[0, 59, 0.55]} visible={false}>
        <planeGeometry args={[1, 82]} />
        <meshBasicMaterial
          color="#09090b"
          transparent
          opacity={0.52}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={rightVeilRef} position={[52, 59, 0.55]} visible={false}>
        <planeGeometry args={[1, 82]} />
        <meshBasicMaterial
          color="#09090b"
          transparent
          opacity={0.52}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={leftLineRef} position={[0, 59, 0.6]} visible={false}>
        <planeGeometry args={[0.07, 82]} />
        <meshBasicMaterial
          color="#f5c26b"
          transparent
          opacity={0.28}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={rightLineRef} position={[52, 59, 0.6]} visible={false}>
        <planeGeometry args={[0.07, 82]} />
        <meshBasicMaterial
          color="#f5c26b"
          transparent
          opacity={0.28}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};

export const PianoStage: React.FC = () => {
  const showKeyLabels = useThemeStore((s) => s.showKeyLabels);
  const noteNaming = useThemeStore((s) => s.noteNaming);
  const bgColor = useThemeStore((s) => s.bgColor);
  const viewMode = useViewStore((s) => s.viewMode);
  const minMidi = useMidiStore((s) => s.minMidi);
  const keyCount = useMidiStore((s) => s.keyCount);
  const dimOutOfRange = useMidiStore((s) => s.dimOutOfRange);
  const isRangeActive = viewMode !== "home" && dimOutOfRange && keyCount < 88;
  const maxMidi = Math.min(108, minMidi + keyCount - 1);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    let isScrubbing = false;
    let wasPlaying = false;
    let targetSec = 0;
    let currentSec = 0;
    let lastWheelMs = 0;
    let lastFrameMs = 0;
    let rafId: number | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const commitScrub = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      if (!isScrubbing) return;

      const state = usePlaybackStore.getState();
      const duration = state.durationSec;
      const finalSec = Math.max(0, Math.min(duration, targetSec));
      const shouldResume = wasPlaying;

      isScrubbing = false;
      wasPlaying = false;

      state.setDisplayTimeSec(finalSec);
      playbackClock.seekLocal(finalSec);

      void (async () => {
        try {
          await audioSeek(finalSec).catch(() => {});
          if (shouldResume && usePlaybackStore.getState().isPlaying) {
            await audioPlay().catch(() => {});
          }
        } finally {
          playbackClock.seekLocal(finalSec);
          playbackClock.setScrubbing(false);
        }
      })();
    };

    const scheduleCommit = () => {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimer = null;
        const sinceLastWheel = performance.now() - lastWheelMs;
        if (sinceLastWheel >= 140 && Math.abs(targetSec - currentSec) < 0.03) {
          commitScrub();
        } else {
          scheduleCommit();
        }
      }, 150);
    };

    const step = (now: number) => {
      if (!isScrubbing) return;
      if (useViewStore.getState().viewMode !== "song") {
        commitScrub();
        return;
      }

      const dtSec = Math.min(0.05, Math.max(0, (now - lastFrameMs) / 1000));
      lastFrameMs = now;

      const alpha = 1 - Math.exp(-20 * dtSec);
      currentSec += (targetSec - currentSec) * alpha;
      if (Math.abs(targetSec - currentSec) < 0.005) {
        currentSec = targetSec;
      }

      usePlaybackStore.getState().setDisplayTimeSec(currentSec);
      playbackClock.seekLocal(currentSec);

      if (currentSec !== targetSec || performance.now() - lastWheelMs < 150) {
        rafId = requestAnimationFrame(step);
      } else {
        rafId = null;
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (useViewStore.getState().viewMode !== "song") return;
      const state = usePlaybackStore.getState();
      const duration = state.durationSec;
      if (duration <= 0) return;

      if (document.querySelector('[role="dialog"]')) return;

      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.deltaMode === 1) {
        dx *= 16;
        dy *= 16;
      } else if (e.deltaMode === 2) {
        dx *= 400;
        dy *= 400;
      }

      // Horizontal right (+dx) or vertical wheel up / trackpad pull-down (-dy) advances forward
      const rawDelta = Math.abs(dx) > Math.abs(dy) ? dx : -dy;
      if (Math.abs(rawDelta) < 0.01) return;

      e.preventDefault();

      if (!isScrubbing) {
        cancelCountIn();
        isScrubbing = true;
        wasPlaying = state.isPlaying;
        currentSec = playbackClock.getTime();
        targetSec = currentSec;
        lastFrameMs = performance.now();
        playbackClock.setScrubbing(true);
        if (wasPlaying) {
          audioPause().catch(() => {});
        }
      }

      const secPerPixel = Math.min(0.12, Math.max(0.025, duration * 0.0002));
      targetSec = Math.max(0, Math.min(duration, targetSec + rawDelta * secPerPixel));
      lastWheelMs = performance.now();

      if (rafId === null) {
        lastFrameMs = performance.now();
        rafId = requestAnimationFrame(step);
      }

      scheduleCommit();
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheel);
      commitScrub();
    };
  }, []);

  return (
    <div
      ref={stageRef}
      className="relative w-full h-full overflow-hidden select-none transition-colors duration-500"
      style={{ backgroundColor: bgColor }}
    >
      {/* 3D WebGL Canvas */}
      <Canvas
        className="w-full h-full"
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        }}
        camera={{
          left: 0,
          right: 52,
          top: 100,
          bottom: 0,
          near: -10,
          far: 50,
          position: [0, 0, 10],
          manual: true,
        }}
        style={{ background: bgColor }}
      >
        <OrthographicCamera
          makeDefault
          manual
          left={0}
          right={52}
          top={100}
          bottom={0}
          near={-10}
          far={50}
          position={[0, 0, 10]}
        />
        <StageCameraLock />

        {/* Subtle Octave Dividers & Measure Lines in Waterfall Zone */}
        <OctaveDividers />
        <MeasureLines />

        {/* Piece-Mode Stage Atmosphere (Keybed Glow & Top-Edge Fade) */}
        <StageAtmosphere />

        {/* Visual Split-by-Pitch Line */}
        <SplitPointGuide />

        {/* Active Hardware MIDI Range Veils & Boundary Brackets */}
        <ActiveRangeVeils />

        {/* Pressed-Key Vertical God-Ray Highlights */}
        <NoteHighlight />

        {/* Instanced Waterfall Notes */}
        <FallingNotes />

        {/* List Mode Hover Preview Driver for the Bottom Piano */}
        <ListPreviewDriver />

        {/* Instanced Hit-Glow Strips & Velocity Particles */}
        <HitEffects />

        {/* 88-Key Instanced Piano Keyboard */}
        <PianoKeyboard />
      </Canvas>

      {/* Retina 2D Falling-Note Labels Overlay */}
      <NoteLabelsOverlay />

      {/* Crisp Key Labels across all 88 keys */}
      {showKeyLabels && (
        <>
          {/* 52 White Key Labels resting cleanly above the ivory front bevel */}
          <div className="absolute bottom-[1.35%] left-0 right-0 h-5 pointer-events-none select-none z-10">
            {WHITE_KEYS.map((key) => {
              const isC = key.pitchClass === 0;
              const isMiddleC = key.midi === 60;
              const isDimmed = isRangeActive && (key.midi < minMidi || key.midi > maxMidi);
              const sizeClass =
                noteNaming === "solfege"
                  ? isMiddleC
                    ? "text-[9.5px] text-zinc-950 font-extrabold"
                    : isC
                      ? "text-[9px] text-zinc-900 font-bold"
                      : "text-[8px] text-zinc-700/90 font-semibold"
                  : isMiddleC
                    ? "text-[11px] text-zinc-950 font-extrabold"
                    : isC
                      ? "text-[10.5px] text-zinc-900 font-bold"
                      : "text-[9.5px] text-zinc-700/90 font-semibold";
              return (
                <span
                  key={key.midi}
                  className={`absolute bottom-0 font-sans -translate-x-1/2 leading-none tracking-tight transition-opacity ${
                    isDimmed ? "opacity-20 " : ""
                  }${sizeClass}`}
                  style={{
                    left: `${(key.centerX / 52) * 100}%`,
                  }}
                >
                  {getKeyDisplayLabel(key.midi, noteNaming)}
                </span>
              );
            })}
          </div>

          {/* 36 Black Key Sharp Labels with crisp superscript # */}
          <div className="hidden lg:block absolute inset-0 pointer-events-none select-none z-10">
            {BLACK_KEYS.map((key) => {
              const baseName = getNoteBaseName(key.midi, noteNaming);
              const isDimmed = isRangeActive && (key.midi < minMidi || key.midi > maxMidi);
              return (
                <span
                  key={key.midi}
                  className={`absolute bottom-[7.6%] -translate-x-1/2 inline-flex items-start font-sans font-bold leading-none text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] transition-opacity ${
                    noteNaming === "solfege" ? "text-[7.5px] tracking-tighter" : "text-[9.5px]"
                  } ${isDimmed ? "opacity-20" : ""}`}
                  style={{
                    left: `${(key.centerX / 52) * 100}%`,
                  }}
                >
                  <span>{baseName}</span>
                  <span
                    className={`font-bold opacity-85 -mt-[1px] ml-[0.5px] ${
                      noteNaming === "solfege" ? "text-[6px]" : "text-[7.5px]"
                    }`}
                  >
                    #
                  </span>
                </span>
              );
            })}
          </div>
        </>
      )}

      {/* Centered Count-In Beat Overlay */}
      <CountInOverlay />

      {/* Interactive Piano Pointer Overlay (Bottom 18% hit-testing) */}
      <PianoPointerOverlay />
    </div>
  );
};
