import React, { useRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { WHITE_KEYS, BLACK_KEYS } from "@/engine/pianoLayout";
import { activeNotes } from "@/engine/activeNotes";
import { useThemeStore } from "@/stores/useThemeStore";
import { useMidiStore } from "@/stores/useMidiStore";
import { useViewStore } from "@/stores/useViewStore";
import { createKeyboardShaderMaterial } from "./keyboardShader";

const WHITE_COUNT = WHITE_KEYS.length; // 52
const BLACK_COUNT = BLACK_KEYS.length; // 36

interface KeyBufferSet {
  depression: Float32Array;
  activeColor: Float32Array;
  activeMix: Float32Array;
  dimmed: Float32Array;
  centerX: Float32Array;
  depressionAttr: THREE.InstancedBufferAttribute;
  activeColorAttr: THREE.InstancedBufferAttribute;
  activeMixAttr: THREE.InstancedBufferAttribute;
  dimmedAttr: THREE.InstancedBufferAttribute;
  centerXAttr: THREE.InstancedBufferAttribute;
}

function createKeyBuffers(
  geometry: THREE.PlaneGeometry,
  count: number,
  keys: ReadonlyArray<{ centerX: number }>
): KeyBufferSet {
  const depression = new Float32Array(count);
  const activeColor = new Float32Array(count * 3);
  const activeMix = new Float32Array(count);
  const dimmed = new Float32Array(count);
  const centerX = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    centerX[i] = keys[i].centerX;
  }

  const depressionAttr = new THREE.InstancedBufferAttribute(depression, 1);
  const activeColorAttr = new THREE.InstancedBufferAttribute(activeColor, 3);
  const activeMixAttr = new THREE.InstancedBufferAttribute(activeMix, 1);
  const dimmedAttr = new THREE.InstancedBufferAttribute(dimmed, 1);
  const centerXAttr = new THREE.InstancedBufferAttribute(centerX, 1);

  depressionAttr.setUsage(THREE.DynamicDrawUsage);
  activeColorAttr.setUsage(THREE.DynamicDrawUsage);
  activeMixAttr.setUsage(THREE.DynamicDrawUsage);
  dimmedAttr.setUsage(THREE.DynamicDrawUsage);

  geometry.setAttribute("aDepression", depressionAttr);
  geometry.setAttribute("aActiveColor", activeColorAttr);
  geometry.setAttribute("aActiveMix", activeMixAttr);
  geometry.setAttribute("aDimmed", dimmedAttr);
  geometry.setAttribute("aCenterX", centerXAttr);

  return {
    depression,
    activeColor,
    activeMix,
    dimmed,
    centerX,
    depressionAttr,
    activeColorAttr,
    activeMixAttr,
    dimmedAttr,
    centerXAttr,
  };
}

