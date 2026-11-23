import React, { useRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { WHITE_KEYS, BLACK_KEYS } from "@/engine/pianoLayout";
import { activeNotes } from "@/engine/activeNotes";
import { useThemeStore } from "@/stores/useThemeStore";
import { useMidiStore } from "@/stores/useMidiStore";

const WHITE_COUNT = WHITE_KEYS.length; // 52
const BLACK_COUNT = BLACK_KEYS.length; // 36

const IVORY_R = 0.957;
const IVORY_G = 0.957;
const IVORY_B = 0.961;

const DIM_WHITE_R = 0.34;
const DIM_WHITE_G = 0.35;
const DIM_WHITE_B = 0.38;

const CHARCOAL_R = 0.094;
const CHARCOAL_G = 0.094;
const CHARCOAL_B = 0.106;

const DIM_BLACK_R = 0.045;
const DIM_BLACK_G = 0.045;
const DIM_BLACK_B = 0.055;

export const PianoKeyboard: React.FC = () => {
  const whiteMeshRef = useRef<THREE.InstancedMesh>(null);
  const blackMeshRef = useRef<THREE.InstancedMesh>(null);

  const tempObject = useMemo(() => new THREE.Object3D(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);
  const rightThreeColor = useMemo(() => new THREE.Color(), []);
  const leftThreeColor = useMemo(() => new THREE.Color(), []);

  // Animation states across 88 keys (keyIndex = 0..87)
  const animDepression = useMemo(() => new Float32Array(88), []);
  const animR = useMemo(() => new Float32Array(88), []);
  const animG = useMemo(() => new Float32Array(88), []);
  const animB = useMemo(() => new Float32Array(88), []);

  // Geometries and materials
  const whiteGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const whiteMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        toneMapped: false,
      }),
    []
  );

  const blackGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const blackMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        toneMapped: false,
      }),
    []
  );

  // Initialize colors and matrices upfront
  useEffect(() => {
    // White keys initialization
    if (whiteMeshRef.current) {
      const mesh = whiteMeshRef.current;
      if (!mesh.instanceColor) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(
          new Float32Array(WHITE_COUNT * 3),
          3
        );
      }

      for (let i = 0; i < WHITE_COUNT; i++) {
        const key = WHITE_KEYS[i];
        const keyIdx = key.keyIndex;

        animR[keyIdx] = IVORY_R;
        animG[keyIdx] = IVORY_G;
        animB[keyIdx] = IVORY_B;

        tempObject.position.set(key.centerX, 8.9, 1.0);
        tempObject.scale.set(0.94, 17.6, 1.0);
        tempObject.updateMatrix();
        mesh.setMatrixAt(i, tempObject.matrix);

        tempColor.setRGB(IVORY_R, IVORY_G, IVORY_B);
        mesh.setColorAt(i, tempColor);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // Black keys initialization
    if (blackMeshRef.current) {
      const mesh = blackMeshRef.current;
      if (!mesh.instanceColor) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(
          new Float32Array(BLACK_COUNT * 3),
          3
        );
      }

      for (let i = 0; i < BLACK_COUNT; i++) {
        const key = BLACK_KEYS[i];
        const keyIdx = key.keyIndex;

        animR[keyIdx] = CHARCOAL_R;
        animG[keyIdx] = CHARCOAL_G;
        animB[keyIdx] = CHARCOAL_B;

        tempObject.position.set(key.centerX, 12.4, 1.5);
        tempObject.scale.set(0.62, 11.0, 1.0);
        tempObject.updateMatrix();
        mesh.setMatrixAt(i, tempObject.matrix);

        tempColor.setRGB(CHARCOAL_R, CHARCOAL_G, CHARCOAL_B);
        mesh.setColorAt(i, tempColor);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [animR, animG, animB, tempObject, tempColor]);

  useFrame((state) => {
    const whiteMesh = whiteMeshRef.current;
    const blackMesh = blackMeshRef.current;
    if (!whiteMesh || !blackMesh) return;

    const { rightHandColor, leftHandColor } = useThemeStore.getState();
    rightThreeColor.set(rightHandColor);
    leftThreeColor.set(leftHandColor);

    const { minMidi, keyCount, dimOutOfRange } = useMidiStore.getState();
    const isRangeActive = dimOutOfRange && keyCount < 88;
    const maxMidi = minMidi + keyCount - 1;
    const pulse = 0.48 + 0.28 * Math.sin(state.clock.elapsedTime * 6.5);

    // Update 52 White Keys
    for (let i = 0; i < WHITE_COUNT; i++) {
      const key = WHITE_KEYS[i];
      const keyIdx = key.keyIndex;
      const hand = activeNotes.getHand(keyIdx); // 0=none, 1=right, 2=left
      const vel = activeNotes.getVelocity(keyIdx);

      const isPressed = hand !== 0;
      const targetDepression = isPressed ? Math.max(0.4, vel) : 0.0;

      const isDimmed = isRangeActive && (key.midi < minMidi || key.midi > maxMidi);
      let targetR = isDimmed ? DIM_WHITE_R : IVORY_R;
      let targetG = isDimmed ? DIM_WHITE_G : IVORY_G;
      let targetB = isDimmed ? DIM_WHITE_B : IVORY_B;

      if (hand === 1) {
        targetR = rightThreeColor.r;
        targetG = rightThreeColor.g;
        targetB = rightThreeColor.b;
      } else if (hand === 2) {
        targetR = leftThreeColor.r;
        targetG = leftThreeColor.g;
        targetB = leftThreeColor.b;
      } else if (activeNotes.waitingHand[keyIdx] !== 0) {
        const wColor =
          activeNotes.waitingHand[keyIdx] === 1 ? rightThreeColor : leftThreeColor;
        targetR = targetR + (wColor.r - targetR) * pulse;
        targetG = targetG + (wColor.g - targetG) * pulse;
        targetB = targetB + (wColor.b - targetB) * pulse;
      }

      const lerpSpeed = isPressed ? 0.45 : 0.22;
      animDepression[keyIdx] +=
        (targetDepression - animDepression[keyIdx]) * lerpSpeed;
      animR[keyIdx] += (targetR - animR[keyIdx]) * lerpSpeed;
      animG[keyIdx] += (targetG - animG[keyIdx]) * lerpSpeed;
      animB[keyIdx] += (targetB - animB[keyIdx]) * lerpSpeed;

      const yOffset = -0.35 * animDepression[keyIdx];
      tempObject.position.set(key.centerX, 8.9 + yOffset, 1.0);
      tempObject.scale.set(0.94, 17.6, 1.0);
      tempObject.updateMatrix();
      whiteMesh.setMatrixAt(i, tempObject.matrix);

      tempColor.setRGB(animR[keyIdx], animG[keyIdx], animB[keyIdx]);
      whiteMesh.setColorAt(i, tempColor);
    }

    whiteMesh.instanceMatrix.needsUpdate = true;
    if (whiteMesh.instanceColor) {
      whiteMesh.instanceColor.needsUpdate = true;
    }

    // Update 36 Black Keys
    for (let i = 0; i < BLACK_COUNT; i++) {
      const key = BLACK_KEYS[i];
      const keyIdx = key.keyIndex;
      const hand = activeNotes.getHand(keyIdx);
      const vel = activeNotes.getVelocity(keyIdx);

      const isPressed = hand !== 0;
      const targetDepression = isPressed ? Math.max(0.4, vel) : 0.0;

      const isDimmed = isRangeActive && (key.midi < minMidi || key.midi > maxMidi);
      let targetR = isDimmed ? DIM_BLACK_R : CHARCOAL_R;
      let targetG = isDimmed ? DIM_BLACK_G : CHARCOAL_G;
      let targetB = isDimmed ? DIM_BLACK_B : CHARCOAL_B;

      if (hand === 1) {
        targetR = rightThreeColor.r * 0.88;
        targetG = rightThreeColor.g * 0.88;
        targetB = rightThreeColor.b * 0.88;
      } else if (hand === 2) {
        targetR = leftThreeColor.r * 0.88;
        targetG = leftThreeColor.g * 0.88;
        targetB = leftThreeColor.b * 0.88;
      } else if (activeNotes.waitingHand[keyIdx] !== 0) {
        const wColor =
          activeNotes.waitingHand[keyIdx] === 1 ? rightThreeColor : leftThreeColor;
        targetR = targetR + (wColor.r * 0.88 - targetR) * pulse;
        targetG = targetG + (wColor.g * 0.88 - targetG) * pulse;
        targetB = targetB + (wColor.b * 0.88 - targetB) * pulse;
      }

      const lerpSpeed = isPressed ? 0.45 : 0.22;
      animDepression[keyIdx] +=
        (targetDepression - animDepression[keyIdx]) * lerpSpeed;
      animR[keyIdx] += (targetR - animR[keyIdx]) * lerpSpeed;
      animG[keyIdx] += (targetG - animG[keyIdx]) * lerpSpeed;
      animB[keyIdx] += (targetB - animB[keyIdx]) * lerpSpeed;

      const yOffset = -0.30 * animDepression[keyIdx];
      tempObject.position.set(key.centerX, 12.4 + yOffset, 1.5);
      tempObject.scale.set(0.62, 11.0, 1.0);
      tempObject.updateMatrix();
      blackMesh.setMatrixAt(i, tempObject.matrix);

      tempColor.setRGB(animR[keyIdx], animG[keyIdx], animB[keyIdx]);
      blackMesh.setColorAt(i, tempColor);
    }

    blackMesh.instanceMatrix.needsUpdate = true;
    if (blackMesh.instanceColor) {
      blackMesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group>
      {/* Backing plate behind keys */}
      <mesh position={[26, 9.0, 0.8]}>
        <planeGeometry args={[52, 18]} />
        <meshBasicMaterial color="#09090b" toneMapped={false} />
      </mesh>

      {/* Luminous Hit Line Bar at Y = 18.0 */}
      <mesh position={[26, 18.0, 2.0]}>
        <planeGeometry args={[52, 0.25]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.65}
          toneMapped={false}
        />
      </mesh>

      {/* 52 White Keys Instanced Mesh */}
      <instancedMesh
        ref={whiteMeshRef}
        args={[whiteGeometry, whiteMaterial, WHITE_COUNT]}
        frustumCulled={false}
      />

      {/* 36 Black Keys Instanced Mesh */}
      <instancedMesh
        ref={blackMeshRef}
        args={[blackGeometry, blackMaterial, BLACK_COUNT]}
        frustumCulled={false}
      />
    </group>
  );
};
