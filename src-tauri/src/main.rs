#[macro_use]
extern crate lazy_static;

pub mod dicom;
pub mod image_proc;
pub mod mpr;
pub mod anonymize;

use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub studies: std::collections::HashMap<String, dicom::Study>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            studies: std::collections::HashMap::new(),
        }
    }
}

fn main() {
    tauri::Builder::default()
        .manage(std::sync::Mutex::new(AppState::default()))
        .invoke_handler(tauri::generate_handler![
            dicom::open_dicom_file,
            dicom::open_dicom_directory,
            dicom::get_studies,
            dicom::get_series_info,
            dicom::get_instance_pixel_data,
            dicom::get_dicom_tags,
            dicom::get_series_thumbnail,
            image_proc::apply_window_level,
            image_proc::apply_palette_color,
            image_proc::get_available_window_presets,
            mpr::check_mpr_eligibility,
            mpr::generate_mpr_slices,
            anonymize::anonymize_dicom_file,
            anonymize::anonymize_study,
            export_screenshot,
            export_annotations,
            load_annotations,
            save_bookmarks,
            load_bookmarks,
            save_history_file,
            load_history_file,
            check_dir_writable,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn export_screenshot(
    image_data: Vec<u8>,
    width: u32,
    height: u32,
    path: String,
    format: String,
) -> Result<(), String> {
    let img = image::RgbaImage::from_raw(width, height, image_data)
        .ok_or_else(|| "Failed to create image from raw data".to_string())?;

    let output_format = match format.as_str() {
        "png" => image::ImageFormat::Png,
        "jpeg" | "jpg" => image::ImageFormat::Jpeg,
        _ => return Err("Unsupported format".to_string()),
    };

    img.save_with_format(&path, output_format)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn export_annotations(annotations: serde_json::Value, path: String) -> Result<(), String> {
    let json_str = serde_json::to_string_pretty(&annotations)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, json_str).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_annotations(path: String) -> Result<serde_json::Value, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let annotations: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| e.to_string())?;
    Ok(annotations)
}

#[tauri::command]
fn save_bookmarks(bookmarks: serde_json::Value, path: String) -> Result<(), String> {
    let json_str = serde_json::to_string_pretty(&bookmarks)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, json_str).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_bookmarks(path: String) -> Result<serde_json::Value, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let bookmarks: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| e.to_string())?;
    Ok(bookmarks)
}

#[tauri::command]
fn save_history_file(history: serde_json::Value, path: String) -> Result<(), String> {
    let json_str = serde_json::to_string_pretty(&history)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, json_str).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_history_file(path: String) -> Result<serde_json::Value, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let history: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| e.to_string())?;
    Ok(history)
}

#[tauri::command]
fn check_dir_writable(dir_path: String) -> Result<bool, String> {
    let test_path = std::path::Path::new(&dir_path).join(".write_test_tmp");
    match std::fs::write(&test_path, b"test") {
        Ok(_) => {
            let _ = std::fs::remove_file(&test_path);
            Ok(true)
        }
        Err(_) => Ok(false),
    }
}
