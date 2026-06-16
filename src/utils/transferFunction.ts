import type { TransferFunctionControlPoint } from '../types';

const PRESETS: Record<string, TransferFunctionControlPoint[]> = {
  bone: [
    { hu: -1024, r: 0, g: 0, b: 0, a: 0 },
    { hu: 100, r: 180, g: 180, b: 220, a: 0.1 },
    { hu: 300, r: 255, g: 200, b: 150, a: 0.5 },
    { hu: 1000, r: 255, g: 255, b: 255, a: 1.0 },
    { hu: 3071, r: 255, g: 255, b: 255, a: 1.0 },
  ],
  'soft-tissue': [
    { hu: -1024, r: 0, g: 0, b: 0, a: 0 },
    { hu: -500, r: 0, g: 0, b: 0, a: 0 },
    { hu: -100, r: 200, g: 100, b: 50, a: 0.3 },
    { hu: 100, r: 255, g: 180, b: 120, a: 0.8 },
    { hu: 300, r: 255, g: 240, b: 220, a: 1.0 },
    { hu: 3071, r: 255, g: 255, b: 255, a: 1.0 },
  ],
  lung: [
    { hu: -1024, r: 0, g: 0, b: 0, a: 0 },
    { hu: -900, r: 50, g: 150, b: 200, a: 0.2 },
    { hu: -500, r: 100, g: 200, b: 255, a: 0.5 },
    { hu: -200, r: 200, g: 220, b: 255, a: 0.8 },
    { hu: 100, r: 255, g: 240, b: 230, a: 1.0 },
    { hu: 3071, r: 255, g: 255, b: 255, a: 1.0 },
  ],
};

export class TransferFunctionEditor {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private textureDataCallback: ((rgba: Uint8Array) => void) | null = null;

  private controlPoints: TransferFunctionControlPoint[] = [];
  private selectedPointIndex: number | null = null;
  private isDragging: boolean = false;
  private huRange: [number, number] = [-1024, 3071];

  private debounceTimer: number | null = null;
  private debounceDelay: number = 200;

  private canvasWidth: number = 256;
  private canvasHeight: number = 150;
  private controlPointRadius: number = 6;

  private mouseDownPos: { x: number; y: number } | null = null;
  private mouseMoved: boolean = false;
  private mouseDownOnPoint: boolean = false;

  constructor(container: HTMLElement) {
    this.container = container;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tf-canvas';
    this.canvas.width = this.canvasWidth;
    this.canvas.height = this.canvasHeight;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '150px';
    this.canvas.style.cursor = 'crosshair';
    this.canvas.style.display = 'block';

    this.container.appendChild(this.canvas);

    this.loadPreset('bone');
    this.bindEvents();
    this.render();
  }

  onTextureData(callback: (rgba: Uint8Array) => void) {
    this.textureDataCallback = callback;
    const data = this.generateTextureData();
    callback(data);
  }

  private bindEvents() {
    this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.canvas.addEventListener('mouseleave', this.onMouseLeave.bind(this));
    this.canvas.addEventListener('contextmenu', this.onContextMenu.bind(this));
  }

  private getMousePos(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  private huToX(hu: number): number {
    const t = (hu - this.huRange[0]) / (this.huRange[1] - this.huRange[0]);
    return t * this.canvasWidth;
  }

  private xToHu(x: number): number {
    const t = x / this.canvasWidth;
    return this.huRange[0] + t * (this.huRange[1] - this.huRange[0]);
  }

  private alphaToY(alpha: number): number {
    return this.canvasHeight - alpha * this.canvasHeight;
  }

  private yToAlpha(y: number): number {
    return 1 - y / this.canvasHeight;
  }

  private findPointAtPos(x: number, y: number): number | null {
    for (let i = 0; i < this.controlPoints.length; i++) {
      const p = this.controlPoints[i];
      const px = this.huToX(p.hu);
      const py = this.alphaToY(p.a);
      const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
      if (dist < this.controlPointRadius + 4) {
        return i;
      }
    }
    return null;
  }

  private addPointAt(hu: number, alpha: number) {
    if (this.controlPoints.length >= 20) return;

    const color = this.interpolateColor(hu);
    const newPoint: TransferFunctionControlPoint = {
      hu,
      r: color.r,
      g: color.g,
      b: color.b,
      a: alpha,
    };

    let insertIdx = 0;
    while (insertIdx < this.controlPoints.length && this.controlPoints[insertIdx].hu < hu) {
      insertIdx++;
    }

    this.controlPoints.splice(insertIdx, 0, newPoint);
    this.selectedPointIndex = insertIdx;
    this.render();
    this.scheduleChange();
  }

  private onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();

    const pos = this.getMousePos(e);
    this.mouseDownPos = pos;
    this.mouseMoved = false;

    const pointIdx = this.findPointAtPos(pos.x, pos.y);

    if (pointIdx !== null) {
      this.mouseDownOnPoint = true;
      this.selectedPointIndex = pointIdx;
      this.isDragging = true;
      this.render();
    } else {
      this.mouseDownOnPoint = false;
    }
  }

