export interface PatientInfo {
  name: string;
  id: string;
  birth_date: string;
}

export interface StudyInfo {
  study_uid: string;
  study_date: string;
  study_description: string;
  modality: string;
  institution: string;
  patient: PatientInfo;
  directory_path: string | null;
}

export interface SeriesInfo {
  series_uid: string;
  series_description: string;
  series_number: number;
  modality: string;
  instance_count: number;
  thumbnail: number[] | null;
  is_multiframe: boolean;
  number_of_frames: number;
  frame_time: number | null;
}

export interface DicomTag {
  group: number;
  element: number;
  vr: string;
  value: string;
  name: string;
  is_private: boolean;
  is_sequence: boolean;
  children: DicomTag[] | null;
}

export interface PixelDataResponse {
  width: number;
  height: number;
  frames: number;
  pixels: number[];
  photometric_interpretation: string;
  rescale_slope: number;
  rescale_intercept: number;
  default_window_width: number | null;
  default_window_center: number | null;
  pixel_spacing: [number, number] | null;
  slice_thickness: number | null;
  slice_location: number | null;
  image_position_patient: [number, number, number] | null;
  image_orientation_patient: [number, number, number, number, number, number] | null;
  total_slices: number;
  min_pixel_value: number;
  max_pixel_value: number;
}

export interface WindowPreset {
  name: string;
  modality: string;
  window_width: number;
  window_center: number;
}

export interface MprEligibilityResult {
  eligible: boolean;
  reason: string | null;
  slice_count: number;
  is_constant_spacing: boolean;
  spacing_mean: number | null;
  spacing_std: number | null;
}

export interface MprSliceData {
  orientation: string;
  width: number;
  height: number;
  pixels: number[];
  position: number;
  total_slices: number;
  pixel_spacing_x: number;
  pixel_spacing_y: number;
}

export interface MprVolumeInfo {
  axial_width: number;
  axial_height: number;
  axial_slices: number;
  sagittal_width: number;
  sagittal_height: number;
  sagittal_slices: number;
  coronal_width: number;
  coronal_height: number;
  coronal_slices: number;
  voxel_spacing: [number, number, number];
}

export type ToolType = 'none' | 'pan' | 'zoom' | 'window' | 'line' | 'angle' | 'rect_roi' | 'ellipse_roi' | 'arrow' | 'text' | 'brush' | 'probe';

export interface Bookmark {
  id: string;
  studyUid: string;
  seriesUid: string;
  instanceIndex: number;
  frameIndex: number;
  windowWidth: number;
  windowCenter: number;
  zoom: number;
  panX: number;
  panY: number;
  note: string;
  createdAt: number;
}

export interface PixelProbeInfo {
  x: number;
  y: number;
  rawValue: number;
  huValue: number | null;
  mappedValue: number;
}

export interface ExportProgress {
  current: number;
  total: number;
  cancelled: boolean;
}

export type LayoutType = '1x1' | '1x2' | '2x2' | '3x3' | 'comparison';

export type AnnotationColor = 'red' | 'yellow' | 'green' | 'blue';

export interface Point {
  x: number;
  y: number;
}

export interface LineMeasurement {
  id: string;
  type: 'line';
  start: Point;
  end: Point;
  distance: number;
  color: AnnotationColor;
  createdAt: number;
}

export interface AngleMeasurement {
  id: string;
  type: 'angle';
  points: [Point, Point, Point];
  angle: number;
  color: AnnotationColor;
  createdAt: number;
}

export interface RectRoiMeasurement {
  id: string;
  type: 'rect_roi';
  x: number;
  y: number;
  width: number;
  height: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  area: number;
  color: AnnotationColor;
  createdAt: number;
}

export interface EllipseRoiMeasurement {
  id: string;
  type: 'ellipse_roi';
  x: number;
  y: number;
  width: number;
  height: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  area: number;
  color: AnnotationColor;
  createdAt: number;
}

export interface ArrowAnnotation {
  id: string;
  type: 'arrow';
  start: Point;
  end: Point;
  text: string;
  color: AnnotationColor;
  createdAt: number;
}

export interface TextAnnotation {
  id: string;
  type: 'text';
  position: Point;
  text: string;
  color: AnnotationColor;
  createdAt: number;
}

export interface BrushAnnotation {
  id: string;
  type: 'brush';
  points: Point[];
  color: AnnotationColor;
  createdAt: number;
}

export type Annotation =
  | LineMeasurement
  | AngleMeasurement
  | RectRoiMeasurement
  | EllipseRoiMeasurement
  | ArrowAnnotation
  | TextAnnotation
  | BrushAnnotation;

export interface ViewState {
  studyUid: string | null;
  seriesUid: string | null;
  instanceIndex: number;
  frameIndex: number;
  windowWidth: number;
  windowCenter: number;
  invert: boolean;
  zoom: number;
  panX: number;
  panY: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export type MeasurementType = 'line' | 'angle' | 'rect_roi' | 'ellipse_roi';

export interface MeasurementRecord {
  id: string;
  type: MeasurementType;
  value: number;
  unit: string;
  seriesUid: string;
  seriesDescription: string;
  instanceIndex: number;
  createdAt: number;
  annotation: Annotation;
}

export interface ReportSeriesGroup {
  seriesUid: string;
  seriesDescription: string;
  measurements: MeasurementRecord[];
}

export interface ReportData {
  patientName: string;
  patientId: string;
  studyDate: string;
  studyDescription: string;
  seriesGroups: ReportSeriesGroup[];
  totalDistance: number;
  totalAngle: number;
  totalRoi: number;
}

export type HistoryActionType = 'add' | 'delete' | 'clear';

export interface HistoryRecord {
  id: string;
  action: HistoryActionType;
  timestamp: number;
  annotationIds: string[];
  annotationsSnapshot: Annotation[];
  viewKey: string;
  summary: string;
}

export interface AnnotationTemplate {
  version: string;
  imageSize: { width: number; height: number };
  seriesDescription: string;
  createdAt: number;
  annotations: Annotation[];
}

export interface ComparisonStats {
  max: number | string;
  min: number | string;
  mean: number | string;
  std: number | string;
  count: number | string;
}

export interface ComparisonRow {
  measurementType: string;
  seriesA: ComparisonStats;
  seriesB: ComparisonStats;
}

export interface TrendDataPoint {
  sliceIndex: number;
  meanValue: number;
  count: number;
}

export interface PersistedHistoryRecord {
  id: string;
  action: HistoryActionType;
  timestamp: number;
  annotationIds: string[];
  annotationsSnapshot: Annotation[];
  viewKey: string;
  summary: string;
}

export interface VolumeRenderData {
  compressed_data: number[];
  width: number;
  height: number;
  depth: number;
  voxel_size_x: number;
  voxel_size_y: number;
  voxel_size_z: number;
  min_hu: number;
  max_hu: number;
}

export interface TransferFunctionControlPoint {
  hu: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

export type ClippingAxis = 'axial' | 'sagittal' | 'coronal';
