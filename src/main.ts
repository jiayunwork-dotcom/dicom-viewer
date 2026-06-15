import { dicomApi } from './api';
import './styles/main.css';
import {
  StudyInfo,
  SeriesInfo,
  DicomTag,
  PixelDataResponse,
  WindowPreset,
  ViewState,
  LayoutType,
  ToolType,
  AnnotationColor,
  Annotation,
  Point,
  LineMeasurement,
  AngleMeasurement,
  RectRoiMeasurement,
  EllipseRoiMeasurement,
  ArrowAnnotation,
  TextAnnotation,
  BrushAnnotation,
  MprSliceData,
  MprVolumeInfo,
} from './types';
import {
  drawImage,
  drawAnnotations,
  drawCrosshair,
  canvasToPixel,
  calculateDistance,
  calculateAngle,
  generateId,
} from './utils/renderer';

class DicomViewerApp {
  private studies: StudyInfo[] = [];
  private seriesMap: Map<string, SeriesInfo[]> = new Map();
  private selectedStudyUid: string | null = null;
  private selectedSeriesUid: string | null = null;
  private activeViewIndex: number = 0;
  private layout: LayoutType = '1x1';
  private views: ViewState[] = [];
  private pixelDataMap: Map<string, PixelDataResponse> = new Map();
  private rgbaDataMap: Map<string, Uint8ClampedArray> = new Map();
  private windowPresets: WindowPreset[] = [];
  private currentTool: ToolType = 'window';
  private annotationColor: AnnotationColor = 'red';
  private annotations: Map<string, Annotation[]> = new Map();
  private selectedAnnotationId: string | null = null;
  private showAnnotations: boolean = true;
  private tags: DicomTag[] = [];
  private tagSearch: string = '';
  private infoTab: string = 'window';
  private isPlaying: boolean = false;
  private playFps: number = 15;
  private playAnimationFrameId: number | null = null;
  private isMprMode: boolean = false;
  private mprAxialIndex: number = 0;
  private mprSagittalIndex: number = 0;
  private mprCoronalIndex: number = 0;
  private mprCache: Map<string, { slices: [MprSliceData, MprSliceData, MprSliceData, MprVolumeInfo], rgbaMaps: Map<string, Uint8ClampedArray> }> = new Map();

  private drawing: boolean = false;
  private drawStart: Point | null = null;
  private tempPoints: Point[] = [];

  async init() {
    this.windowPresets = await dicomApi.getWindowPresets();
    this.initViews();
    this.render();
  }

  private initViews() {
    const count = this.getViewCount();
    this.views = Array.from({ length: count }, () => ({
      studyUid: null,
      seriesUid: null,
      instanceIndex: 0,
      frameIndex: 0,
      windowWidth: 400,
      windowCenter: 40,
      invert: false,
      zoom: 1,
      panX: 0,
      panY: 0,
      rotation: 0,
      flipH: false,
      flipV: false,
    }));
  }

  private getViewCount(): number {
    switch (this.layout) {
      case '1x1': return 1;
      case '1x2': return 2;
      case '2x2': return 4;
      case '3x3': return 9;
      default: return 1;
    }
  }

  getViewKey(viewIdx: number): string {
    const v = this.views[viewIdx];
    return `${v.studyUid || ''}_${v.seriesUid || ''}_${v.instanceIndex}_${v.frameIndex}`;
  }

  async openFile() {
    const studyUid = await dicomApi.openDicomFile();
    if (studyUid) {
      await this.refreshStudies();
      await this.selectStudy(studyUid);
    }
  }

  async openDirectory() {
    const studyUids = await dicomApi.openDicomDirectory();
    if (studyUids && studyUids.length > 0) {
      await this.refreshStudies();
      await this.selectStudy(studyUids[0]);
    }
  }

  async refreshStudies() {
    this.studies = await dicomApi.getStudies();
    this.render();
  }

  async selectStudy(studyUid: string) {
    this.selectedStudyUid = studyUid;
    const series = await dicomApi.getSeriesInfo(studyUid);
    this.seriesMap.set(studyUid, series);
    if (series.length > 0) {
      await this.selectSeries(studyUid, series[0].series_uid);
    }
    this.render();
  }

  async selectSeries(studyUid: string, seriesUid: string) {
    this.selectedSeriesUid = seriesUid;
    const view = this.views[this.activeViewIndex];
    view.studyUid = studyUid;
    view.seriesUid = seriesUid;
    view.instanceIndex = 0;
    view.frameIndex = 0;
    view.zoom = 1;
    view.panX = 0;
    view.panY = 0;
    view.rotation = 0;

    await this.loadViewPixelData(this.activeViewIndex);
    this.render();
  }

  async loadViewPixelData(viewIdx: number) {
    const view = this.views[viewIdx];
    if (!view.studyUid || !view.seriesUid) return;

    const key = this.getViewKey(viewIdx);
    if (this.pixelDataMap.has(key)) return;

    try {
      const pixelData = await dicomApi.getInstancePixelData(
        view.studyUid,
        view.seriesUid,
        view.instanceIndex,
        view.frameIndex
      );
      this.pixelDataMap.set(key, pixelData);

      if (pixelData.default_window_width != null && pixelData.default_window_center != null) {
        view.windowWidth = pixelData.default_window_width;
        view.windowCenter = pixelData.default_window_center;
      }

      await this.updateRgbaData(viewIdx);

      this.tags = await dicomApi.getDicomTags(
        view.studyUid,
        view.seriesUid,
        view.instanceIndex
      );
    } catch (e) {
      console.error('Failed to load pixel data:', e);
    }
  }

  async updateRgbaData(viewIdx: number) {
    const view = this.views[viewIdx];
    const key = this.getViewKey(viewIdx);
    const pixelData = this.pixelDataMap.get(key);
    if (!pixelData) return;

    const rgbaArr = await dicomApi.applyWindowLevel(
      Array.from(pixelData.pixels),
      pixelData.width,
      pixelData.height,
      view.windowWidth,
      view.windowCenter,
      pixelData.photometric_interpretation,
      view.invert
    );
    this.rgbaDataMap.set(key, new Uint8ClampedArray(rgbaArr));
  }

  setLayout(layout: LayoutType) {
    this.layout = layout;
    this.initViews();
    this.activeViewIndex = 0;
    this.render();
  }

  setActiveView(idx: number) {
    this.activeViewIndex = idx;
    this.render();
  }

  setTool(tool: ToolType) {
    this.currentTool = tool;
    this.drawing = false;
    this.drawStart = null;
    this.tempPoints = [];
    this.render();
  }

  setAnnotationColor(color: AnnotationColor) {
    this.annotationColor = color;
    this.render();
  }

  setInvert(invert: boolean) {
    this.views[this.activeViewIndex].invert = invert;
    this.updateRgbaData(this.activeViewIndex).then(() => this.render());
  }

  resetView() {
    const view = this.views[this.activeViewIndex];
    view.zoom = 1;
    view.panX = 0;
    view.panY = 0;
    view.rotation = 0;
    view.flipH = false;
    view.flipV = false;
    const key = this.getViewKey(this.activeViewIndex);
    const pixelData = this.pixelDataMap.get(key);
    if (pixelData?.default_window_width != null && pixelData?.default_window_center != null) {
      view.windowWidth = pixelData.default_window_width;
      view.windowCenter = pixelData.default_window_center;
    }
    this.updateRgbaData(this.activeViewIndex).then(() => this.render());
  }

