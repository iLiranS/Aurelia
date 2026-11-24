import * as THREE from "three";

const VERTEX_SHADER = /* glsl */ `
attribute float aDepression;
attribute vec3 aActiveColor;
attribute float aActiveMix;
attribute float aDimmed;
attribute float aCenterX;

varying vec2 vUv;
varying float vDepression;
varying vec3 vActiveColor;
varying float vActiveMix;
varying float vDimmed;
varying float vCenterX;

void main() {
  vUv = uv;
  vDepression = aDepression;
  vActiveColor = aActiveColor;
  vActiveMix = aActiveMix;
  vDimmed = aDimmed;
  vCenterX = aCenterX;

  vec4 mvPosition = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif
  mvPosition = modelViewMatrix * mvPosition;

  gl_Position = projectionMatrix * mvPosition;
}
`;

const WHITE_FRAGMENT_SHADER = /* glsl */ `
uniform vec2 uPxPerWorld;
uniform float uVignetteEnabled;

varying vec2 vUv;
varying float vDepression;
varying vec3 vActiveColor;
varying float vActiveMix;
varying float vDimmed;
varying float vCenterX;

void main() {
  vec2 keyPx = vec2(0.94, 17.6 - 0.32 * vDepression) * uPxPerWorld;
  vec2 halfPx = keyPx * 0.5;
  vec2 p = (vUv - 0.5) * keyPx;

  // Rounded bottom corners (~3px), square top corners under fallboard
  float r = (p.y < 0.0) ? min(3.0, min(halfPx.x, halfPx.y) * 0.4) : 0.0;
  vec2 q = abs(p) - (halfPx - vec2(r));
  float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;

  float alpha = 1.0 - smoothstep(-0.75, 0.75, dist);
  if (alpha < 0.01) discard;

  // Warm studio ivory (linear RGB; converted via colorspace_fragment)
  vec3 col = mix(vec3(0.71, 0.70, 0.67), vec3(0.075, 0.08, 0.095), vDimmed);

  // Top fallboard ambient occlusion
  col *= mix(0.72, 1.0, smoothstep(1.0, 0.82, vUv.y));

  // Subtle, natural 3D ivory front bevel that compresses on key press
  float lipH = mix(0.052, 0.018, vDepression);
  float lipMask = 1.0 - smoothstep(lipH - 0.018, lipH + 0.012, vUv.y);
  float lipGrad = smoothstep(0.0, max(lipH, 0.001), vUv.y);
  float lipShade = mix(0.68, 0.89, lipGrad);
  float ridge = exp(-pow((vUv.y - lipH) * keyPx.y * 0.45, 2.0)) * 0.028 * (1.0 - vDimmed);
  col *= mix(1.0, lipShade, lipMask);
  col += ridge;

  // Inner side-shadow depth cue when depressed
  float sideShadow = smoothstep(0.32, 0.5, abs(vUv.x - 0.5)) * vDepression * 0.35;
  col *= (1.0 - sideShadow);

  // Hand / waiting color wash (strongest near hit line, softer near bottom labels)
  float wash = mix(0.42, 0.92, smoothstep(0.06, 0.85, vUv.y)) * vActiveMix;
  col = mix(col, vActiveColor, wash);

  // Horizontal edge vignette across the 52-key bed
  float edge = abs(vCenterX / 52.0 - 0.5) * 2.0;
  float vig = mix(1.0, 0.62, smoothstep(0.55, 1.0, edge) * uVignetteEnabled);
  col *= vig;

  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

const BLACK_FRAGMENT_SHADER = /* glsl */ `
uniform vec2 uPxPerWorld;
uniform float uVignetteEnabled;

varying vec2 vUv;
varying float vDepression;
varying vec3 vActiveColor;
varying float vActiveMix;
varying float vDimmed;
varying float vCenterX;

void main() {
  // Quad is 0.78 x 11.4; physical key is central 0.62 x 11.0 anchored at top
  vec2 quadPx = vec2(0.78, 11.4 - 0.22 * vDepression) * uPxPerWorld;
  vec2 physSizePx = vec2(0.62, 11.0 - 0.22 * vDepression) * uPxPerWorld;
  vec2 physCenterUv = vec2(0.5, 0.51754);
  vec2 p = (vUv - physCenterUv) * quadPx;
  vec2 halfPx = physSizePx * 0.5;

  float r = (p.y < 0.0) ? min(2.5, halfPx.x * 0.35) : 0.0;
  vec2 q = abs(p) - (halfPx - vec2(r));
  float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;

  float keyMask = 1.0 - smoothstep(-0.75, 0.75, dist);
  float shadowSpanPx = max(2.5, 0.08 * uPxPerWorld.x);
  float shadowAlpha = (1.0 - smoothstep(0.0, shadowSpanPx, dist)) * 0.32;

  float finalAlpha = max(keyMask, shadowAlpha);
  if (finalAlpha < 0.01) discard;

  // True deep ebony base (linear RGB; converted via colorspace_fragment)
  vec3 col = mix(vec3(0.010, 0.011, 0.014), vec3(0.004, 0.004, 0.006), vDimmed);

  // Top fallboard AO
  col *= mix(0.68, 1.0, smoothstep(1.0, 0.85, vUv.y));

  // Glossy sloped top-front bevel & center sheen
  float physY = clamp((vUv.y - 0.03509) / 0.96491, 0.0, 1.0);
  float bevelH = mix(0.11, 0.05, vDepression);
  float bevelHighlight = exp(-pow((physY - bevelH) * 28.0, 2.0)) * 0.035 * (1.0 - vDimmed);
  float frontShade = mix(0.52, 1.0, smoothstep(0.0, bevelH, physY));
  float centerSheen = (1.0 - smoothstep(0.0, 0.35, abs(vUv.x - 0.5))) * 0.012 * (1.0 - vDimmed);
  col = col * frontShade + bevelHighlight + centerSheen;

  // Hand / waiting color wash
  col = mix(col, vActiveColor * 0.85, mix(0.55, 0.95, physY) * vActiveMix);

  // Horizontal edge vignette
  float edge = abs(vCenterX / 52.0 - 0.5) * 2.0;
  float vig = mix(1.0, 0.62, smoothstep(0.55, 1.0, edge) * uVignetteEnabled);
  col *= vig;

  vec3 finalCol = mix(vec3(0.0), col, keyMask);
  gl_FragColor = vec4(finalCol, finalAlpha);
  #include <colorspace_fragment>
}
`;

export function createKeyboardShaderMaterial(isBlack: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPxPerWorld: { value: new THREE.Vector2(24, 8) },
      uVignetteEnabled: { value: 1.0 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: isBlack ? BLACK_FRAGMENT_SHADER : WHITE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}
