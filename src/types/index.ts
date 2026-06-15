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
}

export interface AngleMeasurement {
  id: string;
  type: 'angle';
  points: [Point, Point, Point];
  angle: number;
  color: AnnotationColor;
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
}

export interface ArrowAnnotation {
  id: string;
  type: 'arrow';
  start: Point;
  end: Point;
  text: string;
  color: AnnotationColor;
}

export interface TextAnnotation {
  id: string;
  type: 'text';
  position: Point;
  text: string;
  color: AnnotationColor;
}

export interface BrushAnnotation {
  id: string;
  type: 'brush';
  points: Point[];
  color: AnnotationColor;
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
