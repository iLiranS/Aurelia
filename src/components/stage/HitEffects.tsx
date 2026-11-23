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

function createVerticalPlumeTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;

    for (let py = 0; py < size; py++) {
      // Canvas y=0 is top (v=1), y=size-1 is bottom (v=0 at Y=18.0)
      const v = 1.0 - py / (size - 1);
      let vert = 0;
      if (v < 0.15) {
        vert = Math.sin((v / 0.15) * Math.PI * 0.5);
      } else {
        const t = (v - 0.15) / 0.85;
        vert = Math.pow(1.0 - t, 2.2);
      }

      for (let px = 0; px < size; px++) {
        const nx = (px / (size - 1)) * 2.0 - 1.0;
        const horiz = Math.exp(-nx * nx * 4.5) * Math.max(0.0, 1.0 - nx * nx);
        const alpha = Math.max(0.0, Math.min(1.0, horiz * vert));

        const idx = (py * size + px) * 4;
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = Math.round(alpha * 255);
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createOrbTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const c = size * 0.5;
    const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
    gradient.addColorStop(0.0, "rgba(255, 255, 255, 1.0)");
    gradient.addColorStop(0.14, "rgba(255, 255, 255, 0.92)");
    gradient.addColorStop(0.35, "rgba(255, 255, 255, 0.42)");
    gradient.addColorStop(0.68, "rgba(255, 255, 255, 0.08)");
    gradient.addColorStop(1.0, "rgba(255, 255, 255, 0.0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

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

  // Geometries and materials
  const quadGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const flareTexture = useMemo(() => createImpactFlareTexture(), []);
  const plumeTexture = useMemo(() => createVerticalPlumeTexture(), []);
  const orbTexture = useMemo(() => createOrbTexture(), []);

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
      new THREE.MeshBasicMaterial({
        map: plumeTexture,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [plumeTexture]
  );

  const particleMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: orbTexture,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [orbTexture]
  );

  // Setup instance buffers upfront
  useEffect(() => {
    if (flareMeshRef.current && !flareMeshRef.current.instanceColor) {
      flareMeshRef.current.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(KEY_COUNT * 3),
        3
      );
    }
    if (plumeMeshRef.current && !plumeMeshRef.current.instanceColor) {
      plumeMeshRef.current.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(KEY_COUNT * 3),
        3
      );
    }
    if (particleMeshRef.current && !particleMeshRef.current.instanceColor) {
      particleMeshRef.current.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(MAX_PARTICLES * 3),
        3
      );
    }
  }, []);

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

    const showPlumes = vfxPreset !== "off";
    const plumeBoost = vfxPreset === "mist" ? 1.25 : 1.0;
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

      // Layer 2: Held-Key Light Plume rising from Y = 18.0 (z = 0.85)
      if (showPlumes && hold > 0.005) {
        const plumeH = (7.0 + hold * 6.5) * plumeBoost;
        const plumeW = key.width * 2.4;
        tempObject.position.set(key.centerX, 18.0 + plumeH * 0.5, 0.85);
        tempObject.scale.set(plumeW, plumeH, 1);
        tempObject.updateMatrix();
        plumeMesh.setMatrixAt(k, tempObject.matrix);

        tempColor.copy(baseColor).multiplyScalar(0.45 * hold * plumeBoost);
        plumeMesh.setColorAt(k, tempColor);
      } else {
        tempObject.position.set(key.centerX, 18.0, -100);
        tempObject.scale.set(0, 0, 0);
        tempObject.updateMatrix();
        plumeMesh.setMatrixAt(k, tempObject.matrix);
      }

      // 2. Spawn Two-Layer Particles (Impact Sparks + Bokeh Embers)
      if (emitParticles && hand !== 0) {
        const spawnColor = hand === 2 ? leftThreeColor : rightThreeColor;

        if (prevHandState[k] === 0) {
          // Impact Sparks (kind = 1): tight velocity-scaled burst
          const sparkCount = Math.round(4 + vel * 3);
          tempColor.copy(spawnColor).lerp(whiteColor, 0.35).multiplyScalar(2.1);

          for (let s = 0; s < sparkCount; s++) {
            const idx = pHeadRef.current;
            pHeadRef.current = (pHeadRef.current + 1) % MAX_PARTICLES;

            pActive[idx] = 1;
            pKind[idx] = 1;
            pX[idx] = key.centerX + (Math.random() - 0.5) * key.width * 0.6;
            pY[idx] = 18.0 + Math.random() * 0.5;
            pVx[idx] = ((Math.random() - 0.5) * 18.0) / worldAspect;
            pVy[idx] = (18.0 + Math.random() * 18.0) * Math.max(0.5, vel);
            pLife[idx] = 0.28 + Math.random() * 0.32;
            pAge[idx] = 0;
            pSize[idx] = 0.45 + Math.random() * 0.35;
            pR[idx] = tempColor.r;
            pG[idx] = tempColor.g;
            pB[idx] = tempColor.b;
          }

          // Bokeh Embers (kind = 0) on onset when preset is "embers"
          if (vfxPreset === "embers") {
            const emberCount = 2 + Math.floor(Math.random() * 3);
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
              pR[idx] = spawnColor.r * 1.5;
              pG[idx] = spawnColor.g * 1.5;
              pB[idx] = spawnColor.b * 1.5;
            }
          }
        } else if (vfxPreset === "embers") {
          // Subtle hold-trickle bokeh embers while key is sustained
          holdSpawnAcc[k] += clampedDelta * (4.0 + vel * 5.0);
          if (holdSpawnAcc[k] >= 1.0) {
            holdSpawnAcc[k] %= 1.0;
            const idx = pHeadRef.current;
            pHeadRef.current = (pHeadRef.current + 1) % MAX_PARTICLES;

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
            pR[idx] = spawnColor.r * 1.45;
            pG[idx] = spawnColor.g * 1.45;
            pB[idx] = spawnColor.b * 1.45;
          }
        }
      }

      prevHandState[k] = hand;
    }

    flareMesh.instanceMatrix.needsUpdate = true;
    if (flareMesh.instanceColor) flareMesh.instanceColor.needsUpdate = true;
    plumeMesh.instanceMatrix.needsUpdate = true;
    if (plumeMesh.instanceColor) plumeMesh.instanceColor.needsUpdate = true;

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
          (pSize[i] * 0.48) / worldAspect,
          pSize[i] * (1.2 + speedRatio * 1.1),
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

      tempColor.setRGB(pR[i] * alpha, pG[i] * alpha, pB[i] * alpha);
      particleMesh.setColorAt(activeCount, tempColor);

      activeCount++;
    }

    particleMesh.count = activeCount;
    particleMesh.instanceMatrix.needsUpdate = true;
    if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      {/* 88 Key-Hit Impact Flares (centered at Y = 18.0) */}
      <instancedMesh
        ref={flareMeshRef}
        args={[quadGeometry, flareMaterial, KEY_COUNT]}
        frustumCulled={false}
      />

      {/* 88 Held-Key Light Plumes (rising from Y = 18.0) */}
      <instancedMesh
        ref={plumeMeshRef}
        args={[quadGeometry, plumeMaterial, KEY_COUNT]}
        frustumCulled={false}
      />

      {/* 900 Instanced Sparks & Bokeh Embers */}
      <instancedMesh
        ref={particleMeshRef}
        args={[quadGeometry, particleMaterial, MAX_PARTICLES]}
        frustumCulled={false}
      />
    </group>
  );
};
