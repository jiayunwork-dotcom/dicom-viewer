import { invoke } from '@tauri-apps/api/tauri';
import { open as openDialog, save as saveDialog } from '@tauri-apps/api/dialog';
import type {
  StudyInfo,
  SeriesInfo,
  DicomTag,
  PixelDataResponse,
  WindowPreset,
  MprEligibilityResult,
  MprSliceData,
  MprVolumeInfo,
  Bookmark,
  VolumeRenderData,
} from '../types';

export const dicomApi = {
  async openDicomFile(): Promise<string | null> {
    const selected = await openDialog({
      multiple: false,
      filters: [{
        name: 'DICOM Files',
        extensions: ['dcm', 'dcm', '']
      }]
    });
    if (!selected) return null;
    const path = Array.isArray(selected) ? selected[0] : selected;
    return invoke<string>('open_dicom_file', { path });
  },

  async openDicomDirectory(): Promise<string[] | null> {
    const selected = await openDialog({
      directory: true,
      multiple: false,
    });
    if (!selected) return null;
    const path = Array.isArray(selected) ? selected[0] : selected;
    return invoke<string[]>('open_dicom_directory', { path });
  },

  async getStudies(): Promise<StudyInfo[]> {
    return invoke<StudyInfo[]>('get_studies');
  },

  async getSeriesInfo(studyUid: string): Promise<SeriesInfo[]> {
    return invoke<SeriesInfo[]>('get_series_info', { studyUid });
  },

  async getInstancePixelData(
    studyUid: string,
    seriesUid: string,
    instanceIndex: number,
    frameIndex: number
  ): Promise<PixelDataResponse> {
    return invoke<PixelDataResponse>('get_instance_pixel_data', {
      studyUid,
      seriesUid,
      instanceIndex,
      frameIndex,
    });
  },

  async getDicomTags(
    studyUid: string,
    seriesUid: string,
    instanceIndex: number
  ): Promise<DicomTag[]> {
    return invoke<DicomTag[]>('get_dicom_tags', {
      studyUid,
      seriesUid,
      instanceIndex,
    });
  },

  async getSeriesThumbnail(
    studyUid: string,
    seriesUid: string
  ): Promise<number[]> {
    return invoke<number[]>('get_series_thumbnail', { studyUid, seriesUid });
  },

  async applyWindowLevel(
    pixels: number[],
    width: number,
    height: number,
    windowWidth: number,
    windowCenter: number,
    photometricInterpretation: string,
    invert: boolean
  ): Promise<number[]> {
    return invoke<number[]>('apply_window_level', {
      pixels,
      width,
      height,
      windowWidth,
      windowCenter,
      photometricInterpretation,
      invert,
    });
  },

  async getWindowPresets(): Promise<WindowPreset[]> {
    return invoke<WindowPreset[]>('get_available_window_presets');
  },

  async checkMprEligibility(
    studyUid: string,
    seriesUid: string
  ): Promise<MprEligibilityResult> {
    return invoke<MprEligibilityResult>('check_mpr_eligibility', { studyUid, seriesUid });
  },

  async generateMprSlices(
    studyUid: string,
    seriesUid: string,
    axialIndex: number,
    sagittalIndex: number,
    coronalIndex: number
  ): Promise<[MprSliceData, MprSliceData, MprSliceData, MprVolumeInfo]> {
    return invoke<[MprSliceData, MprSliceData, MprSliceData, MprVolumeInfo]>('generate_mpr_slices', {
      studyUid,
      seriesUid,
      axialIndex,
      sagittalIndex,
      coronalIndex,
    });
  },

  async buildVolumeRendering(
    studyUid: string,
    seriesUid: string
  ): Promise<VolumeRenderData> {
    return invoke<VolumeRenderData>('build_volume_rendering', { studyUid, seriesUid });
  },

  async anonymizeDicomFile(inputPath: string, outputPath: string): Promise<void> {
    return invoke<void>('anonymize_dicom_file', { inputPath, outputPath });
  },

  async anonymizeStudy(studyUid: string, outputDir: string): Promise<string[]> {
    return invoke<string[]>('anonymize_study', { studyUid, outputDir });
  },

  async exportScreenshot(
    imageData: number[],
    width: number,
    height: number,
    path: string,
    format: 'png' | 'jpeg'
  ): Promise<void> {
    return invoke<void>('export_screenshot', {
      imageData,
      width,
      height,
      path,
      format,
    });
  },

  async exportAnnotations(annotations: unknown, path: string): Promise<void> {
    return invoke<void>('export_annotations', { annotations, path });
  },

  async loadAnnotations(path: string): Promise<unknown> {
    return invoke<unknown>('load_annotations', { path });
  },

  async showSaveDialog(defaultName: string, filters: { name: string; extensions: string[] }[]): Promise<string | null> {
    return saveDialog({
      defaultPath: defaultName,
      filters,
    }) as Promise<string | null>;
  },

  async showOpenDirectoryDialog(): Promise<string | null> {
    const selected = await openDialog({
      directory: true,
      multiple: false,
    });
    if (!selected) return null;
    return Array.isArray(selected) ? selected[0] : selected;
  },

  async saveBookmarks(bookmarks: Bookmark[], path: string): Promise<void> {
    return invoke<void>('save_bookmarks', { bookmarks, path });
  },

  async loadBookmarks(path: string): Promise<Bookmark[]> {
    return invoke<Bookmark[]>('load_bookmarks', { path });
  },

  async saveHistoryFile(history: unknown, path: string): Promise<void> {
    return invoke<void>('save_history_file', { history, path });
  },

  async loadHistoryFile(path: string): Promise<unknown> {
    return invoke<unknown>('load_history_file', { path });
  },

  async checkDirWritable(dirPath: string): Promise<boolean> {
    return invoke<boolean>('check_dir_writable', { dirPath });
  },
};
