// WebGL2 renderer for the shared cube model (site/lib/cube.mjs).
//
// 26 rounded black cubies, a black core so nothing is see-through mid-turn, and 54
// glossy rounded-square stickers drawn as SDF quads. Lighting is a key light plus a
// fake studio environment, enough to read as plastic without any textures.

import { mulMV, mulMM, rotAxisAngle, stickerTangents, letterOf } from '../lib/cube.mjs';

export const STICKER_HEX = { U: '#f4f8ff', D: '#ffd23f', F: '#2fe38a', B: '#3d8bff', R: '#ff4f64', L: '#ff9a3c' };
const rgb01 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

// ------------------------------------------------------------------ tiny matrix kit (column-major)
function mul4(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const o = new Float32Array(16);
  o[0] = f / aspect;
  o[5] = f;
  o[10] = (far + near) / (near - far);
  o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
}

function lookAt(eye, center, up) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const nrm = (v) => {
    const l = Math.hypot(...v);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = nrm(sub(eye, center));
  const x = nrm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

/** Row-major 3x3 rotation + translation -> column-major 4x4. */
function model4(rot, pos) {
  return new Float32Array([rot[0], rot[3], rot[6], 0, rot[1], rot[4], rot[7], 0, rot[2], rot[5], rot[8], 0, pos[0], pos[1], pos[2], 1]);
}

// ------------------------------------------------------------------ geometry
/** A unit cube with rounded edges: the classic "clamp, then push out along the offset" construction. */
function roundedBox(r) {
  const lines = [-0.5, -0.5 + r * 0.28, -0.5 + r * 0.62, -0.5 + r, 0.5 - r, 0.5 - r * 0.62, 0.5 - r * 0.28, 0.5];
  const L = lines.length;
  const inner = 0.5 - r;
  const verts = [];
  const idx = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const u = (axis + 1) % 3;
      const v = (axis + 2) % 3;
      const base = verts.length / 8;
      for (let j = 0; j < L; j++) {
        for (let i = 0; i < L; i++) {
          const p = [0, 0, 0];
          p[axis] = 0.5 * sign;
          p[u] = lines[i];
          p[v] = lines[j];
          const q = p.map((c) => Math.max(-inner, Math.min(inner, c)));
          const n = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
          const len = Math.hypot(...n) || 1;
          n[0] /= len;
          n[1] /= len;
          n[2] /= len;
          verts.push(q[0] + n[0] * r, q[1] + n[1] * r, q[2] + n[2] * r, n[0], n[1], n[2], 0, 0);
        }
      }
      for (let j = 0; j < L - 1; j++) {
        for (let i = 0; i < L - 1; i++) {
          const a = base + j * L + i;
          const b = a + 1;
          const c = a + L;
          const d = c + 1;
          if (sign > 0) idx.push(a, b, d, a, d, c);
          else idx.push(a, d, b, a, c, d);
        }
      }
    }
  }
  return { verts: new Float32Array(verts), idx: new Uint16Array(idx) };
}

const QUAD = {
  verts: new Float32Array([
    -1, -1, 0, 0, 0, 1, -1, -1,
    1, -1, 0, 0, 0, 1, 1, -1,
    1, 1, 0, 0, 0, 1, 1, 1,
    -1, 1, 0, 0, 0, 1, -1, 1,
  ]),
  idx: new Uint16Array([0, 1, 2, 0, 2, 3]),
};

// ------------------------------------------------------------------ shaders
const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUV;
uniform mat4 uVP;
uniform mat4 uModel;
out vec3 vN;
out vec3 vW;
out vec2 vUV;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = mat3(uModel) * aNrm;
  vUV = aUV;
  gl_Position = uVP * w;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vW;
in vec2 vUV;
uniform vec3 uCam;
uniform vec3 uColor;
uniform int uKind;
uniform float uGlow;
out vec4 o;

