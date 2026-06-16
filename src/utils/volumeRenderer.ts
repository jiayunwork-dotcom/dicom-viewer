export interface VolumeData {
  data: Uint16Array;
  width: number;
  height: number;
  depth: number;
  voxelSize: {
    x: number;
    y: number;
    z: number;
  };
}

export interface CameraState {
  distance: number;
  azimuth: number;
  elevation: number;
  panX: number;
  panY: number;
}

export type ClippingAxis = 'axial' | 'sagittal' | 'coronal';

export interface ClippingPlane {
  axis: ClippingAxis;
  position: number;
}

const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler3D u_volume;
uniform sampler2D u_transferFunc;
uniform vec2 u_huRange;
uniform vec3 u_volumeSize;
uniform vec3 u_voxelSize;
uniform vec3 u_cameraPos;
uniform vec3 u_cameraTarget;
uniform vec3 u_cameraUp;
uniform float u_stepSize;
uniform vec3 u_clippingPlaneNormal;
uniform float u_clippingPlaneOffset;
uniform bool u_clippingEnabled;
uniform float u_canvasAspect;

uniform bool u_lightingEnabled;
uniform float u_ambientCoeff;
uniform float u_diffuseCoeff;
uniform float u_specularCoeff;

vec2 intersectBox(vec3 ro, vec3 rd, vec3 boxMin, vec3 boxMax) {
  vec3 invR = 1.0 / rd;
  vec3 tbot = invR * (boxMin - ro);
  vec3 ttop = invR * (boxMax - ro);
  vec3 tmin = min(ttop, tbot);
  vec3 tmax = max(ttop, tbot);
  vec2 t = max(tmin.xx, tmin.yz);
  float t0 = max(t.x, t.y);
  t = min(tmax.xx, tmax.yz);
  float t1 = min(t.x, t.y);
  return vec2(t0, t1);
}

float sampleVolume(vec3 uvw) {
  return texture(u_volume, clamp(uvw, 0.0, 1.0)).r;
}

vec3 computeGradient(vec3 uvw) {
  vec3 delta = vec3(1.0) / u_volumeSize;
  float dx = sampleVolume(uvw + vec3(delta.x, 0.0, 0.0)) - sampleVolume(uvw - vec3(delta.x, 0.0, 0.0));
  float dy = sampleVolume(uvw + vec3(0.0, delta.y, 0.0)) - sampleVolume(uvw - vec3(0.0, delta.y, 0.0));
  float dz = sampleVolume(uvw + vec3(0.0, 0.0, delta.z)) - sampleVolume(uvw - vec3(0.0, 0.0, delta.z));
  return vec3(dx, dy, dz) / (2.0 * delta);
}

vec3 phongLighting(vec3 normal, vec3 viewDir, vec3 lightDir, vec3 baseColor) {
  vec3 ambient = u_ambientCoeff * baseColor;
  float diff = max(dot(normal, lightDir), 0.0);
  vec3 diffuse = u_diffuseCoeff * diff * baseColor;
  vec3 reflectDir = reflect(-lightDir, normal);
  float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0);
  vec3 specular = u_specularCoeff * spec * vec3(1.0, 1.0, 1.0);
  return ambient + diffuse + specular;
}

