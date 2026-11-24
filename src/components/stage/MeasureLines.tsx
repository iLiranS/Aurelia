import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useThemeStore } from "@/stores/useThemeStore";
import { useViewStore } from "@/stores/useViewStore";
import { playbackClock } from "@/engine/playbackClock";

const MAX_VISIBLE_MEASURES = 128;

function findFirstMeasureIndex(times: number[], targetSec: number): number {
  let low = 0;
  let high = times.length - 1;
  let result = times.length;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (times[mid] >= targetSec) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return result;
}

/**
 * Instanced horizontal measure/bar lines synchronized to playbackClock.
 */
export const MeasureLines: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tempObject = useMemo(() => new THREE.Object3D(), []);
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.1,
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

  useFrame(({ size }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const viewMode = useViewStore.getState().viewMode;
    const { showMeasureLines, lookaheadSec } = useThemeStore.getState();
    const measureTimes = useLibraryStore.getState().activeSong?.measureTimesSec;

    if (
      viewMode !== "song" ||
      !showMeasureLines ||
      !measureTimes ||
      measureTimes.length === 0
    ) {
      if (mesh.count > 0) {
        mesh.count = 0;
        mesh.instanceMatrix.needsUpdate = true;
      }
      return;
    }

    const now = playbackClock.getTime();
    const safeLookahead = Math.max(0.5, lookaheadSec);
    const pixelsPerSec = 82 / safeLookahead;
    const windowEnd = now + safeLookahead;
    const lineHeight = (1.1 / Math.max(1, size.height)) * 100;

    const startIdx = findFirstMeasureIndex(measureTimes, now);
    let instanceCount = 0;

    for (
      let i = startIdx;
      i < measureTimes.length && instanceCount < MAX_VISIBLE_MEASURES;
      i++
    ) {
      const t = measureTimes[i];
      if (t > windowEnd) break;

      const y = 18 + (t - now) * pixelsPerSec;
      tempObject.position.set(26, y, 0.06);
      tempObject.scale.set(52, lineHeight, 1);
      tempObject.updateMatrix();
      mesh.setMatrixAt(instanceCount, tempObject.matrix);
      instanceCount++;
    }

    if (instanceCount > 0 || mesh.count > 0) {
      mesh.count = instanceCount;
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_VISIBLE_MEASURES]}
      frustumCulled={false}
    />
  );
};
