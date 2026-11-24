import * as THREE from "three";

const VERTEX_SHADER = /* glsl */ `
attribute vec2 aNoteDims;
attribute vec3 aNoteColor;
attribute float aStrike;

varying vec2 vUv;
varying vec2 vNoteDims;
varying vec3 vNoteColor;
varying float vStrike;

void main() {
  vUv = uv;
  vNoteDims = aNoteDims;
  vNoteColor = aNoteColor;
  vStrike = aStrike;

  vec4 mvPosition = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif
  mvPosition = modelViewMatrix * mvPosition;

  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec2 uPxPerWorld;
uniform float uHaloPadPx;

varying vec2 vUv;
varying vec2 vNoteDims;
varying vec3 vNoteColor;
varying float vStrike;

void main() {
  vec2 notePx = vNoteDims * uPxPerWorld;
  vec2 quadPx = notePx + vec2(uHaloPadPx * 2.0);
  vec2 halfPx = notePx * 0.5;
  vec2 p = (vUv - 0.5) * quadPx;

  float r = min(5.0, min(halfPx.x, halfPx.y) * 0.85);
  vec2 q = abs(p) - (halfPx - vec2(r));
  float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;

  float bodyAlpha = 1.0 - smoothstep(-0.75, 0.75, dist);

  // Outer SDF halo (0 cost when uHaloPadPx == 0, suppressed on ghosted inactive-hand notes)
  float haloAlpha = 0.0;
  if (uHaloPadPx > 0.5 && dist > -0.75) {
    float lum = max(vNoteColor.r, max(vNoteColor.g, vNoteColor.b));
    float activeMask = smoothstep(0.20, 0.36, lum);
    float falloff = exp(-max(dist, 0.0) * 0.26) * smoothstep(uHaloPadPx, 0.0, dist);
    haloAlpha = falloff * mix(0.42, 0.78, vStrike) * activeMask;
  }

  float finalAlpha = max(bodyAlpha, haloAlpha);
  if (finalAlpha < 0.01) discard;

  // Subtle vertical gradient (0.86 at top -> 1.08 near bottom)
  float vertGrad = mix(1.08, 0.86, clamp((p.y + halfPx.y) / max(1.0, notePx.y), 0.0, 1.0));

  // Subtle 1.5px inner rim highlight
  float rim = smoothstep(-2.5, -0.5, dist) * 0.22;

  vec3 bodyCol = vNoteColor * (vertGrad + rim) * mix(1.0, 1.10, vStrike);

  // Luminous impact tip along the bottom 18px edge when crossing the hit line
  if (vStrike > 0.5) {
    float distFromBottomPx = max(0.0, p.y + halfPx.y);
    float tipMask = 1.0 - smoothstep(0.0, 18.0, distFromBottomPx);
    bodyCol = mix(bodyCol, vec3(1.0), 0.30 * tipMask);
    bodyCol *= mix(1.0, 1.45, tipMask);
  }

  vec3 haloCol = vNoteColor * mix(1.15, 1.38, vStrike);
  vec3 finalCol = mix(haloCol, bodyCol, bodyAlpha);
  gl_FragColor = vec4(finalCol, finalAlpha);
}
`;

export function createNoteShaderMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPxPerWorld: { value: new THREE.Vector2(24, 8) },
      uHaloPadPx: { value: 13.0 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}
