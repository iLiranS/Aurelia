import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { PIANO_KEYS } from "@/engine/pianoLayout";
import { activeNotes } from "@/engine/activeNotes";
import { useThemeStore } from "@/stores/useThemeStore";
import { useViewStore } from "@/stores/useViewStore";

const KEY_COUNT = 88;

const VERTEX_SHADER = /* glsl */ `
attribute vec3 aRayColor;
attribute float aRayAlpha;
attribute float aLaneWidth;
attribute float aQuadWidth;

varying vec2 vUv;
varying vec3 vRayColor;
varying float vRayAlpha;
varying float vLaneWidth;
varying float vQuadWidth;

void main() {
  vUv = uv;
  vRayColor = aRayColor;
  vRayAlpha = aRayAlpha;
  vLaneWidth = aLaneWidth;
  vQuadWidth = aQuadWidth;

  vec4 mvPosition = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif
  mvPosition = modelViewMatrix * mvPosition;

  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform float uPxPerWorldX;

varying vec2 vUv;
varying vec3 vRayColor;
varying float vRayAlpha;
varying float vLaneWidth;
varying float vQuadWidth;

void main() {
  if (vRayAlpha <= 0.002) discard;

  float xWorld = (vUv.x - 0.5) * vQuadWidth;
  float halfLane = vLaneWidth * 0.5;
  float px = max(1.0, uPxPerWorldX);

  // Distance in pixels to the left and right vertical edges of the pressed key lane
  float dLeftPx = abs(xWorld + halfLane) * px;
  float dRightPx = abs(xWorld - halfLane) * px;
  float rayDistPx = min(dLeftPx, dRightPx);

  // Twin vertical "god ray" beams framing the key width (sharp core + soft outer aura)
  float rayCore = exp(-rayDistPx * rayDistPx * 0.65);
  float rayGlow = exp(-rayDistPx * 0.40) * 0.42;
  float rays = rayCore * 0.78 + rayGlow;

  // Subtle translucent column wash across the key width
  float edgeFeather = 0.65 / px;
  float insideMask = 1.0 - smoothstep(halfLane - edgeFeather, halfLane + edgeFeather, abs(xWorld));
  float columnWash = insideMask * mix(0.16, 0.055, pow(vUv.y, 0.75));

  // Strongest near the keybed (vUv.y = 0), tapering gracefully toward the top edge
  float vertFade = mix(1.0, 0.28, pow(vUv.y, 1.1));
  float baseAnchor = exp(-vUv.y * 20.0) * 0.28 * insideMask;

  float intensity = (rays * vertFade + columnWash + baseAnchor) * vRayAlpha;
  if (intensity < 0.003) discard;

  vec3 col = mix(vRayColor, vec3(1.0), 0.42 * rayCore * vertFade);
  gl_FragColor = vec4(col, clamp(intensity, 0.0, 1.0));
}
`;

/**
 * Renders twin vertical god-ray guide beams and a subtle lane wash
 * rising from each currently pressed key (MIDI, QWERTY, or pointer) all the way up the waterfall.
 */
