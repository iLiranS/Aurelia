import React, { useRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { PIANO_KEYS } from "@/engine/pianoLayout";
import { activeNotes } from "@/engine/activeNotes";
import { useThemeStore } from "@/stores/useThemeStore";

const KEY_COUNT = 88;
const MAX_PARTICLES = 900;

function createImpactFlareTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const cx = size * 0.5;
    const cy = size * 0.5;
    const radius = size * 0.5;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0.0, "rgba(255, 255, 255, 1.0)");
    gradient.addColorStop(0.18, "rgba(255, 255, 255, 0.9)");
    gradient.addColorStop(0.38, "rgba(255, 255, 255, 0.45)");
    gradient.addColorStop(0.62, "rgba(255, 255, 255, 0.14)");
    gradient.addColorStop(0.85, "rgba(255, 255, 255, 0.025)");
    gradient.addColorStop(1.0, "rgba(255, 255, 255, 0.0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

const PLUME_VERTEX_SHADER = /* glsl */ `
attribute vec3 aPlumeColor;
attribute float aPlumeAlpha;
attribute float aPlumeSeed;

varying vec2 vUv;
varying vec3 vPlumeColor;
varying float vPlumeAlpha;
varying float vSeed;

void main() {
  vUv = uv;
  vPlumeColor = aPlumeColor;
  vPlumeAlpha = aPlumeAlpha;
  vSeed = aPlumeSeed;

  vec4 mvPosition = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const PLUME_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;

varying vec2 vUv;
varying vec3 vPlumeColor;
varying float vPlumeAlpha;
varying float vSeed;

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

float fbm2(vec2 p) {
  float v = 0.0;
  v += 0.65 * noise2D(p);
  v += 0.35 * noise2D(p * 2.07 + vec2(13.1, 7.7));
  return v;
}

void main() {
  if (vPlumeAlpha <= 0.002) discard;

  float curl = sin(vUv.y * 5.2 - uTime * 2.1 + vSeed) * 0.14 * vUv.y;
  vec2 nUv = vec2((vUv.x - 0.5 + curl) * 3.2 + vSeed * 0.37, vUv.y * 2.6 - uTime * 1.35);
  float n = fbm2(nUv);
  float wisp = smoothstep(0.24, 0.78, n);

  float nx = (vUv.x - 0.5) * 2.0;
  float horiz = exp(-nx * nx * 4.2) * max(0.0, 1.0 - nx * nx);
  float vert = smoothstep(0.0, 0.12, vUv.y) * pow(1.0 - vUv.y, 1.85);

  float alpha = horiz * vert * (0.28 + 0.72 * wisp) * vPlumeAlpha;
  gl_FragColor = vec4(vPlumeColor, alpha);
}
`;

const PARTICLE_VERTEX_SHADER = /* glsl */ `
attribute vec3 aPartColor;
attribute float aPartAlpha;
attribute float aPartKind;

varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vKind;

void main() {
  vUv = uv;
  vColor = aPartColor;
  vAlpha = aPartAlpha;
  vKind = aPartKind;

  vec4 mvPosition = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vKind;

void main() {
  vec2 p = vUv - 0.5;
  float r = length(p);

  if (vKind < 0.5) {
    // Ember: soft glowing bokeh disc with warm bright center + delicate outer halo
    float core = exp(-r * r * 7.0) * 0.75;
    float bokeh = smoothstep(0.5, 0.22, r) * 0.42;
    float shape = core + bokeh;
    if (shape < 0.01) discard;
    float a = shape * vAlpha;
    gl_FragColor = vec4(vColor, a);
  } else {
    // Spark: crisp tapered diamond/streak with bright white-hot core
    float d = abs(p.x) * 1.85 + abs(p.y);
    float shape = smoothstep(0.5, 0.04, d);
    if (shape < 0.01) discard;
    vec3 col = mix(vColor, vec3(1.0), smoothstep(0.32, 0.0, r) * 0.85);
    float a = shape * vAlpha;
    gl_FragColor = vec4(col, a);
  }
}
`;

export const HitEffects: React.FC = () => {
  const flareMeshRef = useRef<THREE.InstancedMesh>(null);
  const plumeMeshRef = useRef<THREE.InstancedMesh>(null);
  const particleMeshRef = useRef<THREE.InstancedMesh>(null);

  // Pre-allocated object helpers
  const tempObject = useMemo(() => new THREE.Object3D(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);
  const whiteColor = useMemo(() => new THREE.Color(1, 1, 1), []);
  const rightThreeColor = useMemo(() => new THREE.Color(), []);
  const leftThreeColor = useMemo(() => new THREE.Color(), []);

  // Hit Glow State (88 keys)
  const onsetFlash = useMemo(() => new Float32Array(KEY_COUNT), []);
  const holdGlow = useMemo(() => new Float32Array(KEY_COUNT), []);
  const lastActiveHand = useMemo(() => new Uint8Array(KEY_COUNT), []);
  const prevHandState = useMemo(() => new Uint8Array(KEY_COUNT), []);
  const holdSpawnAcc = useMemo(() => new Float32Array(KEY_COUNT), []);

  // Particle Ring Buffer State (MAX_PARTICLES = 900)
  const pActive = useMemo(() => new Uint8Array(MAX_PARTICLES), []);
  const pKind = useMemo(() => new Uint8Array(MAX_PARTICLES), []);
  const pX = useMemo(() => new Float32Array(MAX_PARTICLES), []);
  const pY = useMemo(() => new Float32Array(MAX_PARTICLES), []);
  const pVx = useMemo(() => new Float32Array(MAX_PARTICLES), []);
  const pVy = useMemo(() => new Float32Array(MAX_PARTICLES), []);
  const pAge = useMemo(() => new Float32Array(MAX_PARTICLES), []);
  const pLife = useMemo(() => new Float32Array(MAX_PARTICLES), []);
  const pSize = useMemo(() => new Float32Array(MAX_PARTICLES), []);
  const pPhase = useMemo(() => new Float32Array(MAX_PARTICLES), []);
  const pFreq = useMemo(() => new Float32Array(MAX_PARTICLES), []);
  const pR = useMemo(() => new Float32Array(MAX_PARTICLES), []);
  const pG = useMemo(() => new Float32Array(MAX_PARTICLES), []);
  const pB = useMemo(() => new Float32Array(MAX_PARTICLES), []);
  const pHeadRef = useRef<number>(0);

  // Plume instanced attribute buffers (zero GC in useFrame)
  const plumeColorArray = useMemo(() => new Float32Array(KEY_COUNT * 3), []);
  const plumeAlphaArray = useMemo(() => new Float32Array(KEY_COUNT), []);
  const plumeSeedArray = useMemo(() => {
    const arr = new Float32Array(KEY_COUNT);
    for (let k = 0; k < KEY_COUNT; k++) {
      arr[k] = k * 1.73;
    }
    return arr;
  }, []);

  const plumeColorAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(plumeColorArray, 3),
    [plumeColorArray]
  );
  const plumeAlphaAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(plumeAlphaArray, 1),
    [plumeAlphaArray]
  );
  const plumeSeedAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(plumeSeedArray, 1),
    [plumeSeedArray]
  );

  // Particle instanced attribute buffers (zero GC in useFrame)
  const partColorArray = useMemo(() => new Float32Array(MAX_PARTICLES * 3), []);
  const partAlphaArray = useMemo(() => new Float32Array(MAX_PARTICLES), []);
  const partKindArray = useMemo(() => new Float32Array(MAX_PARTICLES), []);

  const partColorAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(partColorArray, 3),
    [partColorArray]
  );
  const partAlphaAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(partAlphaArray, 1),
    [partAlphaArray]
  );
  const partKindAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(partKindArray, 1),
    [partKindArray]
  );

  // Geometries and materials
  const quadGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const plumeGeometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute("aPlumeColor", plumeColorAttr);
    geo.setAttribute("aPlumeAlpha", plumeAlphaAttr);
    geo.setAttribute("aPlumeSeed", plumeSeedAttr);
    return geo;
  }, [plumeColorAttr, plumeAlphaAttr, plumeSeedAttr]);

  const particleGeometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute("aPartColor", partColorAttr);
    geo.setAttribute("aPartAlpha", partAlphaAttr);
    geo.setAttribute("aPartKind", partKindAttr);
    return geo;
  }, [partColorAttr, partAlphaAttr, partKindAttr]);

  const flareTexture = useMemo(() => createImpactFlareTexture(), []);

  const flareMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: flareTexture,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [flareTexture]
  );

  const plumeMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
        },
        vertexShader: PLUME_VERTEX_SHADER,
        fragmentShader: PLUME_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      }),
    []
  );

  const particleMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: PARTICLE_VERTEX_SHADER,
        fragmentShader: PARTICLE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      }),
    []
  );

  // Setup instance buffers upfront and dispose on unmount
  useEffect(() => {
    if (flareMeshRef.current && !flareMeshRef.current.instanceColor) {
      flareMeshRef.current.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(KEY_COUNT * 3),
        3
      );
    }

    return () => {
      quadGeometry.dispose();
      plumeGeometry.dispose();
      particleGeometry.dispose();
      flareTexture.dispose();
      flareMaterial.dispose();
      plumeMaterial.dispose();
      particleMaterial.dispose();
    };
  }, [
    quadGeometry,
    plumeGeometry,
    particleGeometry,
    flareTexture,
    flareMaterial,
    plumeMaterial,
    particleMaterial,
  ]);

  useFrame((state, delta) => {
    const flareMesh = flareMeshRef.current;
    const plumeMesh = plumeMeshRef.current;
    const particleMesh = particleMeshRef.current;
    if (!flareMesh || !plumeMesh || !particleMesh) return;

    const { rightHandColor, leftHandColor, vfxPreset } = useThemeStore.getState();
    rightThreeColor.set(rightHandColor);
    leftThreeColor.set(leftHandColor);

    const clampedDelta = Math.min(0.1, delta);
    const pxPerWorldX = Math.max(1, state.size.width) / 52;
    const pxPerWorldY = Math.max(1, state.size.height) / 100;
    const worldAspect = pxPerWorldX / pxPerWorldY;

    plumeMaterial.uniforms.uTime.value = state.clock.elapsedTime;

    const showPlumes = vfxPreset !== "off";
    const isSmoke = vfxPreset === "smoke";
    const emitParticles = vfxPreset === "embers" || vfxPreset === "sparks";

    tempObject.rotation.set(0, 0, 0);

    // 1. Update 88 Key-Hit Impact Flares & Held-Key Light Plumes
    for (let k = 0; k < KEY_COUNT; k++) {
      const hand = activeNotes.getHand(k);
      const vel = activeNotes.getVelocity(k);
      const key = PIANO_KEYS[k];

      if (hand !== 0) {
        lastActiveHand[k] = hand;
        if (prevHandState[k] === 0) {
          onsetFlash[k] = Math.max(0.55, vel);
        }
        holdGlow[k] += (1.0 - holdGlow[k]) * Math.min(1.0, clampedDelta * 18.0);
      } else {
        holdGlow[k] *= Math.exp(-clampedDelta * 6.0);
        holdSpawnAcc[k] = 0;
      }

      onsetFlash[k] *= Math.exp(-clampedDelta * 11.0);

      const flash = onsetFlash[k];
      const hold = holdGlow[k];
      const baseColor =
        lastActiveHand[k] === 2 ? leftThreeColor : rightThreeColor;

      // Layer 1: Impact Flare centered at Y = 18.0 (z = 2.1)
      const flareActive = Math.max(flash, hold * 0.55);
      if (flareActive > 0.005) {
        const scaleX = key.width * (2.2 + flash * 1.4);
        const scaleY = scaleX * worldAspect * 0.55;
        tempObject.position.set(key.centerX, 18.0, 2.1);
        tempObject.scale.set(scaleX, scaleY, 1);
        tempObject.updateMatrix();
        flareMesh.setMatrixAt(k, tempObject.matrix);

        tempColor
          .copy(baseColor)
          .lerp(whiteColor, 0.35 * flash)
          .multiplyScalar((1.35 + flash * 0.7) * Math.min(1.0, flareActive * 1.25));
        flareMesh.setColorAt(k, tempColor);
      } else {
        tempObject.position.set(key.centerX, 18.0, -100);
        tempObject.scale.set(0, 0, 0);
        tempObject.updateMatrix();
        flareMesh.setMatrixAt(k, tempObject.matrix);
      }

      // Layer 2: Held-Key Wispy Smoke Plume rising from Y = 18.0 (z = 0.85)
      if (showPlumes && hold > 0.005) {
        const plumeH = isSmoke ? 10.5 + hold * 11.5 : 6.5 + hold * 5.5;
        const plumeW = isSmoke ? key.width * 3.2 : key.width * 2.3;
        const plumeAlpha = isSmoke ? 0.72 * hold : 0.36 * hold;

        tempObject.position.set(key.centerX, 18.0 + plumeH * 0.5, 0.85);
        tempObject.scale.set(plumeW, plumeH, 1);
        tempObject.updateMatrix();
        plumeMesh.setMatrixAt(k, tempObject.matrix);

        const cIdx = k * 3;
        plumeColorArray[cIdx] = baseColor.r;
        plumeColorArray[cIdx + 1] = baseColor.g;
        plumeColorArray[cIdx + 2] = baseColor.b;
        plumeAlphaArray[k] = plumeAlpha;
      } else {
        tempObject.position.set(key.centerX, 18.0, -100);
        tempObject.scale.set(0, 0, 0);
        tempObject.updateMatrix();
        plumeMesh.setMatrixAt(k, tempObject.matrix);
        plumeAlphaArray[k] = 0;
      }

      // 2. Spawn Two-Layer Particles (Impact Sparks + Bokeh Embers)
      if (emitParticles && hand !== 0) {
        const spawnColor = hand === 2 ? leftThreeColor : rightThreeColor;

        if (prevHandState[k] === 0) {
          // Impact Sparks (kind = 1): wide fan-out velocity-scaled burst
          const sparkCount = Math.round(2 + vel * 5);
          tempColor.copy(spawnColor).lerp(whiteColor, 0.5).multiplyScalar(2.2);

          for (let s = 0; s < sparkCount; s++) {
            const idx = pHeadRef.current;
            pHeadRef.current = (pHeadRef.current + 1) % MAX_PARTICLES;

            pActive[idx] = 1;
            pKind[idx] = 1;
            pX[idx] = key.centerX + (Math.random() - 0.5) * key.width * 0.95;
            pY[idx] = 18.0 + Math.random() * 0.5;
            pVx[idx] = ((Math.random() - 0.5) * 38.0) / worldAspect;
            pVy[idx] = (16.0 + Math.random() * 18.0) * Math.max(0.5, vel);
            pLife[idx] = 0.3 + Math.random() * 0.32;
            pAge[idx] = 0;
            pSize[idx] = 0.45 + Math.random() * 0.35;
            pR[idx] = tempColor.r;
            pG[idx] = tempColor.g;
            pB[idx] = tempColor.b;
          }

          // Bokeh Embers (kind = 0) on onset when preset is "embers"
          if (vfxPreset === "embers") {
            const emberCount = 2 + Math.floor(Math.random() * 3);
            const emberBright = 1.5 * (0.45 + 0.55 * vel);
            for (let e = 0; e < emberCount; e++) {
              const idx = pHeadRef.current;
              pHeadRef.current = (pHeadRef.current + 1) % MAX_PARTICLES;

              pActive[idx] = 1;
              pKind[idx] = 0;
              pX[idx] = key.centerX + (Math.random() - 0.5) * key.width * 0.8;
              pY[idx] = 18.1 + Math.random() * 0.6;
              pVx[idx] = ((Math.random() - 0.5) * 3.5) / worldAspect;
              pVy[idx] = (6.0 + Math.random() * 8.0) * Math.max(0.5, vel);
              pLife[idx] = 0.75 + Math.random() * 0.8;
              pAge[idx] = 0;
              pSize[idx] = 0.55 + Math.random() * 0.9;
              pPhase[idx] = Math.random() * Math.PI * 2;
              pFreq[idx] = 2.5 + Math.random() * 3.0;
              pR[idx] = spawnColor.r * emberBright;
              pG[idx] = spawnColor.g * emberBright;
              pB[idx] = spawnColor.b * emberBright;
            }
          }
        } else if (vfxPreset === "embers") {
          // Subtle hold-trickle bokeh embers while key is sustained
          holdSpawnAcc[k] += clampedDelta * (4.0 + vel * 5.0);
          if (holdSpawnAcc[k] >= 1.0) {
            holdSpawnAcc[k] %= 1.0;
            const idx = pHeadRef.current;
            pHeadRef.current = (pHeadRef.current + 1) % MAX_PARTICLES;
            const emberBright = 1.45 * (0.45 + 0.55 * vel);

            pActive[idx] = 1;
            pKind[idx] = 0;
            pX[idx] = key.centerX + (Math.random() - 0.5) * key.width * 0.75;
            pY[idx] = 18.2 + Math.random() * 0.5;
            pVx[idx] = ((Math.random() - 0.5) * 2.5) / worldAspect;
            pVy[idx] = 6.0 + Math.random() * 6.0;
            pLife[idx] = 0.8 + Math.random() * 0.75;
            pAge[idx] = 0;
            pSize[idx] = 0.55 + Math.random() * 0.85;
            pPhase[idx] = Math.random() * Math.PI * 2;
            pFreq[idx] = 2.2 + Math.random() * 2.8;
            pR[idx] = spawnColor.r * emberBright;
            pG[idx] = spawnColor.g * emberBright;
            pB[idx] = spawnColor.b * emberBright;
          }
        }
      }

      prevHandState[k] = hand;
    }

    flareMesh.instanceMatrix.needsUpdate = true;
    if (flareMesh.instanceColor) flareMesh.instanceColor.needsUpdate = true;
    plumeMesh.instanceMatrix.needsUpdate = true;
    plumeColorAttr.needsUpdate = true;
    plumeAlphaAttr.needsUpdate = true;

    // 3. Update Particle Ring Buffer
    if (!emitParticles) {
      if (particleMesh.count > 0) {
        pActive.fill(0);
        particleMesh.count = 0;
        particleMesh.instanceMatrix.needsUpdate = true;
      }
      return;
    }

    let activeCount = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (pActive[i] === 0) continue;

      pAge[i] += clampedDelta;
      if (pAge[i] >= pLife[i]) {
        pActive[i] = 0;
        continue;
      }

      const progress = pAge[i] / pLife[i];
      let alpha = 0;

      if (pKind[i] === 1) {
        // Impact Spark
        pVx[i] *= Math.exp(-clampedDelta * 2.5);
        pVy[i] *= Math.exp(-clampedDelta * 3.8);
        pX[i] += pVx[i] * clampedDelta;
        pY[i] += pVy[i] * clampedDelta;

        alpha = Math.pow(1.0 - progress, 1.6);
        const speedRatio = Math.min(
          1.0,
          Math.hypot(pVx[i] * worldAspect, pVy[i]) / 32.0
        );

        tempObject.position.set(pX[i], pY[i], 1.25);
        tempObject.rotation.z = Math.atan2(-pVx[i], Math.max(0.1, pVy[i])) * 0.35;
        tempObject.scale.set(
          (pSize[i] * 1.15) / worldAspect,
          pSize[i] * (1.3 + speedRatio * 1.15),
          1
        );
      } else {
        // Dreamy Bokeh Ember
        pVy[i] *= Math.exp(-clampedDelta * 0.7);
        pX[i] +=
          pVx[i] * clampedDelta +
          Math.sin(pAge[i] * pFreq[i] + pPhase[i]) * (0.9 / worldAspect) * clampedDelta;
        pY[i] += pVy[i] * clampedDelta;

        alpha = Math.min(1.0, progress / 0.15) * Math.pow(1.0 - progress, 1.3);

        tempObject.position.set(pX[i], pY[i], 1.15);
        tempObject.rotation.z = 0;
        tempObject.scale.set(pSize[i] / worldAspect, pSize[i], 1);
      }

      tempObject.updateMatrix();
      particleMesh.setMatrixAt(activeCount, tempObject.matrix);

      const cIdx = activeCount * 3;
      partColorArray[cIdx] = pR[i];
      partColorArray[cIdx + 1] = pG[i];
      partColorArray[cIdx + 2] = pB[i];
      partAlphaArray[activeCount] = alpha;
      partKindArray[activeCount] = pKind[i];

      activeCount++;
    }

    particleMesh.count = activeCount;
    particleMesh.instanceMatrix.needsUpdate = true;
    if (activeCount > 0) {
      partColorAttr.needsUpdate = true;
      partAlphaAttr.needsUpdate = true;
      partKindAttr.needsUpdate = true;
    }
  });

  return (
    <group>
      {/* 88 Key-Hit Impact Flares (centered at Y = 18.0) */}
      <instancedMesh
        ref={flareMeshRef}
        args={[quadGeometry, flareMaterial, KEY_COUNT]}
        frustumCulled={false}
      />

      {/* 88 Held-Key Wispy Smoke Plumes (rising from Y = 18.0) */}
      <instancedMesh
        ref={plumeMeshRef}
        args={[plumeGeometry, plumeMaterial, KEY_COUNT]}
        frustumCulled={false}
      />

      {/* 900 Instanced Sparks & Bokeh Embers */}
      <instancedMesh
        ref={particleMeshRef}
        args={[particleGeometry, particleMaterial, MAX_PARTICLES]}
        frustumCulled={false}
      />
    </group>
  );
};