  rotate90() {
    this.views[this.activeViewIndex].rotation = (this.views[this.activeViewIndex].rotation + 90) % 360;
    this.render();
  }

  flipHorizontal() {
    this.views[this.activeViewIndex].flipH = !this.views[this.activeViewIndex].flipH;
    this.render();
  }

  flipVertical() {
    this.views[this.activeViewIndex].flipV = !this.views[this.activeViewIndex].flipV;
    this.render();
  }

  applyWindowPreset(preset: WindowPreset) {
    const view = this.views[this.activeViewIndex];
    view.windowWidth = preset.window_width;
    view.windowCenter = preset.window_center;
    this.updateRgbaData(this.activeViewIndex).then(() => this.render());
  }

  setWindowValues(ww: number, wl: number) {
    const view = this.views[this.activeViewIndex];
    view.windowWidth = Math.max(1, ww);
    view.windowCenter = wl;
    this.updateRgbaData(this.activeViewIndex).then(() => this.render());
  }

  nextSlice() {
    const view = this.views[this.activeViewIndex];
    const key = this.getViewKey(this.activeViewIndex);
    const pixelData = this.pixelDataMap.get(key);
    if (pixelData && view.instanceIndex < pixelData.total_slices - 1) {
      view.instanceIndex++;
      this.loadViewPixelData(this.activeViewIndex).then(() => this.render());
    }
  }

  prevSlice() {
    const view = this.views[this.activeViewIndex];
    if (view.instanceIndex > 0) {
      view.instanceIndex--;
      this.loadViewPixelData(this.activeViewIndex).then(() => this.render());
    }
  }

  nextFrame() {
    const view = this.views[this.activeViewIndex];
    const key = this.getViewKey(this.activeViewIndex);
    const pixelData = this.pixelDataMap.get(key);
    if (pixelData && view.frameIndex < pixelData.frames - 1) {
      view.frameIndex++;
      this.loadViewPixelData(this.activeViewIndex).then(() => this.render());
    }
  }

  prevFrame() {
    const view = this.views[this.activeViewIndex];
    if (view.frameIndex > 0) {
      view.frameIndex--;
      this.loadViewPixelData(this.activeViewIndex).then(() => this.render());
    }
  }

  togglePlayback() {
    if (this.isPlaying) {
      this.stopPlayback();
    } else {
      this.startPlayback();
    }
  }

  private startPlayback() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    const series = this.getCurrentSeries();

    let targetFps = this.playFps;
    if (series?.frame_time && series.frame_time > 0) {
      const nativeFps = 1000.0 / series.frame_time;
      targetFps = Math.min(targetFps, nativeFps);
    }
    const frameInterval = 1000.0 / Math.max(1, targetFps);

    let lastTimestamp = 0;
    const animate = (timestamp: number) => {
      if (!this.isPlaying) return;

      if (timestamp - lastTimestamp >= frameInterval) {
        lastTimestamp = timestamp;
        const view = this.views[this.activeViewIndex];
        const key = this.getViewKey(this.activeViewIndex);
        const pixelData = this.pixelDataMap.get(key);
        if (series?.is_multiframe) {
          const totalFrames = pixelData?.frames || 1;
          if (view.frameIndex < totalFrames - 1) {
            view.frameIndex++;
          } else {
            view.frameIndex = 0;
          }
        } else {
          const totalSlices = pixelData?.total_slices || 1;
          if (view.instanceIndex < totalSlices - 1) {
            view.instanceIndex++;
          } else {
            view.instanceIndex = 0;
          }
        }
        this.loadViewPixelData(this.activeViewIndex).then(() => this.renderImageViews());
      }

      this.playAnimationFrameId = requestAnimationFrame(animate);
    };