export const NoteHighlight: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const tempObject = useMemo(() => new THREE.Object3D(), []);
  const rightThreeColor = useMemo(() => new THREE.Color(), []);
  const leftThreeColor = useMemo(() => new THREE.Color(), []);

  // Per-key animation buffers (88 keys)
  const animAlpha = useMemo(() => new Float32Array(KEY_COUNT), []);
  const animR = useMemo(() => new Float32Array(KEY_COUNT), []);
  const animG = useMemo(() => new Float32Array(KEY_COUNT), []);
  const animB = useMemo(() => new Float32Array(KEY_COUNT), []);

  // Instanced GPU attribute buffers
  const rayColorArray = useMemo(() => new Float32Array(KEY_COUNT * 3), []);
  const rayAlphaArray = useMemo(() => new Float32Array(KEY_COUNT), []);
  const laneWidthArray = useMemo(() => new Float32Array(KEY_COUNT), []);
  const quadWidthArray = useMemo(() => new Float32Array(KEY_COUNT), []);

  const rayColorAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(rayColorArray, 3),
    [rayColorArray]
  );
  const rayAlphaAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(rayAlphaArray, 1),
    [rayAlphaArray]
  );
  const laneWidthAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(laneWidthArray, 1),
    [laneWidthArray]
  );
  const quadWidthAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(quadWidthArray, 1),
    [quadWidthArray]
  );

  const geometry = useMemo(() => {
    rayColorAttr.setUsage(THREE.DynamicDrawUsage);
    rayAlphaAttr.setUsage(THREE.DynamicDrawUsage);
    laneWidthAttr.setUsage(THREE.DynamicDrawUsage);
    quadWidthAttr.setUsage(THREE.DynamicDrawUsage);

    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute("aRayColor", rayColorAttr);
    geo.setAttribute("aRayAlpha", rayAlphaAttr);
    geo.setAttribute("aLaneWidth", laneWidthAttr);
    geo.setAttribute("aQuadWidth", quadWidthAttr);
    return geo;
  }, [rayColorAttr, rayAlphaAttr, laneWidthAttr, quadWidthAttr]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uPxPerWorldX: { value: 24.0 },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    []
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame(({ size }, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const { noteHighlightEnabled, rightHandColor, leftHandColor } =
      useThemeStore.getState();
    const viewMode = useViewStore.getState().viewMode;

    if (!noteHighlightEnabled || viewMode === "home") {
      animAlpha.fill(0);
      if (mesh.count > 0) {
        mesh.count = 0;
        mesh.instanceMatrix.needsUpdate = true;
      }
      return;
    }

    const pxPerWorldX = Math.max(1, size.width) / 52;
    material.uniforms.uPxPerWorldX.value = pxPerWorldX;

    const padWorldX = 10.0 / pxPerWorldX;
    rightThreeColor.set(rightHandColor);
    leftThreeColor.set(leftHandColor);

    const clampedDelta = Math.min(delta, 0.05);
    let count = 0;

    for (let k = 0; k < KEY_COUNT; k++) {
      const liveHand = activeNotes.liveHand[k];
      const isLivePressed = liveHand !== 0;

      if (isLivePressed) {
        const col = liveHand === 2 ? leftThreeColor : rightThreeColor;
        animR[k] = col.r;
        animG[k] = col.g;
        animB[k] = col.b;
      }

      const vel = isLivePressed ? activeNotes.liveVelocity[k] : 0;
      const targetAlpha = isLivePressed
        ? 0.72 + 0.28 * Math.max(0.2, Math.min(1, vel))
        : 0.0;
      const speed = isLivePressed ? 32.0 : 12.0;
      const lerp = 1 - Math.exp(-clampedDelta * speed);
      animAlpha[k] += (targetAlpha - animAlpha[k]) * lerp;

      const alpha = animAlpha[k];
      if (alpha <= 0.002) {
        animAlpha[k] = 0;
        continue;
      }

      const key = PIANO_KEYS[k];
      const quadWidth = key.width + padWorldX * 2;

      tempObject.position.set(key.centerX, 59.0, 0.16);
      tempObject.scale.set(quadWidth, 82.0, 1);
      tempObject.updateMatrix();
      mesh.setMatrixAt(count, tempObject.matrix);

      const cIdx = count * 3;
      rayColorArray[cIdx] = animR[k];
      rayColorArray[cIdx + 1] = animG[k];
      rayColorArray[cIdx + 2] = animB[k];
      rayAlphaArray[count] = alpha;
      laneWidthArray[count] = key.width;
      quadWidthArray[count] = quadWidth;

      count++;
    }

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (count > 0) {
      rayColorAttr.needsUpdate = true;
      rayAlphaAttr.needsUpdate = true;
      laneWidthAttr.needsUpdate = true;
      quadWidthAttr.needsUpdate = true;
    }
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, KEY_COUNT]}
      frustumCulled={false}
    />
  );
};
