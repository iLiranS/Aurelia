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

varying vec2 vUv;
varying vec2 vNoteDims;
varying vec3 vNoteColor;
varying float vStrike;

void main() {
  vec2 notePx = vNoteDims * uPxPerWorld;
  vec2 halfPx = notePx * 0.5;
  vec2 p = (vUv - 0.5) * notePx;

  float r = min(5.0, min(halfPx.x, halfPx.y) * 0.85);
  vec2 q = abs(p) - (halfPx - vec2(r));
  float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;

  float alpha = 1.0 - smoothstep(-0.75, 0.75, dist);
  if (alpha < 0.01) discard;

  // Subtle vertical gradient (0.86 at top -> 1.08 near bottom)
  float vertGrad = mix(1.08, 0.86, vUv.y);

  // Subtle 1.5px inner rim highlight
  float rim = smoothstep(-2.5, -0.5, dist) * 0.22;

  vec3 col = vNoteColor * (vertGrad + rim);

  // Luminous impact tip along the bottom 18px edge when crossing the hit line
  if (vStrike > 0.5) {
    float distFromBottomPx = vUv.y * notePx.y;
    float tipMask = 1.0 - smoothstep(0.0, 18.0, distFromBottomPx);
    col = mix(col, vec3(1.0), 0.30 * tipMask);
    col *= mix(1.0, 1.45, tipMask);
  }

  gl_FragColor = vec4(col, alpha);
}
`;

export function createNoteShaderMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPxPerWorld: { value: new THREE.Vector2(24, 8) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}
