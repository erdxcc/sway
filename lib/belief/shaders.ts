/**
 * Belief-field shaders (GLSL ES 3.00 — OGL's Renderer runs on a WebGL2 context,
 * which is universal on current devices; no float render targets, no separate
 * bloom pass).
 *
 * Two fragment programs, both drawn on a single fullscreen triangle:
 *   - WAKE_FRAG    half-res RGBA8 ping-pong feedback: prev*decay + a soft splat
 *                  at the curve head. This accumulates "where belief has been"
 *                  as a glowing, slowly-rising, decaying field of light.
 *   - DISPLAY_FRAG one full-res pass: samples the 512×1 belief curve, draws it
 *                  as a signed-distance line with glow + a wide soft field below,
 *                  composites the wake, marks the "now" head, flashes a burst on
 *                  events, desaturates while the market is suspended, vignette +
 *                  tonemap. The glow comes from the distance-field falloff right
 *                  here — there is no separate blur pass.
 */

export const VERTEX = /* glsl */ `#version 300 es
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const WAKE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D tPrev;       // previous wake frame
uniform float uAspect;         // w/h, to keep the splat round
uniform float uDecay;          // per-frame multiplicative decay (from dt)
uniform float uDrift;          // upward drift in uv per frame (embers rising)
uniform vec2  uHead;           // head position (x = match time, y = pHome)
uniform vec3  uHeadColor;      // splat colour (favoured side)
uniform float uHeadIntensity;  // splat brightness (base + event burst)
uniform float uSigma;          // splat radius

void main() {
  // Sample the previous frame slightly below, so the trail drifts upward.
  vec3 prev = texture(tPrev, vUv + vec2(0.0, -uDrift)).rgb * uDecay;

  // Aspect-correct distance to the head so the deposited splat is circular.
  vec2 d = (vUv - uHead) * vec2(uAspect, 1.0);
  float g = exp(-dot(d, d) / (2.0 * uSigma * uSigma));
  vec3 splat = uHeadColor * (g * uHeadIntensity);

  fragColor = vec4(prev + splat, 1.0);
}
`;

export const DISPLAY_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D tCurve;      // 512x1 RGBA8: R=pHome, G=pAway, B=magnitude
uniform sampler2D tWake;       // accumulated wake (history as light)
uniform float uAspect;
uniform float uTime;
uniform float uHead;           // current x = minute / MATCH (0..1)
uniform float uP;              // current pHome
uniform float uPAway;          // current pAway
uniform float uBurst;          // 0..1 event flash
uniform float uSuspended;      // 0/1 market frozen
uniform vec3  uColorHome;
uniform vec3  uColorAway;
uniform vec3  uColorLevel;
uniform vec3  uColorBg;

void main() {
  vec2 uv = vUv;

  // --- sample the belief curve at this match-time column -------------------
  vec4 c = texture(tCurve, vec2(uv.x, 0.5));
  float curveP = c.r;                  // pHome at this x
  float curveA = c.g;                  // pAway at this x
  float hist = step(uv.x, uHead);      // only the played-so-far region is real

  // --- distance field to the belief line -----------------------------------
  float dist = abs(uv.y - curveP);
  float core = smoothstep(0.013, 0.0, dist);        // crisp bright line
  float band = smoothstep(0.36, 0.0, dist) * 0.5;   // wide soft field (the glow)
  float below = (1.0 - smoothstep(0.0, 0.5, uv.y - curveP)) *
                step(uv.y, curveP);                  // filled "body" under the line

  // --- colour by which side leads at this column ---------------------------
  float side = clamp((curveP - curveA) * 4.0, -1.0, 1.0);
  vec3 sideCol = mix(uColorAway, uColorHome, side * 0.5 + 0.5);
  sideCol = mix(uColorLevel, sideCol, clamp(abs(side) * 1.4, 0.22, 1.0));

  vec3 col = uColorBg;
  col += sideCol * (core * 1.4 + band * hist + below * 0.10 * hist);

  // --- accumulated wake (the field of light) -------------------------------
  col += texture(tWake, uv).rgb * 0.9;

  // --- the "now" head: bright dot + faint vertical sweep -------------------
  vec2 hd = (uv - vec2(uHead, uP)) * vec2(uAspect, 1.0);
  float headDot = exp(-dot(hd, hd) / 0.0009);
  float headX = smoothstep(0.004, 0.0, abs(uv.x - uHead));
  float headSide = clamp((uP - uPAway) * 4.0, -1.0, 1.0);
  vec3 headCol = mix(uColorAway, uColorHome, headSide * 0.5 + 0.5);
  col += headCol * (headDot * (1.2 + uBurst * 2.5));
  col += sideCol * headX * 0.12 * (0.6 + uBurst);

  // --- event burst: a cheap radial sparkle ring around the head ------------
  if (uBurst > 0.01) {
    float ang = atan(hd.y, hd.x);
    float r = length(hd);
    float spokes = pow(max(0.0, sin(ang * 9.0 + uTime * 3.0)), 8.0);
    float ring = exp(-pow((r - uBurst * 0.18) * 7.0, 2.0));
    col += headCol * spokes * ring * uBurst * 1.6;
  }

  // --- suspended: freeze + desaturate the whole field ----------------------
  if (uSuspended > 0.5) {
    float g = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(g) * 0.7, 0.7);
  }

  // --- vignette + soft tonemap ---------------------------------------------
  vec2 vd = uv - 0.5;
  col *= 1.0 - dot(vd, vd) * 0.8;
  col = col / (col + vec3(0.7)) * 1.7;

  fragColor = vec4(col, 1.0);
}
`;
