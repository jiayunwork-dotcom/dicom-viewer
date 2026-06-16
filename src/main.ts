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
  Bookmark,
  PixelProbeInfo,
  ExportProgress,
  HistoryRecord,
  HistoryActionType,
  AnnotationTemplate,
  ReportData,
  ReportSeriesGroup,
  MeasurementRecord,
  ComparisonStats,
  ComparisonRow,
  TrendDataPoint,
  PersistedHistoryRecord,
  MeasurementType,
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

  private isComparisonMode: boolean = false;
  private comparisonLeftSeriesUid: string | null = null;
  private comparisonRightSeriesUid: string | null = null;

  private bookmarks: Bookmark[] = [];
  private bookmarksFilePath: string | null = null;

  private probeInfo: PixelProbeInfo | null = null;
  private probePosition: { x: number; y: number } | null = null;
  private probeViewIndex: number = -1;

  private exportProgress: ExportProgress | null = null;
  private exportCancelled: boolean = false;

  private history: HistoryRecord[] = [];
  private maxHistorySize: number = 100;
  private isUndoing: boolean = false;

  private showHistoryPanel: boolean = false;

  private showComparisonPanel: boolean = false;
  private comparisonSeriesA: string | null = null;
  private comparisonSeriesB: string | null = null;
  private trendSeriesUid: string | null = null;
  private historyMemoryOnly: boolean = false;
  private historyFilePath: string | null = null;
  private trendMouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private trendMouseLeaveHandler: (() => void) | null = null;

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
    if (this.isComparisonMode) return 2;
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
    return `${v.studyUid || ''}||${v.seriesUid || ''}||${v.instanceIndex}||${v.frameIndex}`;
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
    await this.loadBookmarksFromFile();
    await this.loadHistoryFromStudy();
    if (series.length > 0) {
      await this.selectSeries(studyUid, series[0].series_uid);
    }
    this.render();
  }

  private addHistoryRecord(
    action: HistoryActionType,
    viewKey: string,
    annotations: Annotation[],
    beforeSnapshot: Annotation[],
    summary: string
  ) {
    const record: HistoryRecord = {
      id: generateId(),
      action,
      timestamp: Date.now(),
      annotationIds: annotations.map(a => a.id),
      annotationsSnapshot: [...beforeSnapshot],
      viewKey,
      summary,
    };
    this.history.unshift(record);
    if (this.history.length > this.maxHistorySize) {
      this.history.pop();
    }
    this.persistHistory();
  }

  private clearHistory() {
    this.history = [];
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  undoLastAction() {
    if (this.history.length === 0) return;
    this.undoHistoryRecord(this.history[0].id);
  }

  undoHistoryRecord(recordId: string) {
    const idx = this.history.findIndex(r => r.id === recordId);
    if (idx < 0) return;
    if (idx !== 0) {
      alert('只能撤销最近的操作，请按时间倒序逐条撤销');
      return;
    }

    const record = this.history[idx];
    this.isUndoing = true;

    try {
      this.annotations.set(record.viewKey, [...record.annotationsSnapshot]);
      this.history.splice(idx, 1);
      this.persistHistory();
    } finally {
      this.isUndoing = false;
    }

    this.selectedAnnotationId = null;
    this.render();
    this.refreshReportIfVisible();
  }

  toggleHistoryPanel() {
    this.showHistoryPanel = !this.showHistoryPanel;
    this.render();
  }

  toggleTemplateDropdown() {
    const dropdown = document.getElementById('template-dropdown');
    if (dropdown) {
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    }
  }

  closeTemplateDropdown() {
    const dropdown = document.getElementById('template-dropdown');
    if (dropdown) {
      dropdown.style.display = 'none';
    }
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
    if (tool !== 'probe') {
      this.clearProbeInfo();
    }
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
      this.loadViewPixelData(this.activeViewIndex).then(() => {
        if (this.isComparisonMode) {
          this.syncComparisonSlice(this.activeViewIndex);
        }
        this.render();
      });
    }
  }

  prevSlice() {
    const view = this.views[this.activeViewIndex];
    if (view.instanceIndex > 0) {
      view.instanceIndex--;
      this.loadViewPixelData(this.activeViewIndex).then(() => {
        if (this.isComparisonMode) {
          this.syncComparisonSlice(this.activeViewIndex);
        }
        this.render();
      });
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

    if (this.currentTool === 'probe') {
      return;
    }

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
          createdAt: Date.now(),
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

    if (this.currentTool === 'probe') {
      this.updateProbeInfo(viewIdx, x, y, canvas);
      this.renderImageViews();
      this.renderProbeTooltip();
      return;
    }

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
      if (this.isComparisonMode) {
        this.syncComparisonZoomPan(viewIdx);
      }
      this.renderImageViews();
    } else if (this.currentTool === 'zoom') {
      const dy = y - this.drawStart.y;
      const factor = 1 - dy / 200;
      view.zoom = Math.max(0.5, Math.min(8, view.zoom * factor));
      this.drawStart = { x, y };
      if (this.isComparisonMode) {
        this.syncComparisonZoomPan(viewIdx);
      }
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
    if (this.currentTool === 'probe') {
      return;
    }
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
      if (this.isComparisonMode) {
        this.syncComparisonZoomPan(viewIdx);
      }
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
      createdAt: Date.now(),
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
      createdAt: Date.now(),
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
      createdAt: Date.now(),
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
        createdAt: Date.now(),
      };
      this.addAnnotation(viewIdx, ann);
    } else {
      const ann: RectRoiMeasurement = {
        id: generateId(),
        type: 'rect_roi',
        x, y, width: w, height: h,
        mean, std, min, max, area,
        color: this.annotationColor,
        createdAt: Date.now(),
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
      createdAt: Date.now(),
    };
    this.addAnnotation(viewIdx, ann);
    this.tempPoints = [];
  }

  private addAnnotation(viewIdx: number, ann: Annotation) {
    const key = this.getViewKey(viewIdx);
    if (!this.annotations.has(key)) {
      this.annotations.set(key, []);
    }
    const beforeSnapshot = [...(this.annotations.get(key) || [])];
    this.annotations.get(key)!.push(ann);
    this.selectedAnnotationId = ann.id;

    if (!this.isUndoing) {
      this.addHistoryRecord('add', key, [ann], beforeSnapshot, `Added ${this.getAnnotationSummary(ann)}`);
    }
    this.refreshReportIfVisible();
  }

  deleteSelectedAnnotation() {
    if (!this.selectedAnnotationId) return;
    const key = this.getViewKey(this.activeViewIndex);
    const anns = this.annotations.get(key);
    if (anns) {
      const idx = anns.findIndex(a => a.id === this.selectedAnnotationId);
      if (idx >= 0) {
        const deletedAnn = anns[idx];
        const beforeSnapshot = [...anns];
        anns.splice(idx, 1);

        if (!this.isUndoing) {
          this.addHistoryRecord('delete', key, [deletedAnn], beforeSnapshot, `Deleted ${this.getAnnotationSummary(deletedAnn)}`);
        }
      }
      this.selectedAnnotationId = null;
      this.render();
      this.refreshReportIfVisible();
    }
  }

  clearAnnotations() {
    const key = this.getViewKey(this.activeViewIndex);
    const beforeSnapshot = [...(this.annotations.get(key) || [])];
    if (beforeSnapshot.length === 0) return;

    this.annotations.delete(key);
    this.selectedAnnotationId = null;

    if (!this.isUndoing) {
      this.addHistoryRecord('clear', key, beforeSnapshot, beforeSnapshot, `Cleared ${beforeSnapshot.length} annotations`);
    }
    this.render();
    this.refreshReportIfVisible();
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

  async saveAnnotationTemplate() {
    const key = this.getViewKey(this.activeViewIndex);
    const pixelData = this.pixelDataMap.get(key);
    if (!pixelData) {
      alert('请先加载图像');
      return;
    }

    const anns = this.annotations.get(key) || [];
    if (anns.length === 0) {
      alert('当前没有标注可保存');
      return;
    }

    const series = this.getCurrentSeries();
    const seriesDesc = (series?.series_description || 'series').replace(/[^a-zA-Z0-9_-]/g, '_');
    const date = new Date().toISOString().slice(0, 10);
    const defaultName = `${seriesDesc}_annotations_${date}.json`;

    const template: AnnotationTemplate = {
      version: '1.0',
      imageSize: { width: pixelData.width, height: pixelData.height },
      seriesDescription: series?.series_description || '',
      createdAt: Date.now(),
      annotations: [...anns],
    };

    const path = await dicomApi.showSaveDialog(defaultName, [
      { name: 'JSON', extensions: ['json'] }
    ]);
    if (path) {
      await dicomApi.exportAnnotations(template, path);
      alert('标注模板保存成功');
    }
  }

  async loadAnnotationTemplate() {
    const { open } = await import('@tauri-apps/api/dialog');
    const path = await open({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      multiple: false,
    }) as string | null;
    if (!path) return;

    try {
      const template = await dicomApi.loadAnnotations(path) as AnnotationTemplate;

      if (!template.version || template.version !== '1.0') {
        alert('不支持的标注模板版本');
        return;
      }
      if (!template.imageSize || !template.annotations) {
        alert('无效的标注模板文件');
        return;
      }

      const key = this.getViewKey(this.activeViewIndex);
      const pixelData = this.pixelDataMap.get(key);
      if (!pixelData) {
        alert('请先加载图像');
        return;
      }

      if (template.imageSize.width !== pixelData.width || template.imageSize.height !== pixelData.height) {
        const confirmed = confirm(
          `标注模板的参考图像尺寸(${template.imageSize.width}x${template.imageSize.height})与当前图像(${pixelData.width}x${pixelData.height})不匹配，标注位置可能偏移。是否继续加载？`
        );
        if (!confirmed) return;
      }

      const existingAnns = this.annotations.get(key) || [];
      const newAnns = template.annotations.map(a => ({
        ...a,
        id: generateId(),
      }));
      this.annotations.set(key, [...existingAnns, ...newAnns]);

      if (!this.isUndoing) {
        const beforeSnapshot = [...existingAnns];
        this.addHistoryRecord('add', key, newAnns, beforeSnapshot, `Loaded ${newAnns.length} annotations from template`);
      }

      this.render();
      alert(`成功加载 ${newAnns.length} 个标注`);
    } catch (e) {
      alert('加载标注模板失败: ' + e);
    }
  }

  generateReportData(): ReportData | null {
    if (!this.selectedStudyUid) return null;

    const study = this.studies.find(s => s.study_uid === this.selectedStudyUid);
    if (!study) return null;

    const seriesList = this.seriesMap.get(this.selectedStudyUid) || [];
    const seriesGroups: ReportSeriesGroup[] = [];
    let totalDistance = 0;
    let totalAngle = 0;
    let totalRoi = 0;

    for (const series of seriesList) {
      const measurements: MeasurementRecord[] = [];

      const seriesKeyPrefix = `${this.selectedStudyUid}||${series.series_uid}||`;
      const annotationKeys = Array.from(this.annotations.keys()).filter(k =>
        k.startsWith(seriesKeyPrefix)
      );

      for (const key of annotationKeys) {
        const anns = this.annotations.get(key) || [];
        const suffix = key.slice(seriesKeyPrefix.length);
        const suffixParts = suffix.split('||');
        const instanceIndex = parseInt(suffixParts[0]) || 0;

        for (const ann of anns) {
          if (ann.type === 'line') {
            measurements.push({
              id: ann.id,
              type: 'line',
              value: ann.distance,
              unit: 'mm',
              seriesUid: series.series_uid,
              seriesDescription: series.series_description || '',
              instanceIndex,
              createdAt: ann.createdAt,
              annotation: ann,
            });
            totalDistance++;
          } else if (ann.type === 'angle') {
            measurements.push({
              id: ann.id,
              type: 'angle',
              value: ann.angle,
              unit: '°',
              seriesUid: series.series_uid,
              seriesDescription: series.series_description || '',
              instanceIndex,
              createdAt: ann.createdAt,
              annotation: ann,
            });
            totalAngle++;
          } else if (ann.type === 'rect_roi' || ann.type === 'ellipse_roi') {
            measurements.push({
              id: ann.id,
              type: ann.type,
              value: ann.area,
              unit: 'mm²',
              seriesUid: series.series_uid,
              seriesDescription: series.series_description || '',
              instanceIndex,
              createdAt: ann.createdAt,
              annotation: ann,
            });
            totalRoi++;
          }
        }
      }

      if (measurements.length > 0) {
        seriesGroups.push({
          seriesUid: series.series_uid,
          seriesDescription: series.series_description || '',
          measurements,
        });
      }
    }

    return {
      patientName: study.patient.name || 'Unknown',
      patientId: study.patient.id || 'N/A',
      studyDate: study.study_date || 'N/A',
      studyDescription: study.study_description || '',
      seriesGroups,
      totalDistance,
      totalAngle,
      totalRoi,
    };
  }

  async exportReportToPdf() {
    const reportData = this.generateReportData();
    if (!reportData) {
      alert('请先加载一个Study');
      return;
    }

    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 20;
      const contentWidth = pageWidth - margin * 2;
      let y = margin;

      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(`DICOM Measurement Report`, pageWidth / 2, y, { align: 'center' });
      y += 10;

      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text(`${reportData.patientName} - ${reportData.studyDate}`, pageWidth / 2, y, { align: 'center' });
      y += 15;

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Patient Information', margin, y);
      y += 8;

      const patientRows = [
        ['Patient Name', reportData.patientName],
        ['Patient ID', reportData.patientId],
        ['Study Date', reportData.studyDate],
        ['Study Description', reportData.studyDescription || 'N/A'],
      ];

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      for (const [label, value] of patientRows) {
        doc.setDrawColor(200);
        doc.rect(margin, y, contentWidth, 7);
        doc.text(label, margin + 2, y + 5);
        doc.text(value || 'N/A', margin + 50, y + 5);
        y += 7;
      }
      y += 8;

      for (const group of reportData.seriesGroups) {
        if (y > pageHeight - margin - 30) {
          doc.addPage();
          y = margin;
        }

        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(`Series: ${group.seriesDescription || 'Unknown'}`, margin, y);
        y += 8;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        const colX = [margin, margin + 35, margin + 70, margin + 110, margin + 150];
        const headers = ['Type', 'Value', 'Slice', 'Time'];
        headers.forEach((h, i) => {
          doc.text(h, colX[i], y);
        });
        y += 6;

        doc.setDrawColor(200);
        doc.line(margin, y, margin + contentWidth, y);
        y += 4;

        doc.setFont('helvetica', 'normal');
        for (const m of group.measurements) {
          if (y > pageHeight - margin - 20) {
            doc.addPage();
            y = margin;
            doc.setFontSize(10);
          }

          const typeMap: Record<string, string> = {
            line: 'Distance',
            angle: 'Angle',
            rect_roi: 'Rect ROI',
            ellipse_roi: 'Ellipse ROI',
          };

          doc.text(typeMap[m.type] || m.type, colX[0], y);
          doc.text(`${m.value.toFixed(2)} ${m.unit}`, colX[1], y);
          doc.text(`Slice ${m.instanceIndex + 1}`, colX[2], y);
          doc.text(new Date(m.createdAt).toLocaleTimeString(), colX[3], y);
          y += 7;
        }
        y += 8;
      }

      if (y > pageHeight - margin - 20) {
        doc.addPage();
        y = margin;
      }

      y += 5;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Summary', margin, y);
      y += 7;
      doc.setFont('helvetica', 'normal');
      doc.text(`Total Distance Measurements: ${reportData.totalDistance}`, margin, y);
      y += 6;
      doc.text(`Total Angle Measurements: ${reportData.totalAngle}`, margin, y);
      y += 6;
      doc.text(`Total ROI Measurements: ${reportData.totalRoi}`, margin, y);
      y += 6;
      doc.text(`Total: ${reportData.totalDistance + reportData.totalAngle + reportData.totalRoi} measurements`, margin, y);

      const safeName = reportData.patientName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const defaultName = `${safeName}_report.pdf`;
      const path = await dicomApi.showSaveDialog(defaultName, [
        { name: 'PDF', extensions: ['pdf'] }
      ]);
      if (path) {
        const { writeBinaryFile } = await import('@tauri-apps/api/fs');
        const pdfArrayBuffer = doc.output('arraybuffer');
        await writeBinaryFile(path, new Uint8Array(pdfArrayBuffer));
        alert('PDF导出成功');
      }
    } catch (e) {
      console.error('PDF export failed:', e);
      alert('PDF导出失败: ' + e);
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

  toggleComparisonMode() {
    if (this.isComparisonMode) {
      this.isComparisonMode = false;
      this.comparisonLeftSeriesUid = null;
      this.comparisonRightSeriesUid = null;
      this.layout = '1x1';
      this.initViews();
      if (this.selectedStudyUid && this.selectedSeriesUid) {
        this.selectSeries(this.selectedStudyUid, this.selectedSeriesUid);
      }
    } else {
      if (!this.selectedStudyUid) {
        alert('Please load a study first');
        return;
      }
      const series = this.seriesMap.get(this.selectedStudyUid) || [];
      if (series.length < 2) {
        alert('Comparison mode requires at least 2 series in the same study');
        return;
      }
      this.isComparisonMode = true;
      this.isMprMode = false;
      this.initViews();
      this.comparisonLeftSeriesUid = this.selectedSeriesUid || series[0].series_uid;
      this.comparisonRightSeriesUid = series.find(s => s.series_uid !== this.comparisonLeftSeriesUid)?.series_uid || series[0].series_uid;
      this.setupComparisonViews();
    }
    this.render();
  }

  private async setupComparisonViews() {
    if (!this.selectedStudyUid || !this.comparisonLeftSeriesUid || !this.comparisonRightSeriesUid) return;

    this.views[0].studyUid = this.selectedStudyUid;
    this.views[0].seriesUid = this.comparisonLeftSeriesUid;
    this.views[0].instanceIndex = 0;
    this.views[0].frameIndex = 0;
    this.views[0].zoom = 1;
    this.views[0].panX = 0;
    this.views[0].panY = 0;

    this.views[1].studyUid = this.selectedStudyUid;
    this.views[1].seriesUid = this.comparisonRightSeriesUid;
    this.views[1].instanceIndex = 0;
    this.views[1].frameIndex = 0;
    this.views[1].zoom = 1;
    this.views[1].panX = 0;
    this.views[1].panY = 0;

    await Promise.all([
      this.loadViewPixelData(0),
      this.loadViewPixelData(1),
    ]);
    this.render();
  }

  setComparisonSeries(side: 'left' | 'right', seriesUid: string) {
    if (!this.isComparisonMode) return;
    const idx = side === 'left' ? 0 : 1;
    if (side === 'left') {
      this.comparisonLeftSeriesUid = seriesUid;
    } else {
      this.comparisonRightSeriesUid = seriesUid;
    }
    const view = this.views[idx];
    if (this.selectedStudyUid) {
      view.studyUid = this.selectedStudyUid;
      view.seriesUid = seriesUid;
      view.instanceIndex = 0;
      view.frameIndex = 0;
      this.loadViewPixelData(idx).then(() => this.render());
    }
  }

  private syncComparisonSlice(sourceIdx: number) {
    if (!this.isComparisonMode) return;
    const targetIdx = sourceIdx === 0 ? 1 : 0;
    const sourceView = this.views[sourceIdx];
    const targetView = this.views[targetIdx];
    const targetKey = this.getViewKey(targetIdx);
    const targetPixelData = this.pixelDataMap.get(targetKey);
    if (targetPixelData) {
      const newIndex = Math.min(sourceView.instanceIndex, targetPixelData.total_slices - 1);
      if (targetView.instanceIndex !== newIndex) {
        targetView.instanceIndex = newIndex;
        this.loadViewPixelData(targetIdx);
      }
    }
  }

  private syncComparisonZoomPan(sourceIdx: number) {
    if (!this.isComparisonMode) return;
    const targetIdx = sourceIdx === 0 ? 1 : 0;
    this.views[targetIdx].zoom = this.views[sourceIdx].zoom;
    this.views[targetIdx].panX = this.views[sourceIdx].panX;
    this.views[targetIdx].panY = this.views[sourceIdx].panY;
  }

  addBookmark(note: string = '') {
    const view = this.views[this.activeViewIndex];
    if (!view.studyUid || !view.seriesUid) return;

    if (this.bookmarks.length >= 50) {
      alert('Maximum 50 bookmarks allowed');
      return;
    }

    const bookmark: Bookmark = {
      id: generateId(),
      studyUid: view.studyUid,
      seriesUid: view.seriesUid,
      instanceIndex: view.instanceIndex,
      frameIndex: view.frameIndex,
      windowWidth: view.windowWidth,
      windowCenter: view.windowCenter,
      zoom: view.zoom,
      panX: view.panX,
      panY: view.panY,
      note: note.substring(0, 100),
      createdAt: Date.now(),
    };

    this.bookmarks.unshift(bookmark);
    this.saveBookmarksToFile();
    this.render();
  }

  deleteBookmark(id: string) {
    this.bookmarks = this.bookmarks.filter(b => b.id !== id);
    this.saveBookmarksToFile();
    this.render();
  }

  updateBookmarkNote(id: string, note: string) {
    const b = this.bookmarks.find(b => b.id === id);
    if (b) {
      b.note = note.substring(0, 100);
      this.saveBookmarksToFile();
    }
  }

  async jumpToBookmark(id: string) {
    const bookmark = this.bookmarks.find(b => b.id === id);
    if (!bookmark) return;

    if (this.isComparisonMode) {
      this.toggleComparisonMode();
    }
    if (this.isMprMode) {
      this.isMprMode = false;
    }

    if (bookmark.studyUid !== this.selectedStudyUid) {
      await this.selectStudy(bookmark.studyUid);
    }

    this.activeViewIndex = 0;
    const view = this.views[0];
    view.studyUid = bookmark.studyUid;
    view.seriesUid = bookmark.seriesUid;
    view.instanceIndex = bookmark.instanceIndex;
    view.frameIndex = bookmark.frameIndex;
    view.windowWidth = bookmark.windowWidth;
    view.windowCenter = bookmark.windowCenter;
    view.zoom = bookmark.zoom;
    view.panX = bookmark.panX;
    view.panY = bookmark.panY;
    view.rotation = 0;
    view.flipH = false;
    view.flipV = false;
    view.invert = false;

    this.selectedStudyUid = bookmark.studyUid;
    this.selectedSeriesUid = bookmark.seriesUid;

    await this.loadViewPixelData(0);
    this.render();
  }

  private getBookmarksFilePath(): string | null {
    if (!this.selectedStudyUid) return null;
    const safeUid = this.selectedStudyUid.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `bookmarks_${safeUid}.json`;
  }

  private async saveBookmarksToFile() {
    const path = this.getBookmarksFilePath();
    if (!path) return;
    try {
      const { appDataDir } = await import('@tauri-apps/api/path');
      const dir = await appDataDir();
      const fullPath = `${dir}${path}`;
      await dicomApi.saveBookmarks(this.bookmarks, fullPath);
    } catch (e) {
      console.error('Failed to save bookmarks:', e);
    }
  }

  private async loadBookmarksFromFile() {
    const path = this.getBookmarksFilePath();
    if (!path) {
      this.bookmarks = [];
      return;
    }
    try {
      const { appDataDir } = await import('@tauri-apps/api/path');
      const dir = await appDataDir();
      const fullPath = `${dir}${path}`;
      this.bookmarks = await dicomApi.loadBookmarks(fullPath);
      this.bookmarks = this.bookmarks.filter(b => b.studyUid === this.selectedStudyUid);
    } catch (e) {
      this.bookmarks = [];
    }
  }

  updateProbeInfo(viewIdx: number, canvasX: number, canvasY: number, canvas: HTMLCanvasElement) {
    if (this.currentTool !== 'probe') {
      this.probeInfo = null;
      this.probePosition = null;
      this.probeViewIndex = -1;
      return;
    }

    const view = this.views[viewIdx];
    const key = this.getViewKey(viewIdx);
    const pixelData = this.pixelDataMap.get(key);
    if (!pixelData) {
      this.probeInfo = null;
      this.probePosition = null;
      return;
    }

    const p = canvasToPixel(canvasX, canvasY, canvas.width, canvas.height,
      pixelData.width, pixelData.height, view.zoom, view.panX, view.panY,
      view.rotation, view.flipH, view.flipV);

    const px = Math.floor(p.x);
    const py = Math.floor(p.y);

    if (px < 0 || px >= pixelData.width || py < 0 || py >= pixelData.height) {
      this.probeInfo = null;
      this.probePosition = null;
      return;
    }

    const idx = py * pixelData.width + px;
    const rawValue = pixelData.pixels[idx];
    const huValue = pixelData.rescale_slope != null && pixelData.rescale_intercept != null
      ? rawValue * pixelData.rescale_slope + pixelData.rescale_intercept
      : null;

    const ww = view.windowWidth;
    const wl = view.windowCenter;
    const minVal = wl - ww / 2;
    let mappedValue = ((rawValue - minVal) / ww) * 255;
    if (view.invert) mappedValue = 255 - mappedValue;
    mappedValue = Math.max(0, Math.min(255, Math.round(mappedValue)));

    this.probeInfo = {
      x: px,
      y: py,
      rawValue,
      huValue,
      mappedValue,
    };
    this.probePosition = { x: canvasX, y: canvasY };
    this.probeViewIndex = viewIdx;
  }

  clearProbeInfo() {
    this.probeInfo = null;
    this.probePosition = null;
    this.probeViewIndex = -1;
  }

  async exportSeriesAllSlices() {
    const view = this.views[this.activeViewIndex];
    if (!view.studyUid || !view.seriesUid) {
      alert('Please load a series first');
      return;
    }

    const key = this.getViewKey(this.activeViewIndex);
    const pixelData = this.pixelDataMap.get(key);
    if (!pixelData) return;

    const outputDir = await dicomApi.showOpenDirectoryDialog();
    if (!outputDir) return;

    const series = this.getCurrentSeries();
    const seriesDesc = (series?.series_description || 'series').replace(/[^a-zA-Z0-9_-]/g, '_');
    const totalSlices = pixelData.total_slices;

    this.exportProgress = { current: 0, total: totalSlices, cancelled: false };
    this.exportCancelled = false;
    this.render();

    try {
      for (let i = 0; i < totalSlices; i++) {
        if (this.exportCancelled) break;

        const sliceKey = `${view.studyUid}||${view.seriesUid}||${i}||${view.frameIndex}`;
        let slicePixelData = this.pixelDataMap.get(sliceKey);
        if (!slicePixelData) {
          slicePixelData = await dicomApi.getInstancePixelData(
            view.studyUid!,
            view.seriesUid!,
            i,
            view.frameIndex
          );
          this.pixelDataMap.set(sliceKey, slicePixelData);
        }

        let rgba = this.rgbaDataMap.get(sliceKey);
        if (!rgba) {
          const rgbaArr = await dicomApi.applyWindowLevel(
            Array.from(slicePixelData.pixels),
            slicePixelData.width,
            slicePixelData.height,
            view.windowWidth,
            view.windowCenter,
            slicePixelData.photometric_interpretation,
            view.invert
          );
          rgba = new Uint8ClampedArray(rgbaArr);
          this.rgbaDataMap.set(sliceKey, rgba);
        }

        const canvas = document.createElement('canvas');
        canvas.width = slicePixelData.width;
        canvas.height = slicePixelData.height;
        const ctx = canvas.getContext('2d')!;
        const imgData = new ImageData(rgba as unknown as Uint8ClampedArray<ArrayBuffer>, slicePixelData.width, slicePixelData.height);
        ctx.putImageData(imgData, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = Array.from(imageData.data);
        const sliceNum = String(i + 1).padStart(3, '0');
        const fileName = `${seriesDesc}_${sliceNum}.png`;
        const filePath = `${outputDir}/${fileName}`;

        await dicomApi.exportScreenshot(data, canvas.width, canvas.height, filePath, 'png');

        this.exportProgress.current = i + 1;
        this.render();
      }
    } catch (e) {
      console.error('Export failed:', e);
      alert(`Export failed: ${e}`);
    }

    const exported = this.exportProgress.current;
    this.exportProgress = null;
    this.render();

    if (!this.exportCancelled) {
      alert(`Export complete: ${exported} images saved to ${outputDir}`);
    }
  }

  cancelExport() {
    this.exportCancelled = true;
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
        <div id="probe-tooltip" class="probe-tooltip" style="display:none;"></div>
        <div id="trend-tooltip" class="probe-tooltip" style="display:none;"></div>
        ${this.exportProgress ? this.renderExportProgress() : ''}
      </div>
    `;

    this.bindEvents();
    this.renderImageViews();
    this.renderProbeTooltip();
    if (this.infoTab === 'report') {
      this.bindReportEvents();
      requestAnimationFrame(() => this.drawTrendChartIfNeeded());
    }
  }

  private renderProbeTooltip() {
    const tooltip = document.getElementById('probe-tooltip');
    if (!tooltip) return;

    if (!this.probeInfo || !this.probePosition) {
      tooltip.style.display = 'none';
      return;
    }

    const info = this.probeInfo;
    const pos = this.probePosition;

    tooltip.innerHTML = `
      <div><strong>Pixel:</strong> (${info.x}, ${info.y})</div>
      <div><strong>Raw:</strong> ${info.rawValue}</div>
      ${info.huValue != null ? `<div><strong>HU:</strong> ${info.huValue.toFixed(1)}</div>` : ''}
      <div><strong>Mapped:</strong> ${info.mappedValue}</div>
    `;

    tooltip.style.display = 'block';
    tooltip.style.left = (pos.x + 15) + 'px';
    tooltip.style.top = (pos.y + 15) + 'px';
  }

  private renderExportProgress(): string {
    if (!this.exportProgress) return '';
    const pct = Math.round((this.exportProgress.current / this.exportProgress.total) * 100);
    return `
      <div class="export-overlay">
        <div class="export-dialog">
          <h3>Exporting Series...</h3>
          <div class="export-progress-bar">
            <div class="export-progress-fill" style="width:${pct}%"></div>
          </div>
          <div class="export-progress-text">
            ${this.exportProgress.current} / ${this.exportProgress.total} (${pct}%)
          </div>
          <button id="btn-cancel-export" class="cancel-export-btn">Cancel</button>
        </div>
      </div>
    `;
  }

  private renderToolbar(): string {
    const toolBtn = (tool: ToolType, icon: string, label: string) =>
      `<button data-tool="${tool}" class="${this.currentTool === tool ? 'active' : ''}" title="${label}">${icon}</button>`;

    const layoutBtn = (layout: LayoutType, label: string) =>
      `<button data-layout="${layout}" class="${this.layout === layout && !this.isComparisonMode ? 'active' : ''}">${label}</button>`;

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
          ${toolBtn('probe', '📍', 'Pixel Probe')}
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
          <button id="btn-comparison" title="Comparison Mode" class="${this.isComparisonMode ? 'active' : ''}">⚖️</button>
        </div>
        <div class="toolbar-group">
          <button id="btn-bookmark" title="Add Bookmark">🔖</button>
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
          <button id="btn-export-series" title="Export All Series Slices">💾 Series</button>
          <div class="template-dropdown-wrapper">
            <button id="btn-template-menu" title="Annotation Templates">📋 Templates ▾</button>
            <div id="template-dropdown" class="template-dropdown" style="display:none;">
              <button id="btn-save-template" class="dropdown-item">💾 Save as Template</button>
              <button id="btn-load-template" class="dropdown-item">📂 Load Template</button>
            </div>
          </div>
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

    const bookmarksHtml = this.renderBookmarksList();

    return `
      <div class="sidebar">
        <div class="sidebar-header">Studies (${this.studies.length})</div>
        <div class="sidebar-content">
          ${content}
        </div>
        ${bookmarksHtml}
      </div>
    `;
  }

  private renderBookmarksList(): string {
    const studyBookmarks = this.bookmarks.filter(b => b.studyUid === this.selectedStudyUid);
    if (studyBookmarks.length === 0 && !this.selectedStudyUid) {
      return '';
    }

    const bookmarkItems = studyBookmarks.map(b => {
      const series = this.seriesMap.get(b.studyUid)?.find(s => s.series_uid === b.seriesUid);
      const seriesDesc = series?.series_description || 'Unknown Series';
      const date = new Date(b.createdAt).toLocaleTimeString();
      return `
        <div class="bookmark-item" data-bookmark="${b.id}">
          <div class="bookmark-header">
            <span class="bookmark-jump" data-jump="${b.id}" title="Jump to bookmark">🔖 Slice ${b.instanceIndex + 1}</span>
            <span class="bookmark-delete" data-del-bookmark="${b.id}" title="Delete bookmark">✕</span>
          </div>
          <div class="bookmark-series">${seriesDesc}</div>
          <div class="bookmark-note-container">
            <input type="text" class="bookmark-note-input" data-note="${b.id}" value="${b.note.replace(/"/g, '&quot;')}" placeholder="Add note (max 100 chars)" maxlength="100">
          </div>
          <div class="bookmark-time">${date} · WW:${b.windowWidth.toFixed(0)} WL:${b.windowCenter.toFixed(0)}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="bookmarks-section">
        <div class="sidebar-header">
          Bookmarks (${studyBookmarks.length}/50)
        </div>
        <div class="bookmarks-list">
          ${studyBookmarks.length === 0
            ? '<div class="empty-bookmarks">No bookmarks yet. Click 🔖 in toolbar to add.</div>'
            : bookmarkItems}
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

    if (this.isComparisonMode) {
      const series = this.seriesMap.get(this.selectedStudyUid || '') || [];
      const seriesOptions = series.map(s => {
        const isLeft = s.series_uid === this.comparisonLeftSeriesUid;
        const isRight = s.series_uid === this.comparisonRightSeriesUid;
        return `<option value="${s.series_uid}" ${isLeft ? 'selected' : ''}>${s.series_description || s.series_uid}</option>`;
      }).join('');

      const seriesOptionsRight = series.map(s => {
        const isRight = s.series_uid === this.comparisonRightSeriesUid;
        return `<option value="${s.series_uid}" ${isRight ? 'selected' : ''}>${s.series_description || s.series_uid}</option>`;
      }).join('');

      return `
        <div class="viewer-area">
          <div class="comparison-view">
            <div class="comparison-cell">
              <div class="comparison-selector">
                <label>Left:</label>
                <select class="comparison-series-select" data-side="left">
                  ${seriesOptions}
                </select>
              </div>
              <div class="image-cell ${this.activeViewIndex === 0 ? 'active' : ''}" data-view="0">
                <canvas></canvas>
                <div class="overlay-info overlay-topleft"></div>
                <div class="overlay-info overlay-topright"></div>
                <div class="overlay-info overlay-bottomleft"></div>
                <div class="overlay-info overlay-bottomright"></div>
              </div>
            </div>
            <div class="comparison-divider"></div>
            <div class="comparison-cell">
              <div class="comparison-selector">
                <label>Right:</label>
                <select class="comparison-series-select" data-side="right">
                  ${seriesOptionsRight}
                </select>
              </div>
              <div class="image-cell ${this.activeViewIndex === 1 ? 'active' : ''}" data-view="1">
                <canvas></canvas>
                <div class="overlay-info overlay-topleft"></div>
                <div class="overlay-info overlay-topright"></div>
                <div class="overlay-info overlay-bottomleft"></div>
                <div class="overlay-info overlay-bottomright"></div>
              </div>
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

    const reportData = this.infoTab === 'report' ? this.generateReportData() : null;

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
      report: this.renderReportContent(reportData),
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
          <div class="info-tab ${this.infoTab === 'report' ? 'active' : ''}" data-tab="report">Report</div>
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
    document.getElementById('btn-export-series')?.addEventListener('click', () => this.exportSeriesAllSlices());
    document.getElementById('btn-mpr')?.addEventListener('click', () => this.toggleMprMode());
    document.getElementById('btn-save-template')?.addEventListener('click', () => {
      this.saveAnnotationTemplate();
      this.closeTemplateDropdown();
    });
    document.getElementById('btn-load-template')?.addEventListener('click', () => {
      this.loadAnnotationTemplate();
      this.closeTemplateDropdown();
    });
    document.getElementById('btn-template-menu')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleTemplateDropdown();
    });

    document.addEventListener('click', () => this.closeTemplateDropdown());
    document.getElementById('btn-anon-file')?.addEventListener('click', () => this.exportCurrentAnonymized());
    document.getElementById('btn-anon-study')?.addEventListener('click', () => this.exportStudyAnonymized());
    document.getElementById('btn-comparison')?.addEventListener('click', () => this.toggleComparisonMode());
    document.getElementById('btn-bookmark')?.addEventListener('click', () => {
      const note = prompt('Add bookmark note (optional, max 100 chars):', '') || '';
      this.addBookmark(note);
    });
    document.getElementById('btn-cancel-export')?.addEventListener('click', () => this.cancelExport());

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

    document.querySelectorAll('.comparison-series-select').forEach(el => {
      el.addEventListener('change', (e) => {
        const side = el.getAttribute('data-side') as 'left' | 'right';
        const seriesUid = (e.target as HTMLSelectElement).value;
        this.setComparisonSeries(side, seriesUid);
      });
    });

    document.querySelectorAll('[data-jump]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-jump')!;
        this.jumpToBookmark(id);
      });
    });
    document.querySelectorAll('[data-del-bookmark]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-del-bookmark')!;
        this.deleteBookmark(id);
      });
    });
    document.querySelectorAll('[data-note]').forEach(el => {
      el.addEventListener('change', (e) => {
        const id = el.getAttribute('data-note')!;
        const note = (e.target as HTMLInputElement).value;
        this.updateBookmarkNote(id, note);
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
      canvas.addEventListener('mouseleave', (e) => {
        if (this.currentTool === 'probe') {
          this.clearProbeInfo();
          this.renderProbeTooltip();
        } else {
          this.handleCanvasMouseUp(viewIdx, e, canvas);
        }
      });
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
        this.clearProbeInfo();
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
        createdAt: Date.now(),
      });
    } else if (this.currentTool === 'arrow') {
      result.push({
        id: 'temp',
        type: 'arrow',
        start: this.tempPoints[0],
        end: this.tempPoints[1],
        text: '',
        color: this.annotationColor,
        createdAt: Date.now(),
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
        createdAt: Date.now(),
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
        createdAt: Date.now(),
      });
    } else if (this.currentTool === 'brush' && this.tempPoints.length > 1) {
      result.push({
        id: 'temp',
        type: 'brush',
        points: [...this.tempPoints],
        color: this.annotationColor,
        createdAt: Date.now(),
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
        createdAt: Date.now(),
      });
    }

    return result;
  }

  private getSeriesForView(viewIdx: number): SeriesInfo | null {
    const view = this.views[viewIdx];
    if (!view.studyUid) return null;
    const series = this.seriesMap.get(view.studyUid);
    return series?.find(s => s.series_uid === view.seriesUid) || null;
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
      const series = this.getSeriesForView(viewIdx);
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

  private async persistHistory() {
    if (!this.selectedStudyUid || this.historyMemoryOnly) return;
    const study = this.studies.find(s => s.study_uid === this.selectedStudyUid);
    if (!study?.directory_path) return;

    const historyPath = `${study.directory_path}/.dicom_history.json`;
    this.historyFilePath = historyPath;

    try {
      const serialized = this.history.map(h => ({
        id: h.id,
        action: h.action,
        timestamp: h.timestamp,
        annotationIds: h.annotationIds,
        annotationsSnapshot: h.annotationsSnapshot,
        viewKey: h.viewKey,
        summary: h.summary,
      }));
      await dicomApi.saveHistoryFile(serialized, historyPath);
    } catch (e) {
      console.error('Failed to persist history:', e);
    }
  }

  private async loadHistoryFromStudy() {
    this.history = [];
    this.historyMemoryOnly = false;
    this.historyFilePath = null;

    if (!this.selectedStudyUid) return;
    const study = this.studies.find(s => s.study_uid === this.selectedStudyUid);
    if (!study?.directory_path) {
      this.historyMemoryOnly = true;
      return;
    }

    const historyPath = `${study.directory_path}/.dicom_history.json`;
    this.historyFilePath = historyPath;

    try {
      const writable = await dicomApi.checkDirWritable(study.directory_path);
      if (!writable) {
        this.historyMemoryOnly = true;
        return;
      }

      const data = await dicomApi.loadHistoryFile(historyPath) as PersistedHistoryRecord[];
      if (Array.isArray(data)) {
        this.history = data.map(h => ({
          id: h.id,
          action: h.action as HistoryActionType,
          timestamp: h.timestamp,
          annotationIds: h.annotationIds,
          annotationsSnapshot: h.annotationsSnapshot,
          viewKey: h.viewKey,
          summary: h.summary,
        }));
      }
    } catch (e) {
      this.history = [];
    }
  }

  private refreshReportIfVisible() {
    if (this.infoTab !== 'report') return;
    const infoContent = document.querySelector('.info-content');
    if (!infoContent) return;
    const reportData = this.generateReportData();
    infoContent.innerHTML = this.renderReportContent(reportData);
    this.bindReportEvents();
    this.drawTrendChartIfNeeded();
  }

  private getSeriesWithAnnotations(): { uid: string; description: string }[] {
    if (!this.selectedStudyUid) return [];
    const series = this.seriesMap.get(this.selectedStudyUid) || [];
    const result: { uid: string; description: string }[] = [];
    for (const s of series) {
      const prefix = `${this.selectedStudyUid}||${s.series_uid}||`;
      const hasAnnotations = Array.from(this.annotations.keys()).some(k =>
        k.startsWith(prefix) && (this.annotations.get(k)?.length ?? 0) > 0
      );
      if (hasAnnotations) {
        result.push({ uid: s.series_uid, description: s.series_description || s.series_uid });
      }
    }
    return result;
  }

  private computeComparisonTable(): ComparisonRow[] {
    const rows: ComparisonRow[] = [];
    const types: { key: MeasurementType; label: string }[] = [
      { key: 'line', label: '距离' },
      { key: 'angle', label: '角度' },
      { key: 'rect_roi', label: 'ROI面积' },
    ];

    for (const t of types) {
      const statsA = this.computeStatsForSeries(this.comparisonSeriesA, t.key);
      const statsB = this.computeStatsForSeries(this.comparisonSeriesB, t.key);
      rows.push({ measurementType: t.label, seriesA: statsA, seriesB: statsB });
    }

    if (this.comparisonSeriesA || this.comparisonSeriesB) {
      const ellipseStatsA = this.computeStatsForSeries(this.comparisonSeriesA, 'ellipse_roi');
      const ellipseStatsB = this.computeStatsForSeries(this.comparisonSeriesB, 'ellipse_roi');
      rows.push({ measurementType: '椭圆ROI面积', seriesA: ellipseStatsA, seriesB: ellipseStatsB });
    }

    return rows;
  }

  private computeStatsForSeries(seriesUid: string | null, type: MeasurementType): ComparisonStats {
    if (!seriesUid || !this.selectedStudyUid) {
      return this.naStats();
    }

    const prefix = `${this.selectedStudyUid}||${seriesUid}||`;
    const values: number[] = [];

    for (const key of this.annotations.keys()) {
      if (!key.startsWith(prefix)) continue;
      const anns = this.annotations.get(key) || [];
      for (const ann of anns) {
        if (ann.type === type) {
          if (type === 'line' && ann.type === 'line') values.push((ann as LineMeasurement).distance);
          else if (type === 'angle' && ann.type === 'angle') values.push((ann as AngleMeasurement).angle);
          else if ((type === 'rect_roi' && ann.type === 'rect_roi') || (type === 'ellipse_roi' && ann.type === 'ellipse_roi')) values.push((ann as RectRoiMeasurement).area);
        }
      }
    }

    if (values.length === 0) return this.naStats();

    const max = Math.max(...values);
    const min = Math.min(...values);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);

    return { max, min, mean, std, count: values.length };
  }

  private naStats(): ComparisonStats {
    return { max: 'N/A', min: 'N/A', mean: 'N/A', std: 'N/A', count: 'N/A' };
  }

  private computeTrendData(seriesUid: string | null): TrendDataPoint[] {
    if (!seriesUid || !this.selectedStudyUid) return [];

    const prefix = `${this.selectedStudyUid}||${seriesUid}||`;
    const sliceMap = new Map<number, number[]>();

    for (const key of this.annotations.keys()) {
      if (!key.startsWith(prefix)) continue;
      const suffix = key.slice(prefix.length);
      const parts = suffix.split('||');
      const instanceIndex = parseInt(parts[0]) || 0;

      const anns = this.annotations.get(key) || [];
      for (const ann of anns) {
        if (ann.type === 'line') {
          if (!sliceMap.has(instanceIndex)) sliceMap.set(instanceIndex, []);
          sliceMap.get(instanceIndex)!.push(ann.distance);
        }
      }
    }

    const points: TrendDataPoint[] = [];
    const indices = Array.from(sliceMap.keys()).sort((a, b) => a - b);
    for (const idx of indices) {
      const vals = sliceMap.get(idx)!;
      const meanVal = vals.reduce((a, b) => a + b, 0) / vals.length;
      points.push({ sliceIndex: idx + 1, meanValue: meanVal, count: vals.length });
    }

    return points;
  }

  private renderReportContent(reportData: ReportData | null): string {
    if (!reportData) {
      return `<div class="empty-state" style="padding: 40px 20px;"><p>No study loaded</p></div>`;
    }

    let seriesHtml = '';
    for (const group of reportData.seriesGroups) {
      let measurementsHtml = '';
      for (const m of group.measurements) {
        const typeMap: Record<string, string> = {
          line: '📏 Distance',
          angle: '📐 Angle',
          rect_roi: '⬛ Rect ROI',
          ellipse_roi: '⚫ Ellipse ROI',
        };
        measurementsHtml += `
          <div class="report-measurement-item">
            <div class="report-measurement-type">${typeMap[m.type] || m.type}</div>
            <div class="report-measurement-value">${m.value.toFixed(2)} ${m.unit}</div>
            <div class="report-measurement-meta">
              Slice ${m.instanceIndex + 1} · ${new Date(m.createdAt).toLocaleTimeString()}
            </div>
          </div>
        `;
      }
      seriesHtml += `
        <div class="report-series-group">
          <div class="report-series-header">
            <span class="report-series-name">${group.seriesDescription || 'Unknown Series'}</span>
            <span class="report-series-count">${group.measurements.length} items</span>
          </div>
          <div class="report-measurements-list">
            ${measurementsHtml}
          </div>
        </div>
      `;
    }

    if (reportData.seriesGroups.length === 0) {
      seriesHtml = `<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 12px;">No measurements found</div>`;
    }

    const historyHtml = this.history.slice(0, 100).map((h, idx) => {
      const actionIcon = h.action === 'add' ? '➕' : h.action === 'delete' ? '🗑️' : '🧹';
      const actionText = h.action === 'add' ? 'Add' : h.action === 'delete' ? 'Delete' : 'Clear';
      return `
        <div class="history-item ${idx === 0 ? 'latest' : ''}">
          <div class="history-action">
            <span class="history-icon">${actionIcon}</span>
            <span class="history-action-text">${actionText}</span>
          </div>
          <div class="history-summary" title="${h.summary}">${h.summary}</div>
          <div class="history-time">${new Date(h.timestamp).toLocaleTimeString()}</div>
          <button class="history-undo-btn" data-undo="${h.id}" ${idx !== 0 ? 'disabled' : ''} title="${idx !== 0 ? '只能撤销最近的操作' : 'Undo'}">
            ↩️
          </button>
        </div>
      `;
    }).join('');

    const seriesWithAnnotations = this.getSeriesWithAnnotations();
    const comparisonOptions = seriesWithAnnotations.map(s => {
      const isDisabled = s.uid === this.comparisonSeriesB && s.uid !== this.comparisonSeriesA;
      return `<option value="${s.uid}" ${s.uid === this.comparisonSeriesA ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}>${s.description}${isDisabled ? ' (已在B中选择)' : ''}</option>`;
    }).join('');
    const comparisonOptionsB = seriesWithAnnotations.map(s => {
      const isDisabled = s.uid === this.comparisonSeriesA && s.uid !== this.comparisonSeriesB;
      return `<option value="${s.uid}" ${s.uid === this.comparisonSeriesB ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}>${s.description}${isDisabled ? ' (已在A中选择)' : ''}</option>`;
    }).join('');

    let comparisonTableHtml = '';
    if (this.showComparisonPanel && (this.comparisonSeriesA || this.comparisonSeriesB)) {
      const rows = this.computeComparisonTable();
      const formatVal = (v: number | string) => typeof v === 'number' ? v.toFixed(2) : v;
      comparisonTableHtml = `
        <table class="comparison-table">
          <thead>
            <tr>
              <th>测量类型</th>
              <th colspan="5">${seriesWithAnnotations.find(s => s.uid === this.comparisonSeriesA)?.description || 'Series A'}</th>
              <th colspan="5">${seriesWithAnnotations.find(s => s.uid === this.comparisonSeriesB)?.description || 'Series B'}</th>
            </tr>
            <tr>
              <th></th>
              <th>最大值</th><th>最小值</th><th>平均值</th><th>标准差</th><th>条数</th>
              <th>最大值</th><th>最小值</th><th>平均值</th><th>标准差</th><th>条数</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td class="comparison-type-cell">${r.measurementType}</td>
                <td>${formatVal(r.seriesA.max)}</td>
                <td>${formatVal(r.seriesA.min)}</td>
                <td>${formatVal(r.seriesA.mean)}</td>
                <td>${formatVal(r.seriesA.std)}</td>
                <td>${formatVal(r.seriesA.count)}</td>
                <td>${formatVal(r.seriesB.max)}</td>
                <td>${formatVal(r.seriesB.min)}</td>
                <td>${formatVal(r.seriesB.mean)}</td>
                <td>${formatVal(r.seriesB.std)}</td>
                <td>${formatVal(r.seriesB.count)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    const trendSeriesOptions = seriesWithAnnotations.map(s =>
      `<option value="${s.uid}" ${s.uid === this.trendSeriesUid ? 'selected' : ''}>${s.description}</option>`
    ).join('');

    const trendData = this.computeTrendData(this.trendSeriesUid);
    const trendEmptyMsg = (this.trendSeriesUid && trendData.length === 0)
      ? '<div class="trend-empty">无距离测量数据</div>' : '';

    return `
      <div class="report-container">
        <div class="report-header">
          <h3>Measurement Report</h3>
          <button id="btn-export-pdf" class="export-pdf-btn" title="Export to PDF">
            📄 Export PDF
          </button>
        </div>

        ${this.historyMemoryOnly ? '<div class="history-memory-warning">当前Study的历史记录仅保存在内存中</div>' : ''}

        <div class="report-patient-info">
          <h4>Patient Information</h4>
          <div class="patient-info-grid">
            <div class="info-label">Name:</div>
            <div class="info-value">${reportData.patientName}</div>
            <div class="info-label">ID:</div>
            <div class="info-value">${reportData.patientId}</div>
            <div class="info-label">Date:</div>
            <div class="info-value">${reportData.studyDate}</div>
            <div class="info-label">Study:</div>
            <div class="info-value">${reportData.studyDescription || 'N/A'}</div>
          </div>
        </div>

        <div class="report-measurements-section">
          <h4>Measurements</h4>
          ${seriesHtml}
        </div>

        <div class="report-summary">
          <div class="summary-item">
            <span class="summary-label">Distance:</span>
            <span class="summary-value">${reportData.totalDistance}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Angle:</span>
            <span class="summary-value">${reportData.totalAngle}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">ROI:</span>
            <span class="summary-value">${reportData.totalRoi}</span>
          </div>
          <div class="summary-item total">
            <span class="summary-label">Total:</span>
            <span class="summary-value">${reportData.totalDistance + reportData.totalAngle + reportData.totalRoi}</span>
          </div>
        </div>

        <div class="comparison-section">
          <div class="comparison-header" id="comparison-toggle">
            <h4>📊 测量对比分析</h4>
            <span class="history-toggle-icon">${this.showComparisonPanel ? '▼' : '▶'}</span>
          </div>
          ${this.showComparisonPanel ? `
            <div class="comparison-controls">
              <div class="comparison-select-row">
                <label>Series A:</label>
                <select id="comparison-series-a" class="comparison-select">
                  <option value="">-- 选择 --</option>
                  ${comparisonOptions}
                </select>
              </div>
              <div class="comparison-select-row">
                <label>Series B:</label>
                <select id="comparison-series-b" class="comparison-select">
                  <option value="">-- 选择 --</option>
                  ${comparisonOptionsB}
                </select>
              </div>
            </div>
            ${comparisonTableHtml}
          ` : ''}
        </div>

        <div class="trend-section">
          <div class="trend-header">
            <h4>📈 距离测量趋势图</h4>
            <select id="trend-series-select" class="comparison-select">
              <option value="">-- 选择Series --</option>
              ${trendSeriesOptions}
            </select>
          </div>
          ${trendEmptyMsg}
          <div class="trend-chart-container">
            <canvas id="trend-chart-canvas" height="200"></canvas>
          </div>
        </div>

        <div class="history-section">
          <div class="history-header" id="history-toggle">
            <h4>📜 Measurement History (${this.history.length}/100)</h4>
            <span class="history-toggle-icon">${this.showHistoryPanel ? '▼' : '▶'}</span>
          </div>
          ${this.showHistoryPanel ? `
            <div class="history-list">
              ${this.history.length === 0
                ? '<div style="padding: 16px; text-align: center; color: var(--text-secondary); font-size: 11px;">No history</div>'
                : historyHtml
              }
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  private bindReportEvents() {
    document.getElementById('btn-export-pdf')?.addEventListener('click', () => this.exportReportToPdf());
    document.getElementById('history-toggle')?.addEventListener('click', () => {
      this.toggleHistoryPanel();
    });
    document.getElementById('comparison-toggle')?.addEventListener('click', () => {
      this.showComparisonPanel = !this.showComparisonPanel;
      this.refreshReportIfVisible();
    });
    document.getElementById('comparison-series-a')?.addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value || null;
      if (value && value === this.comparisonSeriesB) {
        alert('不能选择与 Series B 相同的 Series');
        (e.target as HTMLSelectElement).value = this.comparisonSeriesA || '';
        return;
      }
      this.comparisonSeriesA = value;
      this.refreshReportIfVisible();
    });
    document.getElementById('comparison-series-b')?.addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value || null;
      if (value && value === this.comparisonSeriesA) {
        alert('不能选择与 Series A 相同的 Series');
        (e.target as HTMLSelectElement).value = this.comparisonSeriesB || '';
        return;
      }
      this.comparisonSeriesB = value;
      this.refreshReportIfVisible();
    });
    document.getElementById('trend-series-select')?.addEventListener('change', (e) => {
      this.trendSeriesUid = (e.target as HTMLSelectElement).value || null;
      this.refreshReportIfVisible();
    });
    document.querySelectorAll('[data-undo]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-undo')!;
        this.undoHistoryRecord(id);
      });
    });
  }

  private getCssVariable(varName: string, fallback: string): string {
    const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return val || fallback;
  }

  private drawTrendChartIfNeeded() {
    const canvas = document.getElementById('trend-chart-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    const data = this.computeTrendData(this.trendSeriesUid);
    if (data.length === 0) return;

    const container = canvas.parentElement;
    if (!container) return;

    canvas.width = container.clientWidth;
    canvas.height = 200;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const padding = { top: 20, right: 30, bottom: 30, left: 50 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    const bgColor = this.getCssVariable('--bg-secondary', '#16213e');
    const lineColor = this.getCssVariable('--border', '#2a2a4a');
    const textColor = this.getCssVariable('--text-secondary', '#a0a0a0');
    const accentColor = this.getCssVariable('--accent', '#e94560');

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    const values = data.map(d => d.meanValue);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const valRange = maxVal - minVal || 1;
    const valMin = minVal - valRange * 0.1;
    const valMax = maxVal + valRange * 0.1;
    const totalRange = valMax - valMin;

    const maxSlice = Math.max(...data.map(d => d.sliceIndex));
    const minSlice = Math.min(...data.map(d => d.sliceIndex));
    const sliceRange = maxSlice - minSlice || 1;

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const y = padding.top + (chartH / yTicks) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();

      const val = valMax - (totalRange / yTicks) * i;
      ctx.fillStyle = textColor;
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(1), padding.left - 5, y + 3);
    }

    const xTicks = Math.min(data.length, 10);
    for (let i = 0; i <= xTicks; i++) {
      const x = padding.left + (chartW / xTicks) * i;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, h - padding.bottom);
      ctx.stroke();

      const sliceVal = minSlice + (sliceRange / xTicks) * i;
      ctx.fillStyle = textColor;
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(Math.round(sliceVal).toString(), x, h - padding.bottom + 15);
    }

    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = padding.left + ((data[i].sliceIndex - minSlice) / sliceRange) * chartW;
      const y = padding.top + ((valMax - data[i].meanValue) / totalRange) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    for (let i = 0; i < data.length; i++) {
      const x = padding.left + ((data[i].sliceIndex - minSlice) / sliceRange) * chartW;
      const y = padding.top + ((valMax - data[i].meanValue) / totalRange) * chartH;
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = textColor;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('层号', w / 2, h - 2);
    ctx.save();
    ctx.translate(12, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('mm', 0, 0);
    ctx.restore();

    if (this.trendMouseMoveHandler) {
      canvas.removeEventListener('mousemove', this.trendMouseMoveHandler);
    }
    if (this.trendMouseLeaveHandler) {
      canvas.removeEventListener('mouseleave', this.trendMouseLeaveHandler);
    }

    this.trendMouseMoveHandler = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      let closestIdx = -1;
      let closestDist = Infinity;
      for (let i = 0; i < data.length; i++) {
        const x = padding.left + ((data[i].sliceIndex - minSlice) / sliceRange) * chartW;
        const y = padding.top + ((valMax - data[i].meanValue) / totalRange) * chartH;
        const dist = Math.hypot(mx - x, my - y);
        if (dist < closestDist && dist < 20) {
          closestDist = dist;
          closestIdx = i;
        }
      }

      const tooltip = document.getElementById('trend-tooltip');
      if (!tooltip) return;

      if (closestIdx >= 0) {
        const d = data[closestIdx];
        tooltip.style.display = 'block';
        tooltip.innerHTML = `层号: ${d.sliceIndex}<br>均值: ${d.meanValue.toFixed(2)} mm<br>条数: ${d.count}`;
        tooltip.style.left = (e.clientX - rect.left + 15) + 'px';
        tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
      } else {
        tooltip.style.display = 'none';
      }
    };

    this.trendMouseLeaveHandler = () => {
      const tooltip = document.getElementById('trend-tooltip');
      if (tooltip) tooltip.style.display = 'none';
    };

    canvas.addEventListener('mousemove', this.trendMouseMoveHandler);
    canvas.addEventListener('mouseleave', this.trendMouseLeaveHandler);
  }
}

const app = new DicomViewerApp();
(window as any).app = app;
app.init();