    this.playAnimationFrameId = requestAnimationFrame(animate);
    this.render();
  }

  private stopPlayback() {
    this.isPlaying = false;
    if (this.playAnimationFrameId != null) {
      cancelAnimationFrame(this.playAnimationFrameId);
      this.playAnimationFrameId = null;
    }
    this.render();
  }

  setPlayFps(fps: number) {
    this.playFps = Math.max(1, Math.min(30, fps));
    if (this.isPlaying) {
      this.stopPlayback();
      this.startPlayback();
    }
    this.render();
  }

  getCurrentSeries(): SeriesInfo | null {
    const view = this.views[this.activeViewIndex];
    if (!view.studyUid) return null;
    const series = this.seriesMap.get(view.studyUid);
    return series?.find(s => s.series_uid === view.seriesUid) || null;
  }

  handleCanvasMouseDown(viewIdx: number, e: MouseEvent, canvas: HTMLCanvasElement) {
    this.setActiveView(viewIdx);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.currentTool === 'window' || this.currentTool === 'pan' || this.currentTool === 'zoom') {
      this.drawing = true;
      this.drawStart = { x, y };
    } else if (this.currentTool === 'line' || this.currentTool === 'arrow' ||
               this.currentTool === 'rect_roi' || this.currentTool === 'ellipse_roi') {
      const view = this.views[viewIdx];
      const key = this.getViewKey(viewIdx);
      const pixelData = this.pixelDataMap.get(key);
      if (!pixelData) return;

      const p = canvasToPixel(x, y, canvas.width, canvas.height,
        pixelData.width, pixelData.height, view.zoom, view.panX, view.panY,
        view.rotation, view.flipH, view.flipV);

      this.drawing = true;
      this.tempPoints = [p, p];
    } else if (this.currentTool === 'angle') {
      const view = this.views[viewIdx];
      const key = this.getViewKey(viewIdx);
      const pixelData = this.pixelDataMap.get(key);
      if (!pixelData) return;

      const p = canvasToPixel(x, y, canvas.width, canvas.height,
        pixelData.width, pixelData.height, view.zoom, view.panX, view.panY,
        view.rotation, view.flipH, view.flipV);

      if (this.tempPoints.length < 3) {
        this.tempPoints.push(p);
      }
      if (this.tempPoints.length === 3) {
        this.finishAngleMeasurement(viewIdx);
      }
    } else if (this.currentTool === 'text') {
      const view = this.views[viewIdx];
      const key = this.getViewKey(viewIdx);
      const pixelData = this.pixelDataMap.get(key);
      if (!pixelData) return;

      const text = prompt('Enter annotation text:');
      if (text) {
        const p = canvasToPixel(x, y, canvas.width, canvas.height,
          pixelData.width, pixelData.height, view.zoom, view.panX, view.panY,
          view.rotation, view.flipH, view.flipV);

        const ann: TextAnnotation = {
          id: generateId(),
          type: 'text',
          position: p,
          text,
          color: this.annotationColor,
        };
        this.addAnnotation(viewIdx, ann);
      }
    } else if (this.currentTool === 'brush') {
      const view = this.views[viewIdx];
      const key = this.getViewKey(viewIdx);
      const pixelData = this.pixelDataMap.get(key);
      if (!pixelData) return;

      const p = canvasToPixel(x, y, canvas.width, canvas.height,
        pixelData.width, pixelData.height, view.zoom, view.panX, view.panY,
        view.rotation, view.flipH, view.flipV);

      this.drawing = true;
      this.tempPoints = [p];
    }

    this.renderImageViews();
  }

  handleCanvasMouseMove(viewIdx: number, e: MouseEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (!this.drawing) {
      this.renderImageViews();
      const ctx = canvas.getContext('2d');
      if (ctx) drawCrosshair(ctx, x, y);
      return;
    }

    if (!this.drawStart) return;

    const view = this.views[viewIdx];

    if (this.currentTool === 'window') {
      const dx = x - this.drawStart.x;
      const dy = y - this.drawStart.y;
      view.windowWidth = Math.max(1, view.windowWidth + dx * 2);
      view.windowCenter = view.windowCenter - dy * 2;
      this.drawStart = { x, y };
      this.updateRgbaData(viewIdx).then(() => this.renderImageViews());
    } else if (this.currentTool === 'pan') {
      view.panX += x - this.drawStart.x;
      view.panY += y - this.drawStart.y;
      this.drawStart = { x, y };
      this.renderImageViews();
    } else if (this.currentTool === 'zoom') {
      const dy = y - this.drawStart.y;
      const factor = 1 - dy / 200;
      view.zoom = Math.max(0.5, Math.min(8, view.zoom * factor));
      this.drawStart = { x, y };
      this.renderImageViews();
    } else if (this.currentTool === 'line' || this.currentTool === 'arrow' ||
               this.currentTool === 'rect_roi' || this.currentTool === 'ellipse_roi') {
      const key = this.getViewKey(viewIdx);
      const pixelData = this.pixelDataMap.get(key);
      if (!pixelData) return;

      const p = canvasToPixel(x, y, canvas.width, canvas.height,
        pixelData.width, pixelData.height, view.zoom, view.panX, view.panY,
        view.rotation, view.flipH, view.flipV);
      this.tempPoints[1] = p;
      this.renderImageViews();
    } else if (this.currentTool === 'brush') {
      const key = this.getViewKey(viewIdx);
      const pixelData = this.pixelDataMap.get(key);
      if (!pixelData) return;

      const p = canvasToPixel(x, y, canvas.width, canvas.height,
        pixelData.width, pixelData.height, view.zoom, view.panX, view.panY,
        view.rotation, view.flipH, view.flipV);
      this.tempPoints.push(p);
      this.renderImageViews();
    }
  }

  handleCanvasMouseUp(viewIdx: number, _e: MouseEvent, _canvas: HTMLCanvasElement) {
    if (!this.drawing) return;
    this.drawing = false;

    if (this.currentTool === 'line') {
      this.finishLineMeasurement(viewIdx);
    } else if (this.currentTool === 'arrow') {
      this.finishArrowAnnotation(viewIdx);
    } else if (this.currentTool === 'rect_roi') {
      this.finishRoiMeasurement(viewIdx, false);
    } else if (this.currentTool === 'ellipse_roi') {
      this.finishRoiMeasurement(viewIdx, true);
    } else if (this.currentTool === 'brush') {
      this.finishBrushAnnotation(viewIdx);
    }

    this.drawStart = null;
    this.render();
  }

  handleCanvasWheel(viewIdx: number, e: WheelEvent) {
    e.preventDefault();
    const view = this.views[viewIdx];

    if (e.ctrlKey || this.currentTool === 'zoom') {
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      view.zoom = Math.max(0.5, Math.min(8, view.zoom * factor));
    } else {
      if (e.deltaY > 0) {
        this.nextSlice();
      } else {
        this.prevSlice();
      }
      return;
    }
    this.render();
  }

  private finishLineMeasurement(viewIdx: number) {
    if (this.tempPoints.length < 2) return;
    const key = this.getViewKey(viewIdx);
    const pixelData = this.pixelDataMap.get(key);

    const ann: LineMeasurement = {
      id: generateId(),
      type: 'line',
      start: this.tempPoints[0],
      end: this.tempPoints[1],
      distance: calculateDistance(this.tempPoints[0], this.tempPoints[1], pixelData?.pixel_spacing || null),
      color: this.annotationColor,
    };
    this.addAnnotation(viewIdx, ann);
    this.tempPoints = [];
  }

  private finishAngleMeasurement(viewIdx: number) {
    if (this.tempPoints.length < 3) return;

    const ann: AngleMeasurement = {
      id: generateId(),
      type: 'angle',
      points: [this.tempPoints[0], this.tempPoints[1], this.tempPoints[2]],
      angle: calculateAngle(this.tempPoints[0], this.tempPoints[1], this.tempPoints[2]),
      color: this.annotationColor,
    };
    this.addAnnotation(viewIdx, ann);
    this.tempPoints = [];
  }

  private finishArrowAnnotation(viewIdx: number) {
    if (this.tempPoints.length < 2) return;

    const text = prompt('Enter arrow text (optional):') || '';
    const ann: ArrowAnnotation = {
      id: generateId(),
      type: 'arrow',
      start: this.tempPoints[0],
      end: this.tempPoints[1],
      text,
      color: this.annotationColor,
    };
    this.addAnnotation(viewIdx, ann);
    this.tempPoints = [];
  }

  private finishRoiMeasurement(viewIdx: number, isEllipse: boolean) {
    if (this.tempPoints.length < 2) return;
    const key = this.getViewKey(viewIdx);
    const pixelData = this.pixelDataMap.get(key);
    if (!pixelData) return;

    const x = Math.min(this.tempPoints[0].x, this.tempPoints[1].x);
    const y = Math.min(this.tempPoints[0].y, this.tempPoints[1].y);
    const w = Math.abs(this.tempPoints[1].x - this.tempPoints[0].x);
    const h = Math.abs(this.tempPoints[1].y - this.tempPoints[0].y);

    if (w < 2 || h < 2) {
      this.tempPoints = [];
      return;
    }

    let sum = 0;
    let sumSq = 0;
    let min = Infinity;
    let max = -Infinity;
    let count = 0;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = w / 2;
    const ry = h / 2;

    for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
      for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
        if (px < 0 || py < 0 || px >= pixelData.width || py >= pixelData.height) continue;
        if (isEllipse) {
          const dx = (px - cx) / (rx || 1);
          const dy = (py - cy) / (ry || 1);
          if (dx * dx + dy * dy > 1) continue;
        }
        const idx = py * pixelData.width + px;
        const v = pixelData.pixels[idx];
        sum += v;
        sumSq += v * v;
        min = Math.min(min, v);
        max = Math.max(max, v);
        count++;
      }
    }

    const mean = count > 0 ? sum / count : 0;
    const std = count > 0 ? Math.sqrt(sumSq / count - mean * mean) : 0;
    const ps = pixelData.pixel_spacing;
    let area: number;
    if (isEllipse) {
      const rxMm = ps ? rx * ps[1] : rx;
      const ryMm = ps ? ry * ps[0] : ry;
      area = Math.PI * rxMm * ryMm;
    } else {
      const wMm = ps ? w * ps[1] : w;
      const hMm = ps ? h * ps[0] : h;
      area = wMm * hMm;
    }

    if (isEllipse) {
      const ann: EllipseRoiMeasurement = {
        id: generateId(),
        type: 'ellipse_roi',
        x, y, width: w, height: h,
        mean, std, min, max, area,
        color: this.annotationColor,
      };
      this.addAnnotation(viewIdx, ann);
    } else {
      const ann: RectRoiMeasurement = {
        id: generateId(),
        type: 'rect_roi',
        x, y, width: w, height: h,
        mean, std, min, max, area,
        color: this.annotationColor,
      };
      this.addAnnotation(viewIdx, ann);
    }
    this.tempPoints = [];
  }

  private finishBrushAnnotation(viewIdx: number) {
    if (this.tempPoints.length < 2) return;

    const ann: BrushAnnotation = {
      id: generateId(),
      type: 'brush',
      points: [...this.tempPoints],
      color: this.annotationColor,
    };
    this.addAnnotation(viewIdx, ann);
    this.tempPoints = [];
  }

  private addAnnotation(viewIdx: number, ann: Annotation) {
    const key = this.getViewKey(viewIdx);
    if (!this.annotations.has(key)) {
      this.annotations.set(key, []);
    }
    this.annotations.get(key)!.push(ann);
    this.selectedAnnotationId = ann.id;
  }

  deleteSelectedAnnotation() {
    if (!this.selectedAnnotationId) return;
    const key = this.getViewKey(this.activeViewIndex);
    const anns = this.annotations.get(key);
    if (anns) {
      const idx = anns.findIndex(a => a.id === this.selectedAnnotationId);
      if (idx >= 0) anns.splice(idx, 1);
      this.selectedAnnotationId = null;
      this.render();
    }
  }

  clearAnnotations() {
    const key = this.getViewKey(this.activeViewIndex);
    this.annotations.delete(key);
    this.selectedAnnotationId = null;
    this.render();
  }

  toggleAnnotations() {
    this.showAnnotations = !this.showAnnotations;
    this.render();
  }

  async exportAnnotations() {
    const key = this.getViewKey(this.activeViewIndex);
    const anns = this.annotations.get(key) || [];
    const path = await dicomApi.showSaveDialog('annotations.json', [
      { name: 'JSON', extensions: ['json'] }
    ]);
    if (path) {
      await dicomApi.exportAnnotations(anns, path);
    }
  }

  async loadAnnotationsFile() {
    const { open } = await import('@tauri-apps/api/dialog');
    const path = await open({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      multiple: false,
    }) as string | null;
    if (path) {
      const anns = await dicomApi.loadAnnotations(path) as Annotation[];
      const key = this.getViewKey(this.activeViewIndex);
      this.annotations.set(key, anns);
      this.render();
    }
  }

  async exportScreenshot() {
    const key = this.getViewKey(this.activeViewIndex);
    const pixelData = this.pixelDataMap.get(key);
    if (!pixelData) return;

    const canvas = document.createElement('canvas');
    canvas.width = pixelData.width;
    canvas.height = pixelData.height;
    const ctx = canvas.getContext('2d')!;

    const rgba = this.rgbaDataMap.get(key);
    if (rgba) {
      const imgData = new ImageData(rgba as unknown as Uint8ClampedArray<ArrayBuffer>, pixelData.width, pixelData.height);
      ctx.putImageData(imgData, 0, 0);
    }

    const anns = this.annotations.get(key) || [];
    if (this.showAnnotations && anns.length > 0) {
      drawAnnotations(ctx, anns, pixelData.width, pixelData.height,
        pixelData.width, pixelData.height, 1, 0, 0, 0, false, false,
        pixelData.pixel_spacing, this.selectedAnnotationId);
    }

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = Array.from(imageData.data);

    const path = await dicomApi.showSaveDialog('screenshot.png', [
      { name: 'PNG', extensions: ['png'] },
      { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
    ]);
    if (path) {
      const ext = path.split('.').pop()?.toLowerCase() || 'png';
      const format = ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : 'png';
      await dicomApi.exportScreenshot(data, canvas.width, canvas.height, path, format as 'png' | 'jpeg');
    }
  }

  async toggleMprMode() {
    if (this.isMprMode) {
      this.isMprMode = false;
    } else {
      const view = this.views[this.activeViewIndex];
      if (!view.studyUid || !view.seriesUid) {
        alert('Please load a series first');
        return;
      }
      const eligibility = await dicomApi.checkMprEligibility(view.studyUid, view.seriesUid);
      if (!eligibility.eligible) {
        alert(`MPR not available: ${eligibility.reason || 'Unknown reason'}`);
        return;
      }
      this.isMprMode = true;
      this.mprAxialIndex = Math.floor(eligibility.slice_count / 2);
      this.mprSagittalIndex = 256;
      this.mprCoronalIndex = 256;
      await this.loadMprSlices(view.studyUid, view.seriesUid);
    }
    this.render();
  }

  private async loadMprSlices(studyUid: string, seriesUid: string) {
    try {
      const slices = await dicomApi.generateMprSlices(
        studyUid,
        seriesUid,
        this.mprAxialIndex,
        this.mprSagittalIndex,
        this.mprCoronalIndex
      );
      const cacheKey = `${studyUid}|${seriesUid}`;
      const rgbaMaps = this.convertMprToRgba(slices);
      this.mprCache.set(cacheKey, { slices, rgbaMaps });
      this.mprSagittalIndex = Math.min(this.mprSagittalIndex, slices[3].sagittal_slices - 1);
      this.mprCoronalIndex = Math.min(this.mprCoronalIndex, slices[3].coronal_slices - 1);
    } catch (e) {
      console.error('Failed to load MPR slices:', e);
    }
  }

  private convertMprToRgba(slices: [MprSliceData, MprSliceData, MprSliceData, MprVolumeInfo]): Map<string, Uint8ClampedArray> {
    const result = new Map<string, Uint8ClampedArray>();
    const orientations = ['axial', 'sagittal', 'coronal'];
    for (let i = 0; i < 3; i++) {
      const slice = slices[i] as MprSliceData;
      const rgba = this.pixelsToRgba(slice.pixels, slice.width, slice.height);
      result.set(orientations[i], rgba);
    }
    return result;
  }

  private pixelsToRgba(pixels: number[], width: number, height: number): Uint8ClampedArray {
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const p of pixels) {
      if (p < minVal) minVal = p;
      if (p > maxVal) maxVal = p;
    }
    const range = maxVal - minVal || 1;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i++) {
      const normalized = Math.max(0, Math.min(255, ((pixels[i] - minVal) / range) * 255));
      rgba[i * 4] = normalized;
      rgba[i * 4 + 1] = normalized;
      rgba[i * 4 + 2] = normalized;
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }

  setInfoTab(tab: string) {
    this.infoTab = tab;
    this.render();
  }

  setTagSearch(search: string) {
    this.tagSearch = search;
    this.render();
  }

  async exportCurrentAnonymized() {
    const path = await dicomApi.showSaveDialog('anonymized.dcm', [
      { name: 'DICOM', extensions: ['dcm'] }
    ]);
    if (path) {
      alert('Please select the source DICOM file to anonymize');
      const { open } = await import('@tauri-apps/api/dialog');
      const src = await open({
        filters: [{ name: 'DICOM', extensions: ['dcm', 'dicom', ''] }],
        multiple: false,
      }) as string | null;
      if (src) {
        await dicomApi.anonymizeDicomFile(src, path);
        alert('Anonymization complete');
      }
    }
  }

  async exportStudyAnonymized() {
    if (!this.selectedStudyUid) return;
    const { open } = await import('@tauri-apps/api/dialog');
    const dir = await open({ directory: true, multiple: false }) as string | null;
    if (dir) {
      const files = await dicomApi.anonymizeStudy(this.selectedStudyUid, dir);
      alert(`Anonymized ${files.length} files`);
    }
  }

  render() {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    appEl.innerHTML = `
      <div class="app-container">
        ${this.renderToolbar()}
        <div class="main-content">
          ${this.renderSidebar()}
          ${this.renderViewerArea()}
          ${this.renderInfoPanel()}
        </div>
        ${this.renderStatusBar()}
      </div>
    `;

    this.bindEvents();
    this.renderImageViews();
  }

  private renderToolbar(): string {
    const toolBtn = (tool: ToolType, icon: string, label: string) =>
      `<button data-tool="${tool}" class="${this.currentTool === tool ? 'active' : ''}" title="${label}">${icon}</button>`;

    const layoutBtn = (layout: LayoutType, label: string) =>
      `<button data-layout="${layout}" class="${this.layout === layout ? 'active' : ''}">${label}</button>`;

    const colors: AnnotationColor[] = ['red', 'yellow', 'green', 'blue'];
    const colorMap: Record<AnnotationColor, string> = {
      red: '#ef4444', yellow: '#fbbf24', green: '#22c55e', blue: '#3b82f6',
    };

    return `
      <div class="toolbar">
        <div class="toolbar-group">
          <button id="btn-open-file" title="Open DICOM File">📄</button>
          <button id="btn-open-dir" title="Open DICOM Directory">📁</button>
        </div>
        <div class="toolbar-group">
          ${toolBtn('window', '🎚️', 'Window/Level (Right drag)')}
          ${toolBtn('zoom', '🔍', 'Zoom')}
          ${toolBtn('pan', '✋', 'Pan')}
        </div>
        <div class="toolbar-group">
          ${toolBtn('line', '📏', 'Line Measurement')}
          ${toolBtn('angle', '📐', 'Angle Measurement')}
          ${toolBtn('rect_roi', '⬛', 'Rectangle ROI')}
          ${toolBtn('ellipse_roi', '⚫', 'Ellipse ROI')}
        </div>
        <div class="toolbar-group">
          ${toolBtn('arrow', '➡️', 'Arrow')}
          ${toolBtn('text', '📝', 'Text')}
          ${toolBtn('brush', '✏️', 'Brush')}
          ${colors.map(c => `<span class="color-option ${this.annotationColor === c ? 'selected' : ''}" data-color="${c}" style="background:${colorMap[c]}"></span>`).join('')}
          <button id="btn-del-ann" title="Delete Selected">🗑️</button>
          <button id="btn-clear-ann" title="Clear All">🧹</button>
          <button id="btn-toggle-ann" title="Toggle Annotations">${this.showAnnotations ? '👁️' : '👁️‍🗨️'}</button>
        </div>
        <div class="toolbar-group">
          <button id="btn-reset" title="Reset View">↺</button>
          <button id="btn-rotate" title="Rotate 90°">↻</button>
          <button id="btn-flip-h" title="Flip Horizontal">⇋</button>
          <button id="btn-flip-v" title="Flip Vertical">⇅</button>
          <button id="btn-invert" title="Invert">◐</button>
        </div>
        <div class="toolbar-group">
          ${layoutBtn('1x1', '1:1')}
          ${layoutBtn('1x2', '1:2')}
          ${layoutBtn('2x2', '2:2')}
          ${layoutBtn('3x3', '3:3')}
        </div>
        <div class="toolbar-group playback-controls">
          <button id="btn-prev" title="Previous">⏮</button>
          <button id="btn-play" title="Play/Pause">${this.isPlaying ? '⏸' : '▶'}</button>
          <button id="btn-next" title="Next">⏭</button>
          <input type="number" id="fps-input" class="fps-input" value="${this.playFps}" min="1" max="30" step="1" title="FPS">
          <span>FPS</span>
        </div>
        <div class="toolbar-group">
          <button id="btn-mpr" title="MPR Mode" class="${this.isMprMode ? 'active' : ''}">MPR</button>
        </div>
        <div class="toolbar-spacer"></div>
        <div class="toolbar-group">
          <button id="btn-export-img" title="Export Screenshot">💾 Image</button>
          <button id="btn-export-ann" title="Export Annotations">💾 Annotations</button>
          <button id="btn-load-ann" title="Load Annotations">📂 Annotations</button>
          <button id="btn-anon-file" title="Anonymize File">🔒 File</button>
          <button id="btn-anon-study" title="Anonymize Study">🔒 Study</button>
        </div>
      </div>
    `;
  }

  private renderSidebar(): string {
    let content = '';

    if (this.studies.length === 0) {
      content = `<div class="empty-state" style="padding: 40px 20px;">
        <p>No DICOM files loaded</p>
        <p style="font-size: 11px;">Open a file or folder to begin</p>
      </div>`;
    } else {
      for (const study of this.studies) {
        const series = this.seriesMap.get(study.study_uid) || [];
        const isSelected = study.study_uid === this.selectedStudyUid;
        content += `
          <div class="study-item ${isSelected ? 'selected' : ''}" data-study="${study.study_uid}">
            <div class="study-patient">${study.patient.name || 'Unknown'}</div>
            <div class="study-info">
              ID: ${study.patient.id || 'N/A'}<br>
              Date: ${study.study_date || 'N/A'}<br>
              Modality: ${study.modality || 'N/A'}<br>
              ${study.study_description || ''}
            </div>
            ${isSelected ? this.renderSeriesList(study.study_uid, series) : ''}
          </div>
        `;
      }
    }

    return `
      <div class="sidebar">
        <div class="sidebar-header">Studies (${this.studies.length})</div>
        <div class="sidebar-content">
          ${content}
        </div>
      </div>
    `;
  }

  private renderSeriesList(studyUid: string, series: SeriesInfo[]): string {
    let html = '<div class="series-list">';
    for (const s of series) {
      const isSelected = s.series_uid === this.selectedSeriesUid;
      let thumb = '';
      if (s.thumbnail && s.thumbnail.length > 0) {
        let binary = '';
        const bytes = s.thumbnail;
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          const chunk = bytes.slice(i, i + chunkSize);
          binary += String.fromCharCode.apply(null, chunk as any);
        }
        try {
          thumb = `data:image/png;base64,${btoa(binary)}`;
        } catch (e) {
          thumb = '';
        }
      }
      html += `
        <div class="series-item ${isSelected ? 'selected' : ''}" data-study="${studyUid}" data-series="${s.series_uid}">
          ${thumb ? `<img class="series-thumbnail" src="${thumb}">` : `<div class="series-thumbnail"></div>`}
          <div class="series-info">
            <div class="series-modality">${s.modality} #${s.series_number} (${s.instance_count})</div>
            <div class="series-desc">${s.series_description || 'No description'}</div>
          </div>
        </div>
      `;
    }
    html += '</div>';
    return html;
  }

  private renderViewerArea(): string {
    if (this.isMprMode) {
      return `
        <div class="viewer-area">
          <div class="mpr-view">
            <div class="image-cell active" data-view="0">
              <div class="mpr-label">Axial</div>
              <canvas></canvas>
              <div class="overlay-info overlay-topleft"></div>
              <div class="overlay-info overlay-topright"></div>
              <div class="overlay-info overlay-bottomleft"></div>
              <div class="overlay-info overlay-bottomright"></div>
            </div>
            <div class="image-cell" data-view="1">
              <div class="mpr-label">Sagittal</div>
              <canvas></canvas>
              <div class="overlay-info overlay-topleft"></div>
              <div class="overlay-info overlay-topright"></div>
              <div class="overlay-info overlay-bottomleft"></div>
              <div class="overlay-info overlay-bottomright"></div>
            </div>
            <div class="image-cell" data-view="2">
              <div class="mpr-label">Coronal</div>
              <canvas></canvas>
              <div class="overlay-info overlay-topleft"></div>
              <div class="overlay-info overlay-topright"></div>
              <div class="overlay-info overlay-bottomleft"></div>
              <div class="overlay-info overlay-bottomright"></div>
            </div>
            <div class="image-cell">
              <div class="mpr-label" style="color: var(--text-secondary);">3D View</div>
            </div>
          </div>
        </div>
      `;
    }

    const count = this.getViewCount();
    let cells = '';
    for (let i = 0; i < count; i++) {
      cells += `
        <div class="image-cell ${i === this.activeViewIndex ? 'active' : ''}" data-view="${i}">
          <canvas></canvas>
          <div class="overlay-info overlay-topleft"></div>
          <div class="overlay-info overlay-topright"></div>
          <div class="overlay-info overlay-bottomleft"></div>
          <div class="overlay-info overlay-bottomright"></div>
        </div>
      `;
    }

    return `
      <div class="viewer-area">
        <div class="image-grid" data-layout="${this.layout}">
          ${cells}
        </div>
      </div>
    `;
  }

  private renderInfoPanel(): string {
    const view = this.views[this.activeViewIndex];
    const key = this.getViewKey(this.activeViewIndex);
    const pixelData = this.pixelDataMap.get(key);
    const anns = this.annotations.get(key) || [];

    const filteredTags = this.tagSearch
      ? this.tags.filter(t =>
          t.name.toLowerCase().includes(this.tagSearch.toLowerCase()) ||
          `${t.group.toString(16).padStart(4, '0')}${t.element.toString(16).padStart(4, '0')}`.toLowerCase().includes(this.tagSearch.toLowerCase()) ||
          t.value.toLowerCase().includes(this.tagSearch.toLowerCase())
        )
      : this.tags;

    const tagRow = (t: DicomTag) => {
      let cls = '';
      if (t.is_private) cls = 'private';
      else if (t.group === 0x0010) cls = 'patient';
      else if (t.group === 0x0028) cls = 'image';

      return `
        <tr class="${cls}">
          <td>(${t.group.toString(16).padStart(4, '0').toUpperCase()},${t.element.toString(16).padStart(4, '0').toUpperCase()})</td>
          <td>${t.vr}</td>
          <td>${t.name}${t.is_private ? ' [Private]' : ''}</td>
          <td class="tag-value" title="${t.value}">${t.value.length > 50 ? t.value.substring(0, 50) + '...' : t.value}</td>
        </tr>
      `;
    };

    const tabContent: Record<string, string> = {
      window: `
        <div class="window-controls">
          <h4 style="margin-bottom: 8px;">Window / Level</h4>
          <div class="window-row">
            <label>Width:</label>
            <input type="number" id="ww-input" value="${view.windowWidth.toFixed(1)}" step="1">
          </div>
          <div class="window-row">
            <label>Level:</label>
            <input type="number" id="wl-input" value="${view.windowCenter.toFixed(1)}" step="1">
          </div>
          <h4 style="margin: 12px 0 8px;">Presets</h4>
          <div class="window-presets">
            ${this.windowPresets.map(p =>
              `<button data-preset="${p.name}">${p.name}</button>`
            ).join('')}
          </div>
        </div>
      `,
      measurements: `
        <div style="padding: 8px;">
          <h4 style="margin-bottom: 8px;">Measurements & Annotations (${anns.length})</h4>
          ${anns.length === 0 ? '<p style="color: var(--text-secondary); font-size: 11px;">No annotations</p>' :
            anns.map(a => `
              <div class="measurement-item ${a.id === this.selectedAnnotationId ? 'selected' : ''}" data-ann="${a.id}">
                <span>${a.type}: ${this.getAnnotationSummary(a)}</span>
                <span class="measurement-delete" data-del="${a.id}">✕</span>
              </div>
            `).join('')
          }
        </div>
      `,
      tags: `
        <div style="padding: 8px;">
          <input type="text" class="tag-search" id="tag-search" placeholder="Search tags..." value="${this.tagSearch}">
          <table class="tag-table">
            <thead>
              <tr><th>Tag</th><th>VR</th><th>Name</th><th>Value</th></tr>
            </thead>
            <tbody>
              ${filteredTags.slice(0, 500).map(tagRow).join('')}
            </tbody>
          </table>
          ${filteredTags.length > 500 ? `<p style="padding: 8px; font-size: 11px; color: var(--text-secondary);">Showing 500 of ${filteredTags.length} tags</p>` : ''}
        </div>
      `,
      info: pixelData ? `
        <div style="padding: 8px; font-size: 12px; line-height: 1.8;">
          <h4 style="margin-bottom: 8px;">Image Info</h4>
          <p><strong>Size:</strong> ${pixelData.width} x ${pixelData.height}</p>
          <p><strong>Slices:</strong> ${pixelData.total_slices}</p>
          <p><strong>Frames:</strong> ${pixelData.frames}</p>
          <p><strong>Photometric:</strong> ${pixelData.photometric_interpretation}</p>
          <p><strong>Pixel Spacing:</strong> ${pixelData.pixel_spacing ? `${pixelData.pixel_spacing[0].toFixed(4)}, ${pixelData.pixel_spacing[1].toFixed(4)} mm` : 'N/A'}</p>
          <p><strong>Slice Thickness:</strong> ${pixelData.slice_thickness?.toFixed(2) || 'N/A'} mm</p>
          <p><strong>Slice Location:</strong> ${pixelData.slice_location?.toFixed(2) || 'N/A'} mm</p>
          <p><strong>Rescale:</strong> slope=${pixelData.rescale_slope}, intercept=${pixelData.rescale_intercept}</p>
          <p><strong>Pixel Range:</strong> ${pixelData.min_pixel_value.toFixed(1)} ~ ${pixelData.max_pixel_value.toFixed(1)}</p>
          <h4 style="margin: 12px 0 8px;">View State</h4>
          <p><strong>Zoom:</strong> ${(view.zoom * 100).toFixed(0)}%</p>
          <p><strong>Pan:</strong> (${view.panX.toFixed(0)}, ${view.panY.toFixed(0)})</p>
          <p><strong>Rotation:</strong> ${view.rotation}°</p>
          <p><strong>Flip:</strong> H=${view.flipH}, V=${view.flipV}</p>
          <p><strong>Invert:</strong> ${view.invert}</p>
        </div>
      ` : `<div class="empty-state" style="padding: 40px 20px;"><p>No image loaded</p></div>`,
    };

    return `
      <div class="info-panel">
        <div class="info-tabs">
          <div class="info-tab ${this.infoTab === 'window' ? 'active' : ''}" data-tab="window">Window</div>
          <div class="info-tab ${this.infoTab === 'measurements' ? 'active' : ''}" data-tab="measurements">Anns</div>
          <div class="info-tab ${this.infoTab === 'tags' ? 'active' : ''}" data-tab="tags">Tags</div>
          <div class="info-tab ${this.infoTab === 'info' ? 'active' : ''}" data-tab="info">Info</div>
        </div>
        <div class="info-content">
          ${tabContent[this.infoTab] || ''}
        </div>
      </div>
    `;
  }

  private getAnnotationSummary(a: Annotation): string {
    switch (a.type) {
      case 'line': return `${a.distance.toFixed(2)} mm`;
      case 'angle': return `${a.angle.toFixed(2)}°`;
      case 'rect_roi':
      case 'ellipse_roi': return `mean=${a.mean.toFixed(1)}, area=${a.area.toFixed(1)}mm²`;
      case 'arrow': return a.text || 'arrow';
      case 'text': return a.text;
      case 'brush': return `${a.points.length} points`;
      default: return (a as Annotation).type;
    }
  }

  private renderStatusBar(): string {
    const view = this.views[this.activeViewIndex];
    const key = this.getViewKey(this.activeViewIndex);
    const pixelData = this.pixelDataMap.get(key);
    const series = this.getCurrentSeries();

    return `
      <div class="status-bar">
        <div class="status-item">Tool: ${this.currentTool}</div>
        <div class="status-item">WW: ${view.windowWidth.toFixed(0)}</div>
        <div class="status-item">WL: ${view.windowCenter.toFixed(0)}</div>
        ${pixelData ? `<div class="status-item">Zoom: ${(view.zoom * 100).toFixed(0)}%</div>` : ''}
        ${pixelData ? `<div class="status-item">Slice: ${view.instanceIndex + 1}/${pixelData.total_slices}</div>` : ''}
        ${series?.is_multiframe ? `<div class="status-item">Frame: ${view.frameIndex + 1}/${pixelData?.frames || 1}</div>` : ''}
        ${pixelData ? `<div class="status-item">Size: ${pixelData.width}x${pixelData.height}</div>` : ''}
        <div class="status-item" style="margin-left: auto; color: var(--text-secondary);">DICOM Viewer</div>
      </div>
    `;
  }

  private bindEvents() {
    document.getElementById('btn-open-file')?.addEventListener('click', () => this.openFile());
    document.getElementById('btn-open-dir')?.addEventListener('click', () => this.openDirectory());
    document.getElementById('btn-reset')?.addEventListener('click', () => this.resetView());
    document.getElementById('btn-rotate')?.addEventListener('click', () => this.rotate90());
    document.getElementById('btn-flip-h')?.addEventListener('click', () => this.flipHorizontal());
    document.getElementById('btn-flip-v')?.addEventListener('click', () => this.flipVertical());
    document.getElementById('btn-invert')?.addEventListener('click', () => {
      this.views[this.activeViewIndex].invert = !this.views[this.activeViewIndex].invert;
      this.updateRgbaData(this.activeViewIndex).then(() => this.render());
    });
    document.getElementById('btn-prev')?.addEventListener('click', () => {
      const s = this.getCurrentSeries();
      s?.is_multiframe ? this.prevFrame() : this.prevSlice();
    });
    document.getElementById('btn-next')?.addEventListener('click', () => {
      const s = this.getCurrentSeries();
      s?.is_multiframe ? this.nextFrame() : this.nextSlice();
    });
    document.getElementById('btn-play')?.addEventListener('click', () => this.togglePlayback());
    document.getElementById('btn-del-ann')?.addEventListener('click', () => this.deleteSelectedAnnotation());
    document.getElementById('btn-clear-ann')?.addEventListener('click', () => this.clearAnnotations());
    document.getElementById('btn-toggle-ann')?.addEventListener('click', () => this.toggleAnnotations());
    document.getElementById('btn-export-img')?.addEventListener('click', () => this.exportScreenshot());
    document.getElementById('btn-export-ann')?.addEventListener('click', () => this.exportAnnotations());
    document.getElementById('btn-load-ann')?.addEventListener('click', () => this.loadAnnotationsFile());
    document.getElementById('btn-mpr')?.addEventListener('click', () => this.toggleMprMode());
    document.getElementById('btn-anon-file')?.addEventListener('click', () => this.exportCurrentAnonymized());
    document.getElementById('btn-anon-study')?.addEventListener('click', () => this.exportStudyAnonymized());

    document.getElementById('fps-input')?.addEventListener('change', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value) || 15;
      this.setPlayFps(val);
    });

    document.getElementById('ww-input')?.addEventListener('change', (e) => {
      const ww = parseFloat((e.target as HTMLInputElement).value) || 1;
      this.setWindowValues(ww, this.views[this.activeViewIndex].windowCenter);
    });
    document.getElementById('wl-input')?.addEventListener('change', (e) => {
      const wl = parseFloat((e.target as HTMLInputElement).value) || 0;
      this.setWindowValues(this.views[this.activeViewIndex].windowWidth, wl);
    });
    document.getElementById('tag-search')?.addEventListener('input', (e) => {
      this.setTagSearch((e.target as HTMLInputElement).value);
    });

    document.querySelectorAll('[data-tool]').forEach(el => {
      el.addEventListener('click', () => this.setTool(el.getAttribute('data-tool') as ToolType));
    });
    document.querySelectorAll('[data-layout]').forEach(el => {
      el.addEventListener('click', () => this.setLayout(el.getAttribute('data-layout') as LayoutType));
    });
    document.querySelectorAll('[data-color]').forEach(el => {
      el.addEventListener('click', () => this.setAnnotationColor(el.getAttribute('data-color') as AnnotationColor));
    });
    document.querySelectorAll('[data-preset]').forEach(el => {
      el.addEventListener('click', () => {
        const name = el.getAttribute('data-preset')!;
        const preset = this.windowPresets.find(p => p.name === name);
        if (preset) this.applyWindowPreset(preset);
      });
    });
    document.querySelectorAll('.info-tab').forEach(el => {
      el.addEventListener('click', () => this.setInfoTab(el.getAttribute('data-tab')!));
    });
    document.querySelectorAll('.study-item').forEach(el => {
      el.addEventListener('click', () => this.selectStudy(el.getAttribute('data-study')!));
    });
    document.querySelectorAll('.series-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const studyUid = el.getAttribute('data-study')!;
        const seriesUid = el.getAttribute('data-series')!;
        this.selectSeries(studyUid, seriesUid);
      });
    });
    document.querySelectorAll('[data-ann]').forEach(el => {
      el.addEventListener('click', () => {
        this.selectedAnnotationId = el.getAttribute('data-ann');
        this.render();
      });
    });
    document.querySelectorAll('[data-del]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedAnnotationId = el.getAttribute('data-del');
        this.deleteSelectedAnnotation();
      });
    });

    document.querySelectorAll('.image-cell').forEach(cell => {
      const viewIdx = parseInt(cell.getAttribute('data-view') || '0');
      const canvas = cell.querySelector('canvas');
      if (!canvas) return;

      const resizeCanvas = () => {
        const rect = cell.getBoundingClientRect();
        canvas.width = Math.floor(rect.width);
        canvas.height = Math.floor(rect.height);
        this.renderSingleView(viewIdx);
      };
      resizeCanvas();
      const ro = new ResizeObserver(resizeCanvas);
      ro.observe(cell);

      cell.addEventListener('click', () => this.setActiveView(viewIdx));

      canvas.addEventListener('mousedown', (e) => {
        if (e.button === 2) {
          this.setTool('window');
        } else if (e.button === 1) {
          this.setTool('pan');
        }
        this.handleCanvasMouseDown(viewIdx, e, canvas);
      });
      canvas.addEventListener('mousemove', (e) => this.handleCanvasMouseMove(viewIdx, e, canvas));
      canvas.addEventListener('mouseup', (e) => this.handleCanvasMouseUp(viewIdx, e, canvas));
      canvas.addEventListener('mouseleave', (e) => this.handleCanvasMouseUp(viewIdx, e, canvas));
      canvas.addEventListener('wheel', (e) => this.handleCanvasWheel(viewIdx, e as WheelEvent), { passive: false });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        this.deleteSelectedAnnotation();
      } else if (e.key === 'Escape') {
        this.drawing = false;
        this.tempPoints = [];
        this.selectedAnnotationId = null;
        this.render();
      }
    });
  }

  private renderImageViews() {
    const count = this.isMprMode ? 3 : this.getViewCount();
    for (let i = 0; i < count; i++) {
      this.renderSingleView(i);
    }
  }

  private async renderSingleView(viewIdx: number) {
    const cells = document.querySelectorAll('.image-cell');
    const cell = cells[viewIdx];
    if (!cell) return;

    const canvas = cell.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (this.isMprMode) {
      const mprLabels = ['Axial', 'Sagittal', 'Coronal'];
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const view = this.views[0];
      if (view.studyUid && view.seriesUid) {
        const cacheKey = `${view.studyUid}|${view.seriesUid}`;
        const cached = this.mprCache.get(cacheKey);
        const orientationKeys = ['axial', 'sagittal', 'coronal'];
        const orientationKey = orientationKeys[viewIdx];

        if (cached && cached.rgbaMaps.has(orientationKey)) {
          const rgba = cached.rgbaMaps.get(orientationKey)!;
          const slice = cached.slices[viewIdx] as MprSliceData;
          const imgData = new ImageData(rgba as unknown as Uint8ClampedArray<ArrayBuffer>, slice.width, slice.height);
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = slice.width;
          tempCanvas.height = slice.height;
          const tempCtx = tempCanvas.getContext('2d')!;
          tempCtx.putImageData(imgData, 0, 0);

          const scale = Math.min(canvas.width / slice.width, canvas.height / slice.height);
          const drawW = slice.width * scale;
          const drawH = slice.height * scale;
          const offsetX = (canvas.width - drawW) / 2;
          const offsetY = (canvas.height - drawH) / 2;
          ctx.drawImage(tempCanvas, offsetX, offsetY, drawW, drawH);
        } else {
          ctx.fillStyle = '#888';
          ctx.font = '14px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`${mprLabels[viewIdx]} View`, canvas.width / 2, canvas.height / 2);
        }
      } else {
        ctx.fillStyle = '#888';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${mprLabels[viewIdx]} View`, canvas.width / 2, canvas.height / 2);
      }
      return;
    }

    const view = this.views[viewIdx];
    const key = this.getViewKey(viewIdx);
    const pixelData = this.pixelDataMap.get(key);
    const rgba = this.rgbaDataMap.get(key);

    if (!pixelData || !rgba) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#666';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No image loaded', canvas.width / 2, canvas.height / 2);
      return;
    }

    drawImage(ctx, rgba, pixelData.width, pixelData.height,
      canvas.width, canvas.height, view.zoom, view.panX, view.panY,
      view.rotation, view.flipH, view.flipV);

    if (this.showAnnotations) {
      const anns = this.annotations.get(key) || [];
      const allAnns = [...anns];
      if (this.drawing && this.tempPoints.length > 0) {
        allAnns.push(...this.getTempAnnotations());
      }
      drawAnnotations(ctx, allAnns, canvas.width, canvas.height,
        pixelData.width, pixelData.height, view.zoom, view.panX, view.panY,
        view.rotation, view.flipH, view.flipV, pixelData.pixel_spacing,
        this.selectedAnnotationId);
    }

    this.renderOverlay(viewIdx, cell, pixelData);
  }

  private getTempAnnotations(): Annotation[] {
    const result: Annotation[] = [];
    if (this.tempPoints.length < 2) return result;

    if (this.currentTool === 'line') {
      result.push({
        id: 'temp',
        type: 'line',
        start: this.tempPoints[0],
        end: this.tempPoints[1],
        distance: 0,
        color: this.annotationColor,
      });
    } else if (this.currentTool === 'arrow') {
      result.push({
        id: 'temp',
        type: 'arrow',
        start: this.tempPoints[0],
        end: this.tempPoints[1],
        text: '',
        color: this.annotationColor,
      });
    } else if (this.currentTool === 'rect_roi') {
      const x = Math.min(this.tempPoints[0].x, this.tempPoints[1].x);
      const y = Math.min(this.tempPoints[0].y, this.tempPoints[1].y);
      result.push({
        id: 'temp',
        type: 'rect_roi',
        x, y,
        width: Math.abs(this.tempPoints[1].x - this.tempPoints[0].x),
        height: Math.abs(this.tempPoints[1].y - this.tempPoints[0].y),
        mean: 0, std: 0, min: 0, max: 0, area: 0,
        color: this.annotationColor,
      });
    } else if (this.currentTool === 'ellipse_roi') {
      const x = Math.min(this.tempPoints[0].x, this.tempPoints[1].x);
      const y = Math.min(this.tempPoints[0].y, this.tempPoints[1].y);
      result.push({
        id: 'temp',
        type: 'ellipse_roi',
        x, y,
        width: Math.abs(this.tempPoints[1].x - this.tempPoints[0].x),
        height: Math.abs(this.tempPoints[1].y - this.tempPoints[0].y),
        mean: 0, std: 0, min: 0, max: 0, area: 0,
        color: this.annotationColor,
      });
    } else if (this.currentTool === 'brush' && this.tempPoints.length > 1) {
      result.push({
        id: 'temp',
        type: 'brush',
        points: [...this.tempPoints],
        color: this.annotationColor,
      });
    } else if (this.currentTool === 'angle' && this.tempPoints.length > 0) {
      result.push({
        id: 'temp',
        type: 'angle',
        points: [
          this.tempPoints[0],
          this.tempPoints[1] || this.tempPoints[0],
          this.tempPoints[2] || this.tempPoints[0],
        ] as [Point, Point, Point],
        angle: 0,
        color: this.annotationColor,
      });
    }

    return result;
  }

  private renderOverlay(viewIdx: number, cell: Element, pixelData: PixelDataResponse) {
    const view = this.views[viewIdx];
    const tl = cell.querySelector('.overlay-topleft');
    const tr = cell.querySelector('.overlay-topright');
    const bl = cell.querySelector('.overlay-bottomleft');
    const br = cell.querySelector('.overlay-bottomright');

    if (tl) {
      const study = this.studies.find(s => s.study_uid === view.studyUid);
      tl.innerHTML = `
        ${study?.patient.name || ''}<br>
        ${study?.patient.id || ''}<br>
        ${study?.study_date || ''}
      `;
    }
    if (tr) {
      const series = this.getCurrentSeries();
      tr.innerHTML = `
        ${series?.modality || ''} ${series?.series_number || ''}<br>
        ${series?.series_description || ''}
      `;
    }
    if (bl) {
      bl.innerHTML = `
        WW: ${view.windowWidth.toFixed(0)} WL: ${view.windowCenter.toFixed(0)}
      `;
    }
    if (br) {
      br.innerHTML = `
        Slice ${view.instanceIndex + 1}/${pixelData.total_slices}
      `;
    }
  }
}

const app = new DicomViewerApp();
(window as any).app = app;
app.init();