  private onMouseMove(e: MouseEvent) {
    const pos = this.getMousePos(e);

    if (this.mouseDownPos) {
      const dx = pos.x - this.mouseDownPos.x;
      const dy = pos.y - this.mouseDownPos.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        this.mouseMoved = true;
      }
    }

    if (!this.isDragging || this.selectedPointIndex === null) return;

    const point = this.controlPoints[this.selectedPointIndex];

    let newHu = this.xToHu(pos.x);
    newHu = Math.max(this.huRange[0], Math.min(this.huRange[1], newHu));

    let newAlpha = this.yToAlpha(pos.y);
    newAlpha = Math.max(0, Math.min(1, newAlpha));

    if (this.selectedPointIndex > 0) {
      newHu = Math.max(newHu, this.controlPoints[this.selectedPointIndex - 1].hu + 1);
    }
    if (this.selectedPointIndex < this.controlPoints.length - 1) {
      newHu = Math.min(newHu, this.controlPoints[this.selectedPointIndex + 1].hu - 1);
    }

    point.hu = newHu;
    point.a = newAlpha;

    this.render();
    this.scheduleChange();
  }

  private onMouseUp(e: MouseEvent) {
    const pos = this.getMousePos(e);

    if (this.isDragging) {
      this.isDragging = false;
    } else if (!this.mouseMoved && !this.mouseDownOnPoint && e.button === 0) {
      const hu = this.xToHu(pos.x);
      const alpha = this.yToAlpha(pos.y);
      this.addPointAt(hu, alpha);
    }

    this.mouseDownPos = null;
    this.mouseMoved = false;
    this.mouseDownOnPoint = false;
  }

  private onMouseLeave() {
    this.isDragging = false;
    this.mouseDownPos = null;
    this.mouseMoved = false;
    this.mouseDownOnPoint = false;
  }

  private onContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    const pos = this.getMousePos(e);
    const pointIdx = this.findPointAtPos(pos.x, pos.y);

    if (pointIdx !== null && this.controlPoints.length > 2) {
      this.controlPoints.splice(pointIdx, 1);
      this.selectedPointIndex = null;
      this.render();
      this.scheduleChange();
    }
  }

  private interpolateColor(hu: number): { r: number; g: number; b: number } {
    if (this.controlPoints.length === 0) {
      return { r: 255, g: 255, b: 255 };
    }

    if (hu <= this.controlPoints[0].hu) {
      return { r: this.controlPoints[0].r, g: this.controlPoints[0].g, b: this.controlPoints[0].b };
    }

    if (hu >= this.controlPoints[this.controlPoints.length - 1].hu) {
      const last = this.controlPoints[this.controlPoints.length - 1];
      return { r: last.r, g: last.g, b: last.b };
    }

    for (let i = 1; i < this.controlPoints.length; i++) {
      const p0 = this.controlPoints[i - 1];
      const p1 = this.controlPoints[i];
      if (hu >= p0.hu && hu <= p1.hu) {
        const t = (hu - p0.hu) / (p1.hu - p0.hu);
        return {
          r: Math.round(p0.r + (p1.r - p0.r) * t),
          g: Math.round(p0.g + (p1.g - p0.g) * t),
          b: Math.round(p0.b + (p1.b - p0.b) * t),
        };
      }
    }

    return { r: 255, g: 255, b: 255 };
  }

  private scheduleChange() {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.emitChange();
    }, this.debounceDelay);
  }

  private emitChange() {
    if (this.textureDataCallback) {
      const textureData = this.generateTextureData();
      this.textureDataCallback(textureData);
    }
  }

  generateTextureData(): Uint8Array {
    const data = new Uint8Array(256 * 4);

    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      const hu = this.huRange[0] + t * (this.huRange[1] - this.huRange[0]);

      let r = 0, g = 0, b = 0, a = 0;

      if (this.controlPoints.length > 0) {
        if (hu <= this.controlPoints[0].hu) {
          const p = this.controlPoints[0];
          r = p.r; g = p.g; b = p.b; a = p.a;
        } else if (hu >= this.controlPoints[this.controlPoints.length - 1].hu) {
          const p = this.controlPoints[this.controlPoints.length - 1];
          r = p.r; g = p.g; b = p.b; a = p.a;
        } else {
          for (let j = 1; j < this.controlPoints.length; j++) {
            const p0 = this.controlPoints[j - 1];
            const p1 = this.controlPoints[j];
            if (hu >= p0.hu && hu <= p1.hu) {
              const tt = (hu - p0.hu) / (p1.hu - p0.hu);
              r = Math.round(p0.r + (p1.r - p0.r) * tt);
              g = Math.round(p0.g + (p1.g - p0.g) * tt);
              b = Math.round(p0.b + (p1.b - p0.b) * tt);
              a = p0.a + (p1.a - p0.a) * tt;
              break;
            }
          }
        }
      }

      data[i * 4] = Math.max(0, Math.min(255, r));
      data[i * 4 + 1] = Math.max(0, Math.min(255, g));
      data[i * 4 + 2] = Math.max(0, Math.min(255, b));
      data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
    }

    return data;
  }

  loadPreset(name: string) {
    const preset = PRESETS[name];
    if (!preset) return;

    this.controlPoints = preset.map(p => ({ ...p }));
    this.selectedPointIndex = null;
    this.render();
    this.emitChange();
  }

  setHuRange(min: number, max: number) {
    this.huRange = [min, max];
    this.render();
  }

  getControlPoints(): TransferFunctionControlPoint[] {
    return [...this.controlPoints];
  }

  setPointColor(index: number, r: number, g: number, b: number) {
    if (index >= 0 && index < this.controlPoints.length) {
      this.controlPoints[index].r = r;
      this.controlPoints[index].g = g;
      this.controlPoints[index].b = b;
      this.render();
      this.scheduleChange();
    }
  }

  getSelectedPointIndex(): number | null {
    return this.selectedPointIndex;
  }

  selectPoint(index: number | null) {
    this.selectedPointIndex = index;
    this.render();
  }

  private render() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      const hu = this.huRange[0] + t * (this.huRange[1] - this.huRange[0]);
      const color = this.interpolateColor(hu);
      gradient.addColorStop(t, `rgb(${color.r}, ${color.g}, ${color.b})`);
    }

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    if (this.controlPoints.length > 0) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i < this.controlPoints.length; i++) {
        const p = this.controlPoints[i];
        const x = this.huToX(p.hu);
        const y = this.alphaToY(p.a);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fill();

      ctx.beginPath();
      for (let i = 0; i < this.controlPoints.length; i++) {
        const p = this.controlPoints[i];
        const x = this.huToX(p.hu);
        const y = this.alphaToY(p.a);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      for (let i = 0; i < this.controlPoints.length; i++) {
        const p = this.controlPoints[i];
        const x = this.huToX(p.hu);
        const y = this.alphaToY(p.a);

        ctx.beginPath();
        ctx.arc(x, y, this.controlPointRadius, 0, Math.PI * 2);
        ctx.fillStyle = i === this.selectedPointIndex ? '#e94560' : '#fff';
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    ctx.strokeStyle = '#2a2a4a';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);

    ctx.fillStyle = '#a0a0a0';
    ctx.font = '10px sans-serif';
    ctx.fillText(`${this.huRange[0]}`, 2, h - 2);
    ctx.textAlign = 'right';
    ctx.fillText(`${this.huRange[1]}`, w - 2, h - 2);
  }

  dispose() {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}
