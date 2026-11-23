import React, { useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import { FallingNotes } from "./FallingNotes";
import { ListPreviewDriver } from "./ListPreviewDriver";
import { PianoKeyboard } from "./PianoKeyboard";
import { HitEffects } from "./HitEffects";
import { PianoPointerOverlay } from "./PianoPointerOverlay";
import { NoteLabelsOverlay } from "./NoteLabelsOverlay";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { useThemeStore } from "@/stores/useThemeStore";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { useMidiStore } from "@/stores/useMidiStore";
import {
  BLACK_KEYS,
  WHITE_KEYS,
  getKeyDisplayLabel,
  getKeyLeftEdgeX,
  getKeyRightEdgeX,
  getKeySplitX,
  getNoteLetter,
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
  return (
    <group position={[0, 0, 0.05]}>
      {C_WHITE_INDICES.map((whiteIdx) => (
        <mesh key={whiteIdx} position={[whiteIdx, 59, 0]}>
          <planeGeometry args={[0.04, 82]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.04}
            depthWrite={false}
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

  if (!useSplitPoint) return null;

  const splitX = getKeySplitX(splitPointMidi);

  return (
    <group position={[0, 0, 0.4]}>
      <mesh position={[splitX, 59, 0]}>
        <planeGeometry args={[0.08, 82]} />
        <meshBasicMaterial
          color={rightHandColor}
          transparent
          opacity={0.4}
          depthWrite={false}
        />
      </mesh>
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
    const isRangeActive = dimOutOfRange && keyCount < 88;
    const maxMidi = Math.min(108, minMidi + keyCount - 1);

    const targetLeft = isRangeActive ? getKeyLeftEdgeX(minMidi) : 0;
    const targetRight = isRangeActive ? getKeyRightEdgeX(maxMidi) : 52;

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
  const bloomEnabled = useThemeStore((s) => s.bloomEnabled);
  const bgColor = useThemeStore((s) => s.bgColor);

  return (
    <div
      className="relative w-full h-full overflow-hidden select-none transition-colors duration-500"
      style={{ backgroundColor: bgColor }}
    >
      {/* 3D WebGL Canvas */}
      <Canvas
        className="w-full h-full"
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

        {/* Subtle Octave Dividers in Waterfall Zone */}
        <OctaveDividers />

        {/* Visual Split-by-Pitch Line */}
        <SplitPointGuide />

        {/* Active Hardware MIDI Range Veils & Boundary Brackets */}
        <ActiveRangeVeils />

        {/* Instanced Waterfall Notes */}
        <FallingNotes />

        {/* List Mode Hover Preview Driver for the Bottom Piano */}
        <ListPreviewDriver />

        {/* Instanced Hit-Glow Strips & Velocity Particles */}
        <HitEffects />

        {/* 88-Key Instanced Piano Keyboard */}
        <PianoKeyboard />

        {/* Selective Postprocessing Bloom */}
        {bloomEnabled && (
          <EffectComposer multisampling={0}>
            <Bloom
              mipmapBlur
              luminanceThreshold={1.05}
              intensity={0.55}
              radius={0.72}
            />
          </EffectComposer>
        )}
      </Canvas>

      {/* Retina 2D Falling-Note Labels Overlay */}
      <NoteLabelsOverlay />

      {/* Crisp Key Labels across all 88 keys */}
      {showKeyLabels && (
        <>
          {/* 52 White Key Labels along the bottom edge */}
          <div className="absolute bottom-1.5 left-0 right-0 h-5 pointer-events-none select-none z-10">
            {WHITE_KEYS.map((key) => {
              const isC = key.pitchClass === 0;
              const isMiddleC = key.midi === 60;
              return (
                <span
                  key={key.midi}
                  className={`absolute bottom-0 font-mono -translate-x-1/2 tracking-tighter ${
                    isMiddleC
                      ? "text-[10px] text-primary font-bold"
                      : isC
                        ? "text-[10px] text-zinc-800 font-semibold"
                        : "text-[9px] text-zinc-600 font-medium"
                  }`}
                  style={{
                    left: `${(key.centerX / 52) * 100}%`,
                  }}
                >
                  {getKeyDisplayLabel(key.midi)}
                </span>
              );
            })}
          </div>

          {/* 36 Black Key Sharp Labels (wide viewports only) */}
          <div className="hidden xl:block absolute inset-0 pointer-events-none select-none z-10">
            {BLACK_KEYS.map((key) => (
              <span
                key={key.midi}
                className="absolute bottom-[7.4%] -translate-x-1/2 text-[8.5px] font-mono font-semibold text-zinc-200 drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)] tracking-tighter"
                style={{
                  left: `${(key.centerX / 52) * 100}%`,
                }}
              >
                {getNoteLetter(key.midi)}
              </span>
            ))}
          </div>
        </>
      )}

      {/* Interactive Piano Pointer Overlay (Bottom 18% hit-testing) */}
      <PianoPointerOverlay />
    </div>
  );
};
