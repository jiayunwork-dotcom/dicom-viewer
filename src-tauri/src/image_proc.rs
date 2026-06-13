use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PixelDataResponse {
    pub width: u32,
    pub height: u32,
    pub frames: u32,
    pub pixels: Vec<f64>,
    pub photometric_interpretation: String,
    pub rescale_slope: f64,
    pub rescale_intercept: f64,
    pub default_window_width: Option<f64>,
    pub default_window_center: Option<f64>,
    pub pixel_spacing: Option<(f64, f64)>,
    pub slice_thickness: Option<f64>,
    pub slice_location: Option<f64>,
    pub image_position_patient: Option<(f64, f64, f64)>,
    pub image_orientation_patient: Option<(f64, f64, f64, f64, f64, f64)>,
    pub total_slices: u32,
    pub min_pixel_value: f64,
    pub max_pixel_value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowPreset {
    pub name: String,
    pub modality: String,
    pub window_width: f64,
    pub window_center: f64,
}

#[tauri::command]
pub fn get_available_window_presets() -> Vec<WindowPreset> {
    vec![
        WindowPreset {
            name: "CT Lung".to_string(),
            modality: "CT".to_string(),
            window_width: 1500.0,
            window_center: -600.0,
        },
        WindowPreset {
            name: "CT Bone".to_string(),
            modality: "CT".to_string(),
            window_width: 2500.0,
            window_center: 300.0,
        },
        WindowPreset {
            name: "CT Soft Tissue".to_string(),
            modality: "CT".to_string(),
            window_width: 400.0,
            window_center: 40.0,
        },
        WindowPreset {
            name: "CT Brain".to_string(),
            modality: "CT".to_string(),
            window_width: 80.0,
            window_center: 40.0,
        },
        WindowPreset {
            name: "CT Abdomen".to_string(),
            modality: "CT".to_string(),
            window_width: 350.0,
            window_center: 50.0,
        },
        WindowPreset {
            name: "MR T1".to_string(),
            modality: "MR".to_string(),
            window_width: 500.0,
            window_center: 250.0,
        },
        WindowPreset {
            name: "MR T2".to_string(),
            modality: "MR".to_string(),
            window_width: 800.0,
            window_center: 400.0,
        },
    ]
}

#[tauri::command]
pub fn apply_window_level(
    pixels: Vec<f64>,
    width: u32,
    height: u32,
    window_width: f64,
    window_center: f64,
    photometric_interpretation: String,
    invert: bool,
) -> Vec<u8> {
    let ww = window_width.max(1.0);
    let low = window_center - ww / 2.0;
    let high = window_center + ww / 2.0;

    let total_pixels = (width * height) as usize;
    let mut rgba = Vec::with_capacity(total_pixels * 4);

    for i in 0..total_pixels {
        let pixel_val = pixels.get(i).copied().unwrap_or(0.0);

        let normalized = if pixel_val <= low {
            0.0
        } else if pixel_val >= high {
            1.0
        } else {
            (pixel_val - low) / ww
        };

        let mut gray = (normalized * 255.0).round() as u8;

        if photometric_interpretation == "MONOCHROME1" {
            gray = 255 - gray;
        }

        if invert {
            gray = 255 - gray;
        }

        rgba.push(gray);
        rgba.push(gray);
        rgba.push(gray);
        rgba.push(255);
    }

    rgba
}

#[tauri::command]
pub fn apply_palette_color(
    rgba_data: Vec<u8>,
    palette: String,
) -> Vec<u8> {
    match palette.as_str() {
        "hot" => apply_hot_palette(&rgba_data),
        "rainbow" => apply_rainbow_palette(&rgba_data),
        "pet" => apply_pet_palette(&rgba_data),
        _ => rgba_data,
    }
}

fn apply_hot_palette(rgba_data: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(rgba_data.len());
    for chunk in rgba_data.chunks(4) {
        let gray = chunk[0] as f64 / 255.0;
        let (r, g, b) = if gray < 0.33 {
            (gray * 3.0 * 255.0, 0.0, 0.0)
        } else if gray < 0.66 {
            (255.0, (gray - 0.33) * 3.0 * 255.0, 0.0)
        } else {
            (255.0, 255.0, (gray - 0.66) * 3.0 * 255.0)
        };
        result.push(r.min(255.0) as u8);
        result.push(g.min(255.0) as u8);
        result.push(b.min(255.0) as u8);
        result.push(255);
    }
    result
}

fn apply_rainbow_palette(rgba_data: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(rgba_data.len());
    for chunk in rgba_data.chunks(4) {
        let gray = chunk[0] as f64 / 255.0;
        let (r, g, b) = hsv_to_rgb(gray * 0.83, 1.0, 1.0);
        result.push(r);
        result.push(g);
        result.push(b);
        result.push(255);
    }
    result
}

fn apply_pet_palette(rgba_data: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(rgba_data.len());
    for chunk in rgba_data.chunks(4) {
        let gray = chunk[0] as f64 / 255.0;
        let (r, g, b) = if gray < 0.1 {
            (0u8, 0u8, 0u8)
        } else {
            hsv_to_rgb(0.66 - (gray - 0.1) * 0.74, 1.0, 1.0)
        };
        result.push(r);
        result.push(g);
        result.push(b);
        result.push(255);
    }
    result
}

fn hsv_to_rgb(h: f64, s: f64, v: f64) -> (u8, u8, u8) {
    let h = h % 1.0;
    let i = (h * 6.0).floor() as i32;
    let f = h * 6.0 - i as f64;
    let p = v * (1.0 - s);
    let q = v * (1.0 - f * s);
    let t = v * (1.0 - (1.0 - f) * s);

    let (r, g, b) = match i % 6 {
        0 => (v, t, p),
        1 => (q, v, p),
        2 => (p, v, t),
        3 => (p, q, v),
        4 => (t, p, v),
        _ => (v, p, q),
    };

    ((r * 255.0) as u8, (g * 255.0) as u8, (b * 255.0) as u8)
}

pub fn compute_roi_stats(
    pixels: &[f64],
    width: u32,
    height: u32,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    is_ellipse: bool,
) -> RoiStats {
    let x0 = x.max(0.0) as u32;
    let y0 = y.max(0.0) as u32;
    let x1 = (x + w).min(width as f64) as u32;
    let y1 = (y + h).min(height as f64) as u32;

    let cx = (x0 + x1) as f64 / 2.0;
    let cy = (y0 + y1) as f64 / 2.0;
    let rx = (x1 - x0) as f64 / 2.0;
    let ry = (y1 - y0) as f64 / 2.0;

    let mut values = Vec::new();
    let mut pixel_count = 0u32;

    for py in y0..y1 {
        for px in x0..x1 {
            if is_ellipse {
                let dx = (px as f64 - cx) / rx.max(1.0);
                let dy = (py as f64 - cy) / ry.max(1.0);
                if dx * dx + dy * dy > 1.0 {
                    continue;
                }
            }
            let idx = (py * width + px) as usize;
            if idx < pixels.len() {
                values.push(pixels[idx]);
                pixel_count += 1;
            }
        }
    }

    if values.is_empty() {
        return RoiStats {
            mean: 0.0,
            std: 0.0,
            min: 0.0,
            max: 0.0,
            pixel_count: 0,
        };
    }

    let mean = values.iter().sum::<f64>() / values.len() as f64;
    let variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / values.len() as f64;
    let std = variance.sqrt();
    let min = values.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

    RoiStats {
        mean,
        std,
        min,
        max,
        pixel_count,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoiStats {
    pub mean: f64,
    pub std: f64,
    pub min: f64,
    pub max: f64,
    pub pixel_count: u32,
}