void main() {
  vec3 boxMin = vec3(-0.5, -0.5, -0.5);
  vec3 boxMax = vec3(0.5, 0.5, 0.5);

  vec3 ro = u_cameraPos;
  vec3 target = u_cameraTarget;
  vec3 up = u_cameraUp;

  vec3 forward = normalize(target - ro);
  vec3 right = normalize(cross(forward, up));
  vec3 upReal = cross(right, forward);

  float fov = 1.0;
  vec2 uv = v_uv * 2.0 - 1.0;
  vec3 rd = normalize(forward + right * uv.x * fov * u_canvasAspect + upReal * uv.y * fov);

  vec2 t = intersectBox(ro, rd, boxMin, boxMax);

  if (t.x > t.y || t.y < 0.0) {
    outColor = vec4(0.02, 0.02, 0.05, 1.0);
    return;
  }

  float tStart = max(t.x, 0.0);
  float tEnd = t.y;
  float rayLength = tEnd - tStart;

  float baseStep = 0.002;
  float stepSize = baseStep * u_stepSize;

  int numSteps = int(max(1.0, ceil(rayLength / stepSize)));
  numSteps = min(numSteps, 8192);

  vec3 accumColor = vec3(0.0);
  float accumAlpha = 0.0;
  float tCurrent = tStart;

  vec3 lightDir = normalize(-rd);

  for (int i = 0; i < 8192; i++) {
    if (i >= numSteps) break;
    if (tCurrent >= tEnd || accumAlpha >= 0.98) break;

    vec3 pos = ro + rd * tCurrent;

    if (u_clippingEnabled) {
      float dist = dot(pos, u_clippingPlaneNormal) - u_clippingPlaneOffset;
      if (dist > 0.0) {
        tCurrent += stepSize;
        continue;
      }
    }

    vec3 uvw = clamp(pos + 0.5, 0.0, 1.0);

    float rawValue = texture(u_volume, uvw).r;
    float huValue = rawValue * 4095.0 - 1024.0;

    float normalizedHu = (huValue - u_huRange.x) / (u_huRange.y - u_huRange.x);
    normalizedHu = clamp(normalizedHu, 0.0, 1.0);

    vec4 tfColor = texture(u_transferFunc, vec2(normalizedHu, 0.5));

    if (tfColor.a > 0.001) {
      vec3 shadedColor = tfColor.rgb;
      if (u_lightingEnabled) {
        vec3 grad = computeGradient(uvw);
        float gradMag = length(grad);
        if (gradMag > 0.5) {
          vec3 normal = grad / gradMag;
          if (dot(normal, -rd) < 0.0) {
            normal = -normal;
          }
          shadedColor = phongLighting(normal, -rd, lightDir, tfColor.rgb);
        }
      }

      float alpha = 1.0 - exp(-tfColor.a * stepSize * 600.0);
      vec3 premultiplied = shadedColor * alpha;
      accumColor = accumColor + (1.0 - accumAlpha) * premultiplied;
      accumAlpha = accumAlpha + (1.0 - accumAlpha) * alpha;
    }

    tCurrent += stepSize;
  }

  vec3 bgColor = vec3(0.02, 0.02, 0.05);
  vec3 finalColor = mix(bgColor, accumColor, accumAlpha);
  outColor = vec4(finalColor, 1.0);
}
`;

export function decodeDifferential(base64Str: string, expectedLength: number): Uint16Array {
  const binaryString = atob(base64Str);
  const compressed = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    compressed[i] = binaryString.charCodeAt(i);
  }

  const result = new Uint16Array(expectedLength);
  let prev = 0;
  let i = 0;
  let outIdx = 0;

  while (i < compressed.length && outIdx < expectedLength) {
    const tag = compressed[i];
    i++;

    if (tag === 0x01) {
      if (i >= compressed.length) break;
      const diff = compressed[i];
      i++;
      const diffSigned = diff > 127 ? diff - 256 : diff;
      prev = (prev + diffSigned) & 0xffff;
      result[outIdx] = prev;
      outIdx++;
    } else if (tag === 0x02) {
      if (i + 1 >= compressed.length) break;
      const low = compressed[i] || 0;
      const high = compressed[i + 1] || 0;
      i += 2;
      prev = low | (high << 8);
      result[outIdx] = prev;
      outIdx++;
    } else {
      break;
    }
  }

  return result;
}

export class VolumeRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private volumeTexture: WebGLTexture | null = null;
  private transferFuncTexture: WebGLTexture | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  private volumeData: VolumeData | null = null;

  private transferFuncData: Uint8Array | null = null;

  private camera: CameraState = {
    distance: 2.5,
    azimuth: 0.0,
    elevation: 0.4,
    panX: 0,
    panY: 0,
  };

  private initialCamera: CameraState = {
    distance: 2.5,
    azimuth: 0.0,
    elevation: 0.4,
    panX: 0,
    panY: 0,
  };

  private stepSize: number = 1.0;
  private huRange: [number, number] = [-1024, 3071];

  private lightingEnabled: boolean = false;
  private ambientCoeff: number = 0.2;
  private diffuseCoeff: number = 0.7;
  private specularCoeff: number = 0.3;

  public onCameraChange: ((camera: CameraState) => void) | null = null;

  private clippingPlane: ClippingPlane = {
    axis: 'axial',
    position: 1.0,
  };
  private clippingEnabled: boolean = false;

  private dirty: boolean = true;
  private animationFrameId: number | null = null;
  private running: boolean = false;

  private fps: number = 0;
  private lastFpsTime: number = 0;
  private frameCount: number = 0;

  public onFpsUpdate: ((fps: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, preserveDrawingBuffer: boolean = false) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer });
    if (!gl) {
      throw new Error('WebGL2 not supported');
    }
    this.gl = gl;
    this.init();
  }

  private init() {
    const gl = this.gl;

    const vertexShader = this.createShader(gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);

    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return;
    }

    this.program = program;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const positions = new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1,
    ]);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const positionLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);

    this.volumeTexture = gl.createTexture();
    this.transferFuncTexture = gl.createTexture();

    this.setupDefaultTransferFunction();
  }

  private createShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  private setupDefaultTransferFunction() {
    const gl = this.gl;
    const texture = this.transferFuncTexture;
    if (!texture) return;

    const data = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      data[i * 4] = Math.floor(t * 255);
      data[i * 4 + 1] = Math.floor(t * 255);
      data[i * 4 + 2] = Math.floor(t * 255);
      data[i * 4 + 3] = Math.floor(t * 255 * 0.5);
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  setVolumeData(data: VolumeData) {
    this.volumeData = data;
    this.uploadVolumeTexture();
    this.resetCamera();
    this.dirty = true;
  }

  private uploadVolumeTexture() {
    if (!this.volumeData || !this.volumeTexture) return;

    const gl = this.gl;
    const { data, width, height, depth } = this.volumeData;

    const normalizedData = new Uint8Array(width * height * depth);
    for (let i = 0; i < data.length; i++) {
      const val = Math.max(0, Math.min(4095, data[i]));
      normalizedData[i] = Math.floor((val / 4095) * 255);
    }

    gl.bindTexture(gl.TEXTURE_3D, this.volumeTexture);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.R8,
      width,
      height,
      depth,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      normalizedData
    );
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    let minHu = 3072;
    let maxHu = -1025;
    for (let i = 0; i < Math.min(data.length, 500000); i++) {
      const hu = data[i] - 1024;
      if (hu < minHu) minHu = hu;
      if (hu > maxHu) maxHu = hu;
    }
    console.log(`Volume HU range (sample): ${minHu} ~ ${maxHu}`);
  }

  setTransferFunctionTexture(rgba: Uint8Array) {
    if (!this.transferFuncTexture) return;

    this.transferFuncData = new Uint8Array(rgba);

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.transferFuncTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    this.dirty = true;
  }

  setHuRange(min: number, max: number) {
    this.huRange = [min, max];
    this.dirty = true;
  }

  setStepSize(size: number) {
    this.stepSize = Math.max(0.5, Math.min(4.0, size));
    this.dirty = true;
  }

  getStepSize(): number {
    return this.stepSize;
  }

  setClippingPlane(axis: ClippingAxis, position: number) {
    this.clippingPlane.axis = axis;
    this.clippingPlane.position = Math.max(0, Math.min(1, position));
    this.clippingEnabled = this.clippingPlane.position < 1.0;
    this.dirty = true;
  }

  setClippingEnabled(enabled: boolean) {
    this.clippingEnabled = enabled;
    this.dirty = true;
  }

  setLighting(enabled: boolean, ambient: number = 0.2, diffuse: number = 0.7, specular: number = 0.3) {
    this.lightingEnabled = enabled;
    this.ambientCoeff = Math.max(0, Math.min(1, ambient));
    this.diffuseCoeff = Math.max(0, Math.min(1, diffuse));
    this.specularCoeff = Math.max(0, Math.min(1, specular));
    this.dirty = true;
  }

  getCameraState(): CameraState {
    return { ...this.camera };
  }

  setCameraState(state: CameraState) {
    this.camera = { ...state };
    this.dirty = true;
  }

  getCameraDistance(): number {
    return this.camera.distance;
  }

  getFps(): number {
    return this.fps;
  }

  private getClippingPlaneNormalAndOffset(): { normal: [number, number, number]; offset: number } {
    const pos = this.clippingPlane.position;
    const offset = pos - 0.5;

    switch (this.clippingPlane.axis) {
      case 'axial':
        return { normal: [0, 0, 1], offset: offset };
      case 'sagittal':
        return { normal: [1, 0, 0], offset: offset };
      case 'coronal':
        return { normal: [0, 1, 0], offset: offset };
    }
  }

  resetCamera() {
    this.initialCamera = {
      distance: 2.5,
      azimuth: 0.0,
      elevation: 0.4,
      panX: 0,
      panY: 0,
    };

    this.camera = { ...this.initialCamera };
    this.dirty = true;
  }

  setAxisView(axis: 'x' | 'y' | 'z') {
    const dist = this.initialCamera.distance;
    switch (axis) {
      case 'x':
        this.camera.azimuth = Math.PI / 2;
        this.camera.elevation = 0;
        break;
      case 'y':
        this.camera.azimuth = 0;
        this.camera.elevation = Math.PI / 2 - 0.01;
        break;
      case 'z':
        this.camera.azimuth = 0;
        this.camera.elevation = 0;
        break;
    }
    this.camera.distance = dist;
    this.camera.panX = 0;
    this.camera.panY = 0;
    this.dirty = true;
  }

  rotate(deltaAzimuth: number, deltaElevation: number) {
    this.camera.azimuth += deltaAzimuth * 0.005;
    this.camera.elevation += deltaElevation * 0.005;
    this.camera.elevation = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.camera.elevation));
    this.dirty = true;
    if (this.onCameraChange) {
      this.onCameraChange({ ...this.camera });
    }
  }

  pan(deltaX: number, deltaY: number) {
    const scale = this.camera.distance * 0.001;
    this.camera.panX += deltaX * scale;
    this.camera.panY += deltaY * scale;
    this.dirty = true;
    if (this.onCameraChange) {
      this.onCameraChange({ ...this.camera });
    }
  }

  zoom(factor: number) {
    this.camera.distance *= factor;
    this.camera.distance = Math.max(0.5, Math.min(10, this.camera.distance));
    this.dirty = true;
    if (this.onCameraChange) {
      this.onCameraChange({ ...this.camera });
    }
  }

  captureScreenshot(): string | null {
    if (!this.program || !this.volumeData) return null;
    this.render();
    return this.canvas.toDataURL('image/png');
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  private getCameraPositionAndTarget(): { pos: [number, number, number]; target: [number, number, number]; up: [number, number, number] } {
    const { distance, azimuth, elevation, panX, panY } = this.camera;

    const x = distance * Math.cos(elevation) * Math.sin(azimuth);
    const y = distance * Math.sin(elevation);
    const z = distance * Math.cos(elevation) * Math.cos(azimuth);

    const target: [number, number, number] = [panX, panY, 0];
    const pos: [number, number, number] = [x + panX, y + panY, z];

    const up: [number, number, number] = [0, 1, 0];

    return { pos, target, up };
  }

  private render() {
    if (!this.program || !this.volumeData || !this.volumeTexture || !this.transferFuncTexture || !this.vao) {
      return;
    }

    const gl = this.gl;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.02, 0.02, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, this.volumeTexture);
    const volumeLoc = gl.getUniformLocation(this.program, 'u_volume');
    gl.uniform1i(volumeLoc, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.transferFuncTexture);
    const tfLoc = gl.getUniformLocation(this.program, 'u_transferFunc');
    gl.uniform1i(tfLoc, 1);

    const { pos, target, up } = this.getCameraPositionAndTarget();
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_cameraPos'), pos[0], pos[1], pos[2]);
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_cameraTarget'), target[0], target[1], target[2]);
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_cameraUp'), up[0], up[1], up[2]);

    gl.uniform2f(gl.getUniformLocation(this.program, 'u_huRange'), this.huRange[0], this.huRange[1]);
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_volumeSize'), this.volumeData.width, this.volumeData.height, this.volumeData.depth);
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_voxelSize'), this.volumeData.voxelSize.x, this.volumeData.voxelSize.y, this.volumeData.voxelSize.z);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_stepSize'), this.stepSize);

    const aspect = this.canvas.height > 0 ? this.canvas.width / this.canvas.height : 1;
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_canvasAspect'), aspect);

    const { normal, offset } = this.getClippingPlaneNormalAndOffset();
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_clippingPlaneNormal'), normal[0], normal[1], normal[2]);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_clippingPlaneOffset'), offset);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_clippingEnabled'), this.clippingEnabled ? 1 : 0);

    gl.uniform1i(gl.getUniformLocation(this.program, 'u_lightingEnabled'), this.lightingEnabled ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_ambientCoeff'), this.ambientCoeff);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_diffuseCoeff'), this.diffuseCoeff);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_specularCoeff'), this.specularCoeff);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindVertexArray(null);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.startRenderLoop();
  }

  stop() {
    this.running = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private startRenderLoop() {
    const animate = () => {
      if (!this.running) return;

      const now = performance.now();
      this.frameCount++;

      if (now - this.lastFpsTime >= 1000) {
        this.fps = this.frameCount;
        this.frameCount = 0;
        this.lastFpsTime = now;
        if (this.onFpsUpdate) {
          this.onFpsUpdate(this.fps);
        }
      }

      if (this.dirty) {
        this.render();
        this.dirty = false;
      }

      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  requestRender() {
    this.dirty = true;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, rect.width * dpr);
    this.canvas.height = Math.max(1, rect.height * dpr);
    this.dirty = true;
  }

  pickVolume(screenX: number, screenY: number): { u: number; v: number; w: number } | null {
    if (!this.volumeData || !this.transferFuncData) return null;

    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const x = ((screenX - rect.left) * dpr) / this.canvas.width;
    const y = ((screenY - rect.top) * dpr) / this.canvas.height;

    const uv = x * 2.0 - 1.0;
    const vv = 1.0 - y * 2.0;

    const { pos, target, up } = this.getCameraPositionAndTarget();

    const forward: [number, number, number] = [
      target[0] - pos[0],
      target[1] - pos[1],
      target[2] - pos[2],
    ];
    const fLen = Math.sqrt(forward[0] ** 2 + forward[1] ** 2 + forward[2] ** 2);
    forward[0] /= fLen; forward[1] /= fLen; forward[2] /= fLen;

    const right: [number, number, number] = [
      forward[1] * up[2] - forward[2] * up[1],
      forward[2] * up[0] - forward[0] * up[2],
      forward[0] * up[1] - forward[1] * up[0],
    ];
    const rLen = Math.sqrt(right[0] ** 2 + right[1] ** 2 + right[2] ** 2);
    right[0] /= rLen; right[1] /= rLen; right[2] /= rLen;

    const upReal: [number, number, number] = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ];

    const fov = 1.0;
    const aspect = this.canvas.height > 0 ? this.canvas.width / this.canvas.height : 1;
    const rd: [number, number, number] = [
      forward[0] + right[0] * uv * fov * aspect + upReal[0] * vv * fov,
      forward[1] + right[1] * uv * fov * aspect + upReal[1] * vv * fov,
      forward[2] + right[2] * uv * fov * aspect + upReal[2] * vv * fov,
    ];
    const rdLen = Math.sqrt(rd[0] ** 2 + rd[1] ** 2 + rd[2] ** 2);
    rd[0] /= rdLen; rd[1] /= rdLen; rd[2] /= rdLen;

    const boxMin = [-0.5, -0.5, -0.5];
    const boxMax = [0.5, 0.5, 0.5];

    const invR = [1.0 / rd[0], 1.0 / rd[1], 1.0 / rd[2]];
    const tbot = [
      invR[0] * (boxMin[0] - pos[0]),
      invR[1] * (boxMin[1] - pos[1]),
      invR[2] * (boxMin[2] - pos[2]),
    ];
    const ttop = [
      invR[0] * (boxMax[0] - pos[0]),
      invR[1] * (boxMax[1] - pos[1]),
      invR[2] * (boxMax[2] - pos[2]),
    ];
    const tmin = [
      Math.min(ttop[0], tbot[0]),
      Math.min(ttop[1], tbot[1]),
      Math.min(ttop[2], tbot[2]),
    ];
    const tmax = [
      Math.max(ttop[0], tbot[0]),
      Math.max(ttop[1], tbot[1]),
      Math.max(ttop[2], tbot[2]),
    ];
    const t0 = Math.max(tmin[0], Math.max(tmin[1], tmin[2]));
    const t1 = Math.min(tmax[0], Math.min(tmax[1], tmax[2]));

    if (t0 > t1 || t1 < 0) return null;

    const tStart = Math.max(t0, 0);
    const tEnd = t1;

    const { width, height, depth, data } = this.volumeData;
    const stepSize = 0.005;
    const rayLength = tEnd - tStart;
    const numSteps = Math.min(2000, Math.ceil(rayLength / stepSize));

    let accumAlpha = 0.0;
    let bestUvw: [number, number, number] | null = null;

    for (let i = 0; i < numSteps; i++) {
      const t = tStart + (i / numSteps) * rayLength;
      const px = pos[0] + rd[0] * t;
      const py = pos[1] + rd[1] * t;
      const pz = pos[2] + rd[2] * t;

      const uu = px + 0.5;
      const vv2 = py + 0.5;
      const ww = pz + 0.5;

      if (uu < 0 || uu > 1 || vv2 < 0 || vv2 > 1 || ww < 0 || ww > 1) continue;

      const ix = Math.floor(uu * width);
      const iy = Math.floor(vv2 * height);
      const iz = Math.floor(ww * depth);

      if (ix < 0 || ix >= width || iy < 0 || iy >= height || iz < 0 || iz >= depth) continue;

      const voxelIdx = iz * width * height + iy * width + ix;
      const rawValue = data[voxelIdx];

      const huValue = rawValue - 1024;
      const huMin = this.huRange[0];
      const huMax = this.huRange[1];
      let normalizedHu = (huValue - huMin) / (huMax - huMin);
      normalizedHu = Math.max(0, Math.min(1, normalizedHu));

      const tfIdx = Math.min(255, Math.floor(normalizedHu * 255));
      const tfAlpha = this.transferFuncData[tfIdx * 4 + 3] / 255.0;

      if (tfAlpha > 0.01) {
        const alpha = 1.0 - Math.exp(-tfAlpha * stepSize * 600.0);
        accumAlpha += (1.0 - accumAlpha) * alpha;

        if (accumAlpha > 0.15 && !bestUvw) {
          bestUvw = [uu, vv2, ww];
        }
        if (accumAlpha > 0.5) {
          break;
        }
      }
    }

    if (!bestUvw) return null;

    return { u: bestUvw[0], v: bestUvw[1], w: bestUvw[2] };
  }

  dispose() {
    this.stop();
    const gl = this.gl;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.volumeTexture) gl.deleteTexture(this.volumeTexture);
    if (this.transferFuncTexture) gl.deleteTexture(this.transferFuncTexture);
    if (this.program) gl.deleteProgram(this.program);
  }
}
