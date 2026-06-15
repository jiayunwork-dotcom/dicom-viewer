use serde::{Deserialize, Serialize};
use crate::dicom;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

lazy_static::lazy_static! {
    static ref VOLUME_CACHE: Mutex<HashMap<String, CachedVolume>> = Mutex::new(HashMap::new());
}

#[derive(Clone)]
struct CachedVolume {
    pub volume: Vec<Vec<Vec<f32>>>,
    pub width: u32,
    pub height: u32,
    pub depth: u32,
    pub min_val: f32,
    pub max_val: f32,
    pub last_used: std::time::Instant,
}

fn cache_key(study_uid: &str, series_uid: &str) -> String {
    format!("{}|{}", study_uid, series_uid)
}

fn prune_cache() {
    let mut cache = VOLUME_CACHE.lock().unwrap();
    if cache.len() > 3 {
        let mut keys: Vec<String> = cache.keys().cloned().collect();
        keys.sort_by(|a, b| cache[a].last_used.cmp(&cache[b].last_used));
        while cache.len() > 3 && !keys.is_empty() {
            let k = keys.remove(0);
            cache.remove(&k);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MprEligibilityResult {
    pub eligible: bool,
    pub reason: Option<String>,
    pub slice_count: u32,
    pub is_constant_spacing: bool,
    pub spacing_mean: Option<f64>,
    pub spacing_std: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MprSliceData {
    pub orientation: String,
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<f64>,
    pub position: f64,
    pub total_slices: u32,
    pub pixel_spacing_x: f64,
    pub pixel_spacing_y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MprVolumeInfo {
    pub axial_width: u32,
    pub axial_height: u32,
    pub axial_slices: u32,
    pub sagittal_width: u32,
    pub sagittal_height: u32,
    pub sagittal_slices: u32,
    pub coronal_width: u32,
    pub coronal_height: u32,
    pub coronal_slices: u32,
    pub voxel_spacing: (f64, f64, f64),
}

#[derive(Debug, Clone)]
struct VolumeData {
    pixels: Vec<Vec<Vec<f64>>>,
    voxel_spacing: (f64, f64, f64),
    dims: (u32, u32, u32),
}

#[tauri::command]
pub fn check_mpr_eligibility(
    state: tauri::State<std::sync::Mutex<crate::AppState>>,
    study_uid: String,
    series_uid: String,
) -> Result<MprEligibilityResult, String> {
    let state = state.lock().unwrap();
    let study = state.studies.get(&study_uid).ok_or("Study not found")?;
    let series = study.series.get(&series_uid).ok_or("Series not found")?;

    if series.instances.len() < 3 {
        return Ok(MprEligibilityResult {
            eligible: false,
            reason: Some("Need at least 3 slices for MPR".to_string()),
            slice_count: series.instances.len() as u32,
            is_constant_spacing: false,
            spacing_mean: None,
            spacing_std: None,
        });
    }

    let positions: Vec<(f64, f64, f64)> = series.instances
        .iter()
        .filter_map(|inst| inst.info.image_position_patient)
        .collect();

    if positions.len() < 3 {
        return Ok(MprEligibilityResult {
            eligible: false,
            reason: Some("Missing Image Position Patient tags".to_string()),
            slice_count: series.instances.len() as u32,
            is_constant_spacing: false,
            spacing_mean: None,
            spacing_std: None,
        });
    }

    let mut spacings = Vec::new();
    for i in 1..positions.len() {
        let dx = positions[i].0 - positions[i - 1].0;
        let dy = positions[i].1 - positions[i - 1].1;
        let dz = positions[i].2 - positions[i - 1].2;
        let dist = (dx * dx + dy * dy + dz * dz).sqrt();
        spacings.push(dist);
    }

    let mean = spacings.iter().sum::<f64>() / spacings.len() as f64;
    let variance = spacings.iter()
        .map(|s| (s - mean).powi(2))
        .sum::<f64>() / spacings.len() as f64;
    let std = variance.sqrt();
    let cv = if mean > 0.0 { std / mean } else { 1.0 };

    let is_constant = cv < 0.05;

    Ok(MprEligibilityResult {
        eligible: is_constant,
        reason: if !is_constant { Some("Non-uniform slice spacing detected".to_string()) } else { None },
        slice_count: series.instances.len() as u32,
        is_constant_spacing: is_constant,
        spacing_mean: Some(mean),
        spacing_std: Some(std),
    })
}

fn load_volume(
    state: &tauri::State<std::sync::Mutex<crate::AppState>>,
    study_uid: &str,
    series_uid: &str,
) -> Result<VolumeData, String> {
    let key = cache_key(study_uid, series_uid);
    {
        let mut cache = VOLUME_CACHE.lock().unwrap();
        if let Some(mut cv) = cache.get_mut(&key) {
            cv.last_used = std::time::Instant::now();
            let volume_f32 = cv.volume.clone();
            let mut volume_f64: Vec<Vec<Vec<f64>>> = Vec::with_capacity(volume_f32.len());
            for z in 0..volume_f32.len() {
                let mut slice: Vec<Vec<f64>> = Vec::with_capacity(volume_f32[z].len());
                for y in 0..volume_f32[z].len() {
                    let mut row: Vec<f64> = Vec::with_capacity(volume_f32[z][y].len());
                    for x in 0..volume_f32[z][y].len() {
                        row.push(volume_f32[z][y][x] as f64);
                    }
                    slice.push(row);
                }
                volume_f64.push(slice);
            }
            return Ok(VolumeData {
                pixels: volume_f64,
                voxel_spacing: (1.0, 1.0, 1.0),
                dims: (cv.width, cv.height, cv.depth),
            });
        }
    }

    let state_lock = state.lock().unwrap();
    let study = state_lock.studies.get(study_uid).ok_or("Study not found")?;
    let series = study.series.get(series_uid).ok_or("Series not found")?;

    if series.instances.is_empty() {
        return Err("No instances in series".to_string());
    }

    let first = &series.instances[0];
    let width = first.info.columns as usize;
    let height = first.info.rows as usize;
    let depth = series.instances.len();

    let pixel_spacing = first.info.pixel_spacing.unwrap_or((1.0, 1.0));
    let slice_thickness = first.info.slice_thickness.unwrap_or(1.0);

    let mut volume_f32: Vec<Vec<Vec<f32>>> = Vec::with_capacity(depth);
    let mut volume_f64: Vec<Vec<Vec<f64>>> = Vec::with_capacity(depth);
    let mut min_val = f32::INFINITY;
    let mut max_val = f32::NEG_INFINITY;

    let instance_paths: Vec<String> = series.instances.iter().map(|i| i.file_path.clone()).collect();
    drop(state_lock);

    for file_path in &instance_paths {
        let pixel_data = dicom::extract_pixel_data(Path::new(file_path), 0)
            .map_err(|e| format!("Failed to load slice: {}", e))?;

        let mut slice_f32: Vec<Vec<f32>> = Vec::with_capacity(height);
        let mut slice_f64: Vec<Vec<f64>> = Vec::with_capacity(height);
        for y in 0..height {
            let mut row_f32: Vec<f32> = Vec::with_capacity(width);
            let mut row_f64: Vec<f64> = Vec::with_capacity(width);
            for x in 0..width {
                let idx = y * width + x;
                let v = pixel_data.pixels.get(idx).copied().unwrap_or(0.0);
                let vf = v as f32;
                if vf < min_val { min_val = vf; }
                if vf > max_val { max_val = vf; }
                row_f32.push(vf);
                row_f64.push(v);
            }
            slice_f32.push(row_f32);
            slice_f64.push(row_f64);
        }
        volume_f32.push(slice_f32);
        volume_f64.push(slice_f64);
    }

    prune_cache();
    let mut cache = VOLUME_CACHE.lock().unwrap();
    cache.insert(key, CachedVolume {
        volume: volume_f32,
        width: width as u32,
        height: height as u32,
        depth: depth as u32,
        min_val,
        max_val,
        last_used: std::time::Instant::now(),
    });

    Ok(VolumeData {
        pixels: volume_f64,
        voxel_spacing: (pixel_spacing.0, pixel_spacing.1, slice_thickness),
        dims: (width as u32, height as u32, depth as u32),
    })
}

fn bilinear_interpolation(volume: &VolumeData, x: f64, y: f64, z: f64) -> f64 {
    let (w, h, d) = (volume.dims.0 as usize, volume.dims.1 as usize, volume.dims.2 as usize);

    let x = x.max(0.0).min((w - 1) as f64);
    let y = y.max(0.0).min((h - 1) as f64);
    let z = z.max(0.0).min((d - 1) as f64);

    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let z0 = z.floor() as usize;
    let x1 = (x0 + 1).min(w - 1);
    let y1 = (y0 + 1).min(h - 1);
    let z1 = (z0 + 1).min(d - 1);

    let fx = x - x0 as f64;
    let fy = y - y0 as f64;
    let fz = z - z0 as f64;

    let v000 = volume.pixels[z0][y0][x0];
    let v100 = volume.pixels[z0][y0][x1];
    let v010 = volume.pixels[z0][y1][x0];
    let v110 = volume.pixels[z0][y1][x1];
    let v001 = volume.pixels[z1][y0][x0];
    let v101 = volume.pixels[z1][y0][x1];
    let v011 = volume.pixels[z1][y1][x0];
    let v111 = volume.pixels[z1][y1][x1];

    let v00 = v000 * (1.0 - fx) + v100 * fx;
    let v10 = v010 * (1.0 - fx) + v110 * fx;
    let v01 = v001 * (1.0 - fx) + v101 * fx;
    let v11 = v011 * (1.0 - fx) + v111 * fx;

    let v0 = v00 * (1.0 - fy) + v10 * fy;
    let v1 = v01 * (1.0 - fy) + v11 * fy;

    v0 * (1.0 - fz) + v1 * fz
}

#[tauri::command]
pub fn generate_mpr_slices(
    state: tauri::State<std::sync::Mutex<crate::AppState>>,
    study_uid: String,
    series_uid: String,
    axial_index: u32,
    sagittal_index: u32,
    coronal_index: u32,
) -> Result<(MprSliceData, MprSliceData, MprSliceData, MprVolumeInfo), String> {
    let volume = load_volume(&state, &study_uid, &series_uid)?;

    let (w, h, d) = volume.dims;
    let (sx, sy, sz) = volume.voxel_spacing;

    let volume_info = MprVolumeInfo {
        axial_width: w,
        axial_height: h,
        axial_slices: d,
        sagittal_width: d,
        sagittal_height: h,
        sagittal_slices: w,
        coronal_width: w,
        coronal_height: d,
        coronal_slices: h,
        voxel_spacing: (sx, sy, sz),
    };

    let axial_z = axial_index.min(d - 1) as f64;
    let mut axial_pixels = Vec::with_capacity((w * h) as usize);
    for y in 0..h {
        for x in 0..w {
            axial_pixels.push(bilinear_interpolation(&volume, x as f64, y as f64, axial_z));
        }
    }

    let sagittal_x = sagittal_index.min(w - 1) as f64;
    let scale_y = sy / sz;
    let sag_height = h;
    let sag_width = ((d as f64) * sz / sx).round() as u32;
    let sag_width = sag_width.max(d);
    let mut sagittal_pixels = Vec::with_capacity((sag_width * sag_height) as usize);
    for y in 0..sag_height {
        for sx_out in 0..sag_width {
            let z = (sx_out as f64 / sag_width as f64) * (d - 1) as f64;
            sagittal_pixels.push(bilinear_interpolation(&volume, sagittal_x, y as f64, z));
        }
    }

    let coronal_y = coronal_index.min(h - 1) as f64;
    let cor_width = w;
    let cor_height = ((d as f64) * sz / sy).round() as u32;
    let cor_height = cor_height.max(d);
    let mut coronal_pixels = Vec::with_capacity((cor_width * cor_height) as usize);
    for cy_out in 0..cor_height {
        let z = (cy_out as f64 / cor_height as f64) * (d - 1) as f64;
        for x in 0..cor_width {
            coronal_pixels.push(bilinear_interpolation(&volume, x as f64, coronal_y, z));
        }
    }

    Ok((
        MprSliceData {
            orientation: "axial".to_string(),
            width: w,
            height: h,
            pixels: axial_pixels,
            position: axial_z,
            total_slices: d,
            pixel_spacing_x: sx,
            pixel_spacing_y: sy,
        },
        MprSliceData {
            orientation: "sagittal".to_string(),
            width: sag_width,
            height: sag_height,
            pixels: sagittal_pixels,
            position: sagittal_x,
            total_slices: w,
            pixel_spacing_x: sz,
            pixel_spacing_y: sy,
        },
        MprSliceData {
            orientation: "coronal".to_string(),
            width: cor_width,
            height: cor_height,
            pixels: coronal_pixels,
            position: coronal_y,
            total_slices: h,
            pixel_spacing_x: sx,
            pixel_spacing_y: sz,
        },
        volume_info,
    ))
}
