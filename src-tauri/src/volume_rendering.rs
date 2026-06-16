use serde::{Deserialize, Serialize};
use crate::dicom;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

lazy_static::lazy_static! {
    static ref VOLUME_RENDER_CACHE: Mutex<HashMap<String, CachedVolumeRender>> = Mutex::new(HashMap::new());
}

#[derive(Clone)]
struct CachedVolumeRender {
    pub voxel_data: Vec<u16>,
    pub width: u32,
    pub height: u32,
    pub depth: u32,
    pub voxel_spacing: (f64, f64, f64),
    pub last_used: std::time::Instant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeRenderData {
    pub compressed_data: String,
    pub width: u32,
    pub height: u32,
    pub depth: u32,
    pub voxel_size_x: f64,
    pub voxel_size_y: f64,
    pub voxel_size_z: f64,
    pub min_hu: f64,
    pub max_hu: f64,
}

fn cache_key(study_uid: &str, series_uid: &str) -> String {
    format!("{}|{}", study_uid, series_uid)
}

fn prune_cache() {
    let mut cache = VOLUME_RENDER_CACHE.lock().unwrap();
    if cache.len() > 5 {
        let mut keys: Vec<String> = cache.keys().cloned().collect();
        keys.sort_by(|a, b| cache[a].last_used.cmp(&cache[b].last_used));
        while cache.len() > 5 && !keys.is_empty() {
            let k = keys.remove(0);
            cache.remove(&k);
        }
    }
}

fn find_most_frequent_spacing(spacings: &[(f64, f64)]) -> (f64, f64) {
    let mut counts: HashMap<(u64, u64), usize> = HashMap::new();
    for &(x, y) in spacings {
        let key = ((x * 1000.0).round() as u64, (y * 1000.0).round() as u64);
        *counts.entry(key).or_insert(0) += 1;
    }
    let most_freq = counts
        .iter()
        .max_by_key(|&(_, count)| count)
        .map(|(k, _)| (k.0 as f64 / 1000.0, k.1 as f64 / 1000.0))
        .unwrap_or((1.0, 1.0));
    most_freq
}

fn get_slice_positions(instances: &[dicom::Instance]) -> Vec<f64> {
    let positions: Vec<f64> = instances
        .iter()
        .filter_map(|inst| inst.info.image_position_patient)
        .map(|(x, y, z)| {
            (x * x + y * y + z * z).sqrt()
        })
        .collect();
    
    if positions.len() >= 2 {
        return positions;
    }
    
    instances
        .iter()
        .enumerate()
        .map(|(i, inst)| {
            inst.info.slice_location.unwrap_or(i as f64)
        })
        .collect()
}

fn calculate_target_depth_and_spacing(
    positions: &[f64],
    slice_thickness: Option<f64>,
) -> (u32, f64) {
    if positions.len() < 2 {
        return (positions.len() as u32, slice_thickness.unwrap_or(1.0));
    }
    
    let mut spacings = Vec::new();
    for i in 1..positions.len() {
        spacings.push((positions[i] - positions[i - 1]).abs());
    }
    
    let mean_spacing = spacings.iter().sum::<f64>() / spacings.len() as f64;
    let variance = spacings.iter()
        .map(|s| (s - mean_spacing).powi(2))
        .sum::<f64>() / spacings.len() as f64;
    let std = variance.sqrt();
    let cv = if mean_spacing > 0.0 { std / mean_spacing } else { 1.0 };
    
    if cv < 0.05 {
        (positions.len() as u32, mean_spacing)
    } else {
        let total_range = positions.last().unwrap() - positions.first().unwrap();
        let target_spacing = slice_thickness.unwrap_or(mean_spacing);
        let target_depth = ((total_range / target_spacing).round() as u32).max(positions.len() as u32);
        (target_depth, total_range / (target_depth - 1) as f64)
    }
}

fn trilinear_interpolate(
    volume: &[Vec<Vec<f64>>],
    x: f64,
    y: f64,
    z: f64,
    w: usize,
    h: usize,
    d: usize,
) -> f64 {
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

    let v000 = volume[z0][y0][x0];
    let v100 = volume[z0][y0][x1];
    let v010 = volume[z0][y1][x0];
    let v110 = volume[z0][y1][x1];
    let v001 = volume[z1][y0][x0];
    let v101 = volume[z1][y0][x1];
    let v011 = volume[z1][y1][x0];
    let v111 = volume[z1][y1][x1];

    let v00 = v000 * (1.0 - fx) + v100 * fx;
    let v10 = v010 * (1.0 - fx) + v110 * fx;
    let v01 = v001 * (1.0 - fx) + v101 * fx;
    let v11 = v011 * (1.0 - fx) + v111 * fx;

    let v0 = v00 * (1.0 - fy) + v10 * fy;
    let v1 = v01 * (1.0 - fy) + v11 * fy;

    v0 * (1.0 - fz) + v1 * fz
}

fn resample_slice_2d(
    slice: &[Vec<f64>],
    src_w: usize,
    src_h: usize,
    src_spacing_x: f64,
    src_spacing_y: f64,
    target_spacing_x: f64,
    target_spacing_y: f64,
) -> (Vec<Vec<f64>>, usize, usize) {
    let target_w = ((src_w as f64 * src_spacing_x / target_spacing_x).round() as usize).max(1);
    let target_h = ((src_h as f64 * src_spacing_y / target_spacing_y).round() as usize).max(1);

    let mut result = vec![vec![0.0f64; target_w]; target_h];

    for y in 0..target_h {
        for x in 0..target_w {
            let src_x = (x as f64 + 0.5) * target_spacing_x / src_spacing_x - 0.5;
            let src_y = (y as f64 + 0.5) * target_spacing_y / src_spacing_y - 0.5;
            
            let src_x = src_x.max(0.0).min((src_w - 1) as f64);
            let src_y = src_y.max(0.0).min((src_h - 1) as f64);
            
            let x0 = src_x.floor() as usize;
            let y0 = src_y.floor() as usize;
            let x1 = (x0 + 1).min(src_w - 1);
            let y1 = (y0 + 1).min(src_h - 1);
            
            let fx = src_x - x0 as f64;
            let fy = src_y - y0 as f64;
            
            let v00 = slice[y0][x0];
            let v10 = slice[y0][x1];
            let v01 = slice[y1][x0];
            let v11 = slice[y1][x1];
            
            let v0 = v00 * (1.0 - fx) + v10 * fx;
            let v1 = v01 * (1.0 - fx) + v11 * fx;
            
            result[y][x] = v0 * (1.0 - fy) + v1 * fy;
        }
    }

    (result, target_w, target_h)
}

fn differential_encode(data: &[u16]) -> Vec<u8> {
    if data.is_empty() {
        return Vec::new();
    }
    
    let mut result = Vec::with_capacity(data.len() * 2);
    let mut prev: u16 = 0;
    
    for &val in data {
        let diff = val.wrapping_sub(prev) as i16;
        prev = val;
        
        if diff >= -128 && diff <= 127 {
            result.push(0x01);
            result.push(diff as u8);
        } else {
            result.push(0x02);
            result.extend_from_slice(&val.to_le_bytes());
        }
    }
    
    result
}

#[tauri::command]
pub fn build_volume_rendering(
    state: tauri::State<std::sync::Mutex<crate::AppState>>,
    study_uid: String,
    series_uid: String,
) -> Result<VolumeRenderData, String> {
    let key = cache_key(&study_uid, &series_uid);
    
    {
        let mut cache = VOLUME_RENDER_CACHE.lock().unwrap();
        if let Some(mut cv) = cache.get_mut(&key) {
            cv.last_used = std::time::Instant::now();
            let compressed = differential_encode(&cv.voxel_data);
            let mut min_hu = f64::INFINITY;
            let mut max_hu = f64::NEG_INFINITY;
            for &v in &cv.voxel_data {
                let hu = v as f64 - 1024.0;
                if hu < min_hu { min_hu = hu; }
                if hu > max_hu { max_hu = hu; }
            }
            return Ok(VolumeRenderData {
                compressed_data: BASE64.encode(&compressed),
                width: cv.width,
                height: cv.height,
                depth: cv.depth,
                voxel_size_x: cv.voxel_spacing.0,
                voxel_size_y: cv.voxel_spacing.1,
                voxel_size_z: cv.voxel_spacing.2,
                min_hu,
                max_hu,
            });
        }
    }
    
    let state_lock = state.lock().unwrap();
    let study = state_lock.studies.get(&study_uid).ok_or("Study not found")?;
    let series = study.series.get(&series_uid).ok_or("Series not found")?;
    
    if series.instances.is_empty() {
        return Err("No instances in series".to_string());
    }
    
    let instance_paths: Vec<String> = series.instances.iter().map(|i| i.file_path.clone()).collect();
    let first_instance = &series.instances[0];
    let default_pixel_spacing = first_instance.info.pixel_spacing.unwrap_or((1.0, 1.0));
    let slice_thickness = first_instance.info.slice_thickness;
    
    let positions = get_slice_positions(&series.instances);
    let (target_depth, target_spacing_z) = calculate_target_depth_and_spacing(&positions, slice_thickness);
    
    let mut all_pixel_spacings: Vec<(f64, f64)> = Vec::new();
    for inst in &series.instances {
        if let Some(ps) = inst.info.pixel_spacing {
            all_pixel_spacings.push(ps);
        }
    }
    if all_pixel_spacings.is_empty() {
        all_pixel_spacings.push(default_pixel_spacing);
    }
    
    let (target_spacing_x, target_spacing_y) = find_most_frequent_spacing(&all_pixel_spacings);
    
    let mut source_slices: Vec<Vec<Vec<f64>>> = Vec::new();
    let mut src_w = 0usize;
    let mut src_h = 0usize;
    let mut min_hu = f64::INFINITY;
    let mut max_hu = f64::NEG_INFINITY;
    
    for (i, file_path) in instance_paths.iter().enumerate() {
        let pixel_data = dicom::extract_pixel_data(Path::new(file_path), 0)
            .map_err(|e| format!("Failed to load slice {}: {}", i, e))?;
        
        let inst_spacing = series.instances[i].info.pixel_spacing.unwrap_or(default_pixel_spacing);
        let w = pixel_data.width as usize;
        let h = pixel_data.height as usize;
        
        let mut slice_2d: Vec<Vec<f64>> = Vec::with_capacity(h);
        for y in 0..h {
            let mut row: Vec<f64> = Vec::with_capacity(w);
            for x in 0..w {
                let idx = y * w + x;
                let v = pixel_data.pixels.get(idx).copied().unwrap_or(0.0);
                if v < min_hu { min_hu = v; }
                if v > max_hu { max_hu = v; }
                row.push(v);
            }
            slice_2d.push(row);
        }
        
        if inst_spacing != (target_spacing_x, target_spacing_y) {
            let (resampled, rw, rh) = resample_slice_2d(
                &slice_2d, w, h, inst_spacing.0, inst_spacing.1,
                target_spacing_x, target_spacing_y,
            );
            source_slices.push(resampled);
            src_w = rw;
            src_h = rh;
        } else {
            source_slices.push(slice_2d);
            src_w = w;
            src_h = h;
        }
    }
    drop(state_lock);
    
    let mut final_volume: Vec<u16> = Vec::with_capacity((src_w * src_h * target_depth as usize) as usize);
    
    let pos_start = positions.first().copied().unwrap_or(0.0);
    let pos_end = positions.last().copied().unwrap_or(0.0);
    let pos_range = if pos_end != pos_start { pos_end - pos_start } else { 1.0 };
    
    for z in 0..target_depth as usize {
        let z_frac = z as f64 / (target_depth - 1).max(1) as f64;
        let target_pos = pos_start + z_frac * pos_range;
        
        let mut src_z = 0.0f64;
        for i in 1..positions.len() {
            if target_pos <= positions[i] {
                let seg_start = positions[i - 1];
                let seg_end = positions[i];
                let seg_range = if seg_end != seg_start { seg_end - seg_start } else { 1.0 };
                let t = (target_pos - seg_start) / seg_range;
                src_z = (i - 1) as f64 + t;
                break;
            }
            if i == positions.len() - 1 {
                src_z = (positions.len() - 1) as f64;
            }
        }
        
        for y in 0..src_h {
            for x in 0..src_w {
                let v = trilinear_interpolate(
                    &source_slices,
                    x as f64,
                    y as f64,
                    src_z,
                    src_w,
                    src_h,
                    source_slices.len(),
                );
                let v_clamped = v.max(-1024.0).min(3071.0);
                let v_u16 = (v_clamped + 1024.0).round() as u16;
                final_volume.push(v_u16);
            }
        }
    }
    
    let compressed = differential_encode(&final_volume);
    
    prune_cache();
    let mut cache = VOLUME_RENDER_CACHE.lock().unwrap();
    cache.insert(key, CachedVolumeRender {
        voxel_data: final_volume,
        width: src_w as u32,
        height: src_h as u32,
        depth: target_depth,
        voxel_spacing: (target_spacing_x, target_spacing_y, target_spacing_z),
        last_used: std::time::Instant::now(),
    });
    
    Ok(VolumeRenderData {
        compressed_data: BASE64.encode(&compressed),
        width: src_w as u32,
        height: src_h as u32,
        depth: target_depth,
        voxel_size_x: target_spacing_x,
        voxel_size_y: target_spacing_y,
        voxel_size_z: target_spacing_z,
        min_hu,
        max_hu,
    })
}
