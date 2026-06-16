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
uniform int u_maxSteps;
uniform vec3 u_clippingPlaneNormal;
uniform float u_clippingPlaneOffset;
uniform bool u_clippingEnabled;
uniform float u_canvasAspect;

vec2 intersectBox(vec3 ro, vec3 rd, vec3 boxMin, vec3 boxMax) {
  vec3 tMin = (boxMin - ro) / rd;
  vec3 tMax = (boxMax - ro) / rd;
  vec3 t1 = min(tMin, tMax);
  vec3 t2 = max(tMin, tMax);
  float tNear = max(max(t1.x, t1.y), t1.z);
  float tFar = min(min(t2.x, t2.y), t2.z);
  return vec2(tNear, tFar);
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

  float fov = 1.5;
  vec2 uv = v_uv * 2.0 - 1.0;
  vec3 rd = normalize(forward + right * uv.x * fov * u_canvasAspect + upReal * uv.y * fov);

  vec2 t = intersectBox(ro, rd, boxMin, boxMax);

  if (t.x > t.y || t.y < 0.0) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float tStart = max(t.x, 0.0);
  float tEnd = t.y;

  vec3 accumColor = vec3(0.0);
  float accumAlpha = 0.0;

  float stepSize = u_stepSize * 0.005;
  float tCurrent = tStart;

  for (int i = 0; i < 512; i++) {
    if (tCurrent >= tEnd || accumAlpha >= 0.99) break;
    if (i >= u_maxSteps) break;

    vec3 pos = ro + rd * tCurrent;

    if (u_clippingEnabled) {
      float dist = dot(pos, u_clippingPlaneNormal) - u_clippingPlaneOffset;
      if (dist > 0.0) {
        tCurrent += stepSize;
        continue;
      }
    }

    vec3 uvw = pos + 0.5;

    if (uvw.x < 0.0 || uvw.x > 1.0 || uvw.y < 0.0 || uvw.y > 1.0 || uvw.z < 0.0 || uvw.z > 1.0) {
      tCurrent += stepSize;
      continue;
    }

    float rawValue = texture(u_volume, uvw).r;
    float huValue = rawValue * 4095.0 - 1024.0;

    float normalizedHu = (huValue - u_huRange.x) / (u_huRange.y - u_huRange.x);
    normalizedHu = clamp(normalizedHu, 0.0, 1.0);

    vec4 tfColor = texture(u_transferFunc, vec2(normalizedHu, 0.5));

    if (tfColor.a > 0.001) {
      float alpha = 1.0 - exp(-tfColor.a * stepSize * 200.0);
      accumColor += (1.0 - accumAlpha) * tfColor.rgb * alpha;
      accumAlpha += (1.0 - accumAlpha) * alpha;
    }

    tCurrent += stepSize;
  }

  outColor = vec4(accumColor, 1.0);
}
`;

export function decodeDifferential(compressed: number[], expectedLength: number): Uint16Array {
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

  private camera: CameraState = {
    distance: 3.0,
    azimuth: 0.5,
    elevation: 0.3,
    panX: 0,
    panY: 0,
  };

  private initialCamera: CameraState = {
    distance: 3.0,
    azimuth: 0.5,
    elevation: 0.3,
    panX: 0,
    panY: 0,
  };

  private stepSize: number = 1.0;
  private maxSteps: number = 512;
  private huRange: [number, number] = [-1024, 3071];

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

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2');
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
      data[i * 4 + 3] = Math.floor(t * 255);
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

    const floatData = new Uint8Array(width * height * depth);
    for (let i = 0; i < data.length; i++) {
      floatData[i] = Math.min(255, Math.max(0, Math.floor(data[i] / 4095 * 255)));
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
      floatData
    );
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  }

  setTransferFunctionTexture(rgba: Uint8Array) {
    if (!this.transferFuncTexture) return;

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
    const maxDim = Math.max(this.volumeData?.width || 1, this.volumeData?.height || 1, this.volumeData?.depth || 1);
    const dist = maxDim / Math.min(this.volumeData?.width || 1, this.volumeData?.height || 1) * 2;

    this.initialCamera = {
      distance: dist,
      azimuth: 0.5,
      elevation: 0.3,
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
        this.camera.elevation = Math.PI / 2;
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
    this.camera.azimuth += deltaAzimuth * 0.01;
    this.camera.elevation += deltaElevation * 0.01;
    this.camera.elevation = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.camera.elevation));
    this.dirty = true;
  }

  pan(deltaX: number, deltaY: number) {
    const scale = this.camera.distance * 0.001;
    this.camera.panX += deltaX * scale;
    this.camera.panY += deltaY * scale;
    this.dirty = true;
  }

  zoom(factor: number) {
    this.camera.distance *= factor;
    this.camera.distance = Math.max(0.5, Math.min(50, this.camera.distance));
    this.dirty = true;
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
    gl.clearColor(0, 0, 0, 1);
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
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_maxSteps'), this.maxSteps);

    const aspect = this.canvas.width / this.canvas.height;
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_canvasAspect'), aspect);

    const { normal, offset } = this.getClippingPlaneNormalAndOffset();
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_clippingPlaneNormal'), normal[0], normal[1], normal[2]);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_clippingPlaneOffset'), offset);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_clippingEnabled'), this.clippingEnabled ? 1 : 0);

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
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.dirty = true;
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