float sdRound(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 env(vec3 d){
  d = normalize(d);
  float u = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(vec3(0.03, 0.05, 0.10), vec3(0.45, 0.62, 0.95), pow(u, 1.8));
  float b1 = smoothstep(0.86, 0.985, dot(d, normalize(vec3(-0.35, 0.8, 0.5))));
  float b2 = smoothstep(0.90, 0.99, dot(d, normalize(vec3(0.7, 0.25, -0.4))));
  return sky + b1 * vec3(1.0, 0.96, 0.9) * 1.5 + b2 * vec3(0.5, 0.8, 1.0) * 0.8;
}

void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  vec3 Ld = normalize(vec3(-0.45, 0.85, 0.55));
  float wrap = max(dot(N, Ld), 0.0) * 0.7 + 0.3;
  vec3 base;
  float alpha = 1.0;
  if (uKind == 1) {
    float d = sdRound(vUV, vec2(1.0), 0.30);
    float aa = max(fwidth(d), 1e-3);
    alpha = 1.0 - smoothstep(-aa, aa, d);
    float edge = smoothstep(-0.34, -0.02, d);
    base = uColor * (1.0 - 0.15 * edge) + 0.05 * (1.0 - edge);
  } else {
    base = vec3(0.035, 0.043, 0.07);
  }
  vec3 H = normalize(Ld + V);
  float spec = pow(max(dot(N, H), 0.0), uKind == 1 ? 70.0 : 40.0) * (uKind == 1 ? 0.5 : 0.35);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 e = env(reflect(-V, N));
  vec3 col = base * (0.44 + 0.66 * wrap) + spec + e * (uKind == 1 ? 0.10 : 0.16) * (0.35 + fres) + fres * vec3(0.20, 0.45, 0.9) * 0.25;
  col += base * uGlow * 0.30;
  col = col / (1.0 + 0.12 * col);
  o = vec4(col * alpha, alpha);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

// ------------------------------------------------------------------ renderer
export class CubeRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(prog)}`);
    this.prog = prog;
    this.u = Object.fromEntries(['uVP', 'uModel', 'uCam', 'uColor', 'uKind', 'uGlow'].map((n) => [n, gl.getUniformLocation(prog, n)]));

    this.body = this.upload(roundedBox(0.12));
    this.quad = this.upload(QUAD);
    this.colors = Object.fromEntries(Object.entries(STICKER_HEX).map(([k, v]) => [k, rgb01(v)]));
    this.stickerCache = new Map();
    this.core = new Float32Array([2.74, 0, 0, 0, 0, 2.74, 0, 0, 0, 0, 2.74, 0, 0, 0, 0, 1]);
  }

  upload(mesh) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: mesh.idx.length };
  }

  /** Local sticker transforms for one cubie, cached by its home position. */
  stickersFor(cubie) {
    const key = cubie.home.join(',');
    let list = this.stickerCache.get(key);
    if (list) return list;
    list = [];
    const s = 0.43;
    const h = 0.5 + 0.004;
    for (let i = 0; i < 3; i++) {
      if (!cubie.home[i]) continue;
      const n = [0, 0, 0];
      n[i] = Math.sign(cubie.home[i]);
      const [t1, t2] = stickerTangents(n);
      const S = new Float32Array([t1[0] * s, t1[1] * s, t1[2] * s, 0, t2[0] * s, t2[1] * s, t2[2] * s, 0, n[0], n[1], n[2], 0, n[0] * h, n[1] * h, n[2] * h, 1]);
      list.push({ S, color: this.colors[letterOf(n)] });
    }
    this.stickerCache.set(key, list);
    return list;
  }

  resize() {
    const c = this.canvas;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return { w, h };
  }

  /**
   * @param {object} s
   * @param {Array} s.cubies  state from lib/cube.mjs
   * @param {{axis:number,sign:number,angle:number}|null} s.anim  layer turn in progress
   * @param {number} s.yaw @param {number} s.pitch @param {number} s.glow
   */
  render({ cubies, anim, yaw, pitch, glow = 0 }) {
    const gl = this.gl;
    const { w, h } = this.resize();
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    const aspect = w / h;
    const dist = 11.6 * Math.max(1, 0.94 / aspect);
    const eye = [dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.sin(pitch), dist * Math.cos(pitch) * Math.cos(yaw)];
    const VP = mul4(perspective((28 * Math.PI) / 180, aspect, 1, 40), lookAt(eye, [0, 0, 0], [0, 1, 0]));

    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uVP, false, VP);
    gl.uniform3fv(this.u.uCam, eye);
    gl.uniform1f(this.u.uGlow, glow);

    const R = anim ? rotAxisAngle(anim.axis, anim.angle) : null;
    const models = cubies.map((c) => {
      if (R && c.pos[anim.axis] === anim.sign) return model4(mulMM(R, c.rot), mulMV(R, c.pos));
      return model4(c.rot, c.pos);
    });

    // opaque: core + bodies
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.body.vao);
    gl.uniform1i(this.u.uKind, 0);
    gl.uniform3f(this.u.uColor, 0, 0, 0);
    gl.uniformMatrix4fv(this.u.uModel, false, this.core);
    gl.drawElements(gl.TRIANGLES, this.body.count, gl.UNSIGNED_SHORT, 0);
    for (const M of models) {
      gl.uniformMatrix4fv(this.u.uModel, false, M);
      gl.drawElements(gl.TRIANGLES, this.body.count, gl.UNSIGNED_SHORT, 0);
    }

    // stickers
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.quad.vao);
    gl.uniform1i(this.u.uKind, 1);
    cubies.forEach((c, k) => {
      for (const st of this.stickersFor(c)) {
        gl.uniformMatrix4fv(this.u.uModel, false, mul4(models[k], st.S));
        gl.uniform3fv(this.u.uColor, st.color);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      }
    });
    gl.bindVertexArray(null);
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