export const PianoKeyboard: React.FC = () => {
  const whiteMeshRef = useRef<THREE.InstancedMesh>(null);
  const blackMeshRef = useRef<THREE.InstancedMesh>(null);

  const tempObject = useMemo(() => new THREE.Object3D(), []);
  const rightThreeColor = useMemo(() => new THREE.Color(), []);
  const leftThreeColor = useMemo(() => new THREE.Color(), []);

  // Animation states across 88 keys (keyIndex = 0..87)
  const animDepression = useMemo(() => new Float32Array(88), []);
  const animMix = useMemo(() => new Float32Array(88), []);
  const animR = useMemo(() => new Float32Array(88), []);
  const animG = useMemo(() => new Float32Array(88), []);
  const animB = useMemo(() => new Float32Array(88), []);

  // Geometries, instanced attributes, and custom shader materials
  const { whiteGeometry, whiteBuffers, whiteMaterial } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const buffers = createKeyBuffers(geo, WHITE_COUNT, WHITE_KEYS);
    const mat = createKeyboardShaderMaterial(false);
    return { whiteGeometry: geo, whiteBuffers: buffers, whiteMaterial: mat };
  }, []);

  const { blackGeometry, blackBuffers, blackMaterial } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const buffers = createKeyBuffers(geo, BLACK_COUNT, BLACK_KEYS);
    const mat = createKeyboardShaderMaterial(true);
    return { blackGeometry: geo, blackBuffers: buffers, blackMaterial: mat };
  }, []);

  // Initialize instance matrices upfront
  useEffect(() => {
    if (whiteMeshRef.current) {
      const mesh = whiteMeshRef.current;
      for (let i = 0; i < WHITE_COUNT; i++) {
        const key = WHITE_KEYS[i];
        const h = 17.6;
        tempObject.position.set(key.centerX, 17.75 - h * 0.5, 1.0);
        tempObject.scale.set(0.94, h, 1.0);
        tempObject.updateMatrix();
        mesh.setMatrixAt(i, tempObject.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    if (blackMeshRef.current) {
      const mesh = blackMeshRef.current;
      for (let i = 0; i < BLACK_COUNT; i++) {
        const key = BLACK_KEYS[i];
        const h = 11.4;
        tempObject.position.set(key.centerX, 17.85 - h * 0.5, 1.5);
        tempObject.scale.set(0.78, h, 1.0);
        tempObject.updateMatrix();
        mesh.setMatrixAt(i, tempObject.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, [tempObject]);

  // Dispose geometries and materials on unmount
  useEffect(() => {
    return () => {
      whiteGeometry.dispose();
      whiteMaterial.dispose();
      blackGeometry.dispose();
      blackMaterial.dispose();
    };
  }, [whiteGeometry, whiteMaterial, blackGeometry, blackMaterial]);

  useFrame((state, delta) => {
    const whiteMesh = whiteMeshRef.current;
    const blackMesh = blackMeshRef.current;
    if (!whiteMesh || !blackMesh) return;

    const pxPerWorldX = state.size.width / 52;
    const pxPerWorldY = state.size.height / 100;
    whiteMaterial.uniforms.uPxPerWorld.value.set(pxPerWorldX, pxPerWorldY);
    blackMaterial.uniforms.uPxPerWorld.value.set(pxPerWorldX, pxPerWorldY);

    const { rightHandColor, leftHandColor, keyboardVignette } =
      useThemeStore.getState();
    const vigVal = keyboardVignette ? 1.0 : 0.0;
    whiteMaterial.uniforms.uVignetteEnabled.value = vigVal;
    blackMaterial.uniforms.uVignetteEnabled.value = vigVal;

    rightThreeColor.set(rightHandColor);
    leftThreeColor.set(leftHandColor);

    const { minMidi, keyCount, dimOutOfRange } = useMidiStore.getState();
    const { viewMode } = useViewStore.getState();
    const isRangeActive = viewMode !== "home" && dimOutOfRange && keyCount < 88;
    const maxMidi = minMidi + keyCount - 1;
    const pulse = 0.48 + 0.28 * Math.sin(state.clock.elapsedTime * 6.5);
    const clampedDelta = Math.min(delta, 0.05);

    // Update 52 White Keys
    for (let i = 0; i < WHITE_COUNT; i++) {
      const key = WHITE_KEYS[i];
      const keyIdx = key.keyIndex;
      const hand = activeNotes.getHand(keyIdx); // 0=none, 1=right, 2=left
      const vel = activeNotes.getVelocity(keyIdx);
      const waitHand = activeNotes.waitingHand[keyIdx];

      const isPressed = hand !== 0;
      const targetDepression = isPressed ? Math.max(0.4, vel) : 0.0;
      const isDimmed = isRangeActive && (key.midi < minMidi || key.midi > maxMidi);

      let targetMix = 0.0;
      let hasColorTarget = false;
      let targetR = animR[keyIdx];
      let targetG = animG[keyIdx];
      let targetB = animB[keyIdx];

      if (hand === 1) {
        targetMix = 1.0;
        hasColorTarget = true;
        targetR = rightThreeColor.r;
        targetG = rightThreeColor.g;
        targetB = rightThreeColor.b;
      } else if (hand === 2) {
        targetMix = 1.0;
        hasColorTarget = true;
        targetR = leftThreeColor.r;
        targetG = leftThreeColor.g;
        targetB = leftThreeColor.b;
      } else if (waitHand !== 0) {
        targetMix = pulse;
        hasColorTarget = true;
        const wColor = waitHand === 1 ? rightThreeColor : leftThreeColor;
        targetR = wColor.r;
        targetG = wColor.g;
        targetB = wColor.b;
      }

      const speed = isPressed ? 28.0 : 14.0;
      const alpha = 1 - Math.exp(-clampedDelta * speed);

      animDepression[keyIdx] +=
        (targetDepression - animDepression[keyIdx]) * alpha;

      if (hasColorTarget) {
        if (animMix[keyIdx] < 0.02) {
          animR[keyIdx] = targetR;
          animG[keyIdx] = targetG;
          animB[keyIdx] = targetB;
        } else {
          animR[keyIdx] += (targetR - animR[keyIdx]) * alpha;
          animG[keyIdx] += (targetG - animG[keyIdx]) * alpha;
          animB[keyIdx] += (targetB - animB[keyIdx]) * alpha;
        }
      }
      animMix[keyIdx] += (targetMix - animMix[keyIdx]) * alpha;

      const dep = animDepression[keyIdx];
      const h = 17.6 - 0.32 * dep;
      tempObject.position.set(key.centerX, 17.75 - h * 0.5, 1.0);
      tempObject.scale.set(0.94, h, 1.0);
      tempObject.updateMatrix();
      whiteMesh.setMatrixAt(i, tempObject.matrix);

      whiteBuffers.depression[i] = dep;
      whiteBuffers.activeMix[i] = animMix[keyIdx];
      whiteBuffers.dimmed[i] = isDimmed ? 1.0 : 0.0;
      const cIdx = i * 3;
      whiteBuffers.activeColor[cIdx] = animR[keyIdx];
      whiteBuffers.activeColor[cIdx + 1] = animG[keyIdx];
      whiteBuffers.activeColor[cIdx + 2] = animB[keyIdx];
    }

    whiteMesh.instanceMatrix.needsUpdate = true;
    whiteBuffers.depressionAttr.needsUpdate = true;
    whiteBuffers.activeMixAttr.needsUpdate = true;
    whiteBuffers.dimmedAttr.needsUpdate = true;
    whiteBuffers.activeColorAttr.needsUpdate = true;

    // Update 36 Black Keys
    for (let i = 0; i < BLACK_COUNT; i++) {
      const key = BLACK_KEYS[i];
      const keyIdx = key.keyIndex;
      const hand = activeNotes.getHand(keyIdx);
      const vel = activeNotes.getVelocity(keyIdx);
      const waitHand = activeNotes.waitingHand[keyIdx];

      const isPressed = hand !== 0;
      const targetDepression = isPressed ? Math.max(0.4, vel) : 0.0;
      const isDimmed = isRangeActive && (key.midi < minMidi || key.midi > maxMidi);

      let targetMix = 0.0;
      let hasColorTarget = false;
      let targetR = animR[keyIdx];
      let targetG = animG[keyIdx];
      let targetB = animB[keyIdx];

      if (hand === 1) {
        targetMix = 1.0;
        hasColorTarget = true;
        targetR = rightThreeColor.r;
        targetG = rightThreeColor.g;
        targetB = rightThreeColor.b;
      } else if (hand === 2) {
        targetMix = 1.0;
        hasColorTarget = true;
        targetR = leftThreeColor.r;
        targetG = leftThreeColor.g;
        targetB = leftThreeColor.b;
      } else if (waitHand !== 0) {
        targetMix = pulse;
        hasColorTarget = true;
        const wColor = waitHand === 1 ? rightThreeColor : leftThreeColor;
        targetR = wColor.r;
        targetG = wColor.g;
        targetB = wColor.b;
      }

      const speed = isPressed ? 28.0 : 14.0;
      const alpha = 1 - Math.exp(-clampedDelta * speed);

      animDepression[keyIdx] +=
        (targetDepression - animDepression[keyIdx]) * alpha;

      if (hasColorTarget) {
        if (animMix[keyIdx] < 0.02) {
          animR[keyIdx] = targetR;
          animG[keyIdx] = targetG;
          animB[keyIdx] = targetB;
        } else {
          animR[keyIdx] += (targetR - animR[keyIdx]) * alpha;
          animG[keyIdx] += (targetG - animG[keyIdx]) * alpha;
          animB[keyIdx] += (targetB - animB[keyIdx]) * alpha;
        }
      }
      animMix[keyIdx] += (targetMix - animMix[keyIdx]) * alpha;

      const dep = animDepression[keyIdx];
      const h = 11.4 - 0.22 * dep;
      tempObject.position.set(key.centerX, 17.85 - h * 0.5, 1.5);
      tempObject.scale.set(0.78, h, 1.0);
      tempObject.updateMatrix();
      blackMesh.setMatrixAt(i, tempObject.matrix);

      blackBuffers.depression[i] = dep;
      blackBuffers.activeMix[i] = animMix[keyIdx];
      blackBuffers.dimmed[i] = isDimmed ? 1.0 : 0.0;
      const cIdx = i * 3;
      blackBuffers.activeColor[cIdx] = animR[keyIdx];
      blackBuffers.activeColor[cIdx + 1] = animG[keyIdx];
      blackBuffers.activeColor[cIdx + 2] = animB[keyIdx];
    }

    blackMesh.instanceMatrix.needsUpdate = true;
    blackBuffers.depressionAttr.needsUpdate = true;
    blackBuffers.activeMixAttr.needsUpdate = true;
    blackBuffers.dimmedAttr.needsUpdate = true;
    blackBuffers.activeColorAttr.needsUpdate = true;
  });

  return (
    <group>
      {/* Backing plate behind keys */}
      <mesh position={[26, 9.0, 0.8]}>
        <planeGeometry args={[52, 18]} />
        <meshBasicMaterial color="#09090b" toneMapped={false} />
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

      {/* Layered Keybed Rail & Felt Strip */}
      {/* Dark recessed fallboard shadow strip */}
      <mesh position={[26, 17.92, 1.95]}>
        <planeGeometry args={[52, 0.38]} />
        <meshBasicMaterial
          color="#050507"
          transparent
          opacity={0.95}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Classic deep crimson-burgundy felt strip */}
      <mesh position={[26, 17.86, 1.98]}>
        <planeGeometry args={[52, 0.16]} />
        <meshBasicMaterial color="#4c111a" depthWrite={false} toneMapped={false} />
      </mesh>

      {/* Crisp specular hairline at Y = 18.05 */}
      <mesh position={[26, 18.05, 2.02]}>
        <planeGeometry args={[52, 0.09]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.42}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
};
