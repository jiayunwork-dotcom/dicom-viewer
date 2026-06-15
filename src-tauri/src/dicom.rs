use byteorder::{ByteOrder, LittleEndian, BigEndian};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DicomTag {
    pub group: u16,
    pub element: u16,
    pub vr: String,
    pub value: String,
    pub name: String,
    pub is_private: bool,
    pub is_sequence: bool,
    pub children: Option<Vec<DicomTag>>,
}

impl Default for DicomTag {
    fn default() -> Self {
        DicomTag {
            group: 0,
            element: 0,
            vr: "UN".to_string(),
            value: String::new(),
            name: String::new(),
            is_private: false,
            is_sequence: false,
            children: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientInfo {
    pub name: String,
    pub id: String,
    pub birth_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyInfo {
    pub study_uid: String,
    pub study_date: String,
    pub study_description: String,
    pub modality: String,
    pub institution: String,
    pub patient: PatientInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeriesInfo {
    pub series_uid: String,
    pub series_description: String,
    pub series_number: u32,
    pub modality: String,
    pub instance_count: u32,
    pub thumbnail: Option<Vec<u8>>,
    pub is_multiframe: bool,
    pub number_of_frames: u32,
    pub frame_time: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceInfo {
    pub sop_instance_uid: String,
    pub instance_number: u32,
    pub rows: u32,
    pub columns: u32,
    pub bits_allocated: u16,
    pub bits_stored: u16,
    pub high_bit: u16,
    pub pixel_representation: u16,
    pub samples_per_pixel: u16,
    pub photometric_interpretation: String,
    pub pixel_spacing: Option<(f64, f64)>,
    pub slice_thickness: Option<f64>,
    pub slice_location: Option<f64>,
    pub image_position_patient: Option<(f64, f64, f64)>,
    pub image_orientation_patient: Option<(f64, f64, f64, f64, f64, f64)>,
    pub rescale_slope: f64,
    pub rescale_intercept: f64,
    pub window_width: Option<Vec<f64>>,
    pub window_center: Option<Vec<f64>>,
    pub number_of_frames: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Series {
    pub info: SeriesInfo,
    pub instances: Vec<Instance>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Study {
    pub info: StudyInfo,
    pub series: HashMap<String, Series>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Instance {
    pub file_path: String,
    pub info: InstanceInfo,
    pub tags: Vec<DicomTag>,
    #[serde(skip)]
    pub pixel_data_cache: Option<PixelData>,
}

#[derive(Debug, Clone)]
pub struct PixelData {
    pub width: u32,
    pub height: u32,
    pub frames: u32,
    pub bits_allocated: u16,
    pub bits_stored: u16,
    pub high_bit: u16,
    pub pixel_representation: u16,
    pub samples_per_pixel: u16,
    pub photometric_interpretation: String,
    pub rescale_slope: f64,
    pub rescale_intercept: f64,
    pub pixels: Vec<f64>,
    pub raw_pixels: Vec<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TransferSyntax {
    ImplicitVRLittleEndian,
    ExplicitVRLittleEndian,
    ExplicitVRBigEndian,
    JpegBaseline,
    JpegLossless,
    Jpeg2000Lossless,
    Jpeg2000Lossy,
    RleLossless,
}

pub struct DicomParser {
    pub data: Vec<u8>,
    pub pos: usize,
    pub transfer_syntax: TransferSyntax,
}

impl DicomParser {
    pub fn new(data: Vec<u8>) -> Self {
        Self {
            data,
            pos: 0,
            transfer_syntax: TransferSyntax::ImplicitVRLittleEndian,
        }
    }

    fn read_u16_le(&mut self) -> u16 {
        let val = LittleEndian::read_u16(&self.data[self.pos..self.pos + 2]);
        self.pos += 2;
        val
    }

    fn read_u16_be(&mut self) -> u16 {
        let val = BigEndian::read_u16(&self.data[self.pos..self.pos + 2]);
        self.pos += 2;
        val
    }

    fn read_u32_le(&mut self) -> u32 {
        let val = LittleEndian::read_u32(&self.data[self.pos..self.pos + 4]);
        self.pos += 4;
        val
    }

    fn read_u32_be(&mut self) -> u32 {
        let val = BigEndian::read_u32(&self.data[self.pos..self.pos + 4]);
        self.pos += 4;
        val
    }

    fn read_bytes(&mut self, len: usize) -> Vec<u8> {
        let bytes = self.data[self.pos..self.pos + len].to_vec();
        self.pos += len;
        bytes
    }

    fn read_string(&mut self, len: usize) -> String {
        let bytes = self.read_bytes(len);
        String::from_utf8_lossy(&bytes).trim_end_matches(' ').trim_end_matches('\0').to_string()
    }

    pub fn is_explicit_vr(&self) -> bool {
        matches!(
            self.transfer_syntax,
            TransferSyntax::ExplicitVRLittleEndian
                | TransferSyntax::ExplicitVRBigEndian
                | TransferSyntax::JpegBaseline
                | TransferSyntax::JpegLossless
                | TransferSyntax::Jpeg2000Lossless
                | TransferSyntax::Jpeg2000Lossy
                | TransferSyntax::RleLossless
        )
    }

    pub fn is_big_endian(&self) -> bool {
        self.transfer_syntax == TransferSyntax::ExplicitVRBigEndian
    }

    pub fn parse_tags(&mut self) -> Vec<DicomTag> {
        let mut tags = Vec::new();
        while self.pos < self.data.len() {
            if self.pos + 4 > self.data.len() {
                break;
            }

            let group = if self.is_big_endian() { self.read_u16_be() } else { self.read_u16_le() };
            let element = if self.is_big_endian() { self.read_u16_be() } else { self.read_u16_le() };

            if group == 0xFFFE && (element == 0xE000 || element == 0xE00D || element == 0xE0DD) {
                let _length = if self.is_big_endian() { self.read_u32_be() } else { self.read_u32_le() };
                continue;
            }

            if group == 0x7FE0 && element == 0x0010 {
                let _vr = if self.is_explicit_vr() {
                    let vr = self.read_string(2);
                    if vr == "OB" || vr == "OW" || vr == "OF" || vr == "SQ" || vr == "UT" {
                        let _reserved = self.read_u16_le();
                    }
                    vr
                } else {
                    "OW".to_string()
                };
                let length = if self.is_big_endian() { self.read_u32_be() } else { self.read_u32_le() };
                let pixel_data_start = self.pos;
                let pixel_len = if length == 0xFFFFFFFF {
                    self.data.len() - self.pos
                } else {
                    length as usize
                };
                let value = format!("<Pixel Data: {} bytes>", pixel_len);
                let is_private = group % 2 == 1;
                tags.push(DicomTag {
                    group,
                    element,
                    vr: "OW".to_string(),
                    value,
                    name: tag_name(group, element),
                    is_private,
                    is_sequence: false,
                    children: None,
                });
                self.pos = pixel_data_start + pixel_len;
                continue;
            }

            let (vr, length) = if self.is_explicit_vr() {
                let vr = self.read_string(2);
                let len = if vr == "OB" || vr == "OW" || vr == "OF" || vr == "SQ" || vr == "UT" || vr == "UN" {
                    let _reserved = self.read_u16_le();
                    if self.is_big_endian() { self.read_u32_be() } else { self.read_u32_le() }
                } else {
                    if self.is_big_endian() { self.read_u16_be() as u32 } else { self.read_u16_le() as u32 }
                };
                (vr, len)
            } else {
                ("UN".to_string(), if self.is_big_endian() { self.read_u32_be() } else { self.read_u32_le() })
            };

            let actual_len = if length == 0xFFFFFFFF {
                find_sequence_end(&self.data, self.pos)
            } else {
                length as usize
            };

            let is_private = group % 2 == 1;
            let is_sequence = vr == "SQ";

            let (value, children) = if is_sequence {
                ("<Sequence>".to_string(), None)
            } else if group == 0x0002 || actual_len < 1024 {
                (self.read_string(actual_len), None)
            } else {
                self.pos += actual_len;
                (format!("<Binary data: {} bytes>", actual_len), None)
            };

            tags.push(DicomTag {
                group,
                element,
                vr,
                value,
                name: tag_name(group, element),
                is_private,
                is_sequence,
                children,
            });
        }
        tags
    }
}

fn find_sequence_end(data: &[u8], start: usize) -> usize {
    let mut i = start;
    while i + 8 <= data.len() {
        if data[i] == 0xFE && data[i + 1] == 0xFF
            && data[i + 2] == 0xDD && data[i + 3] == 0xE0
            && data[i + 4] == 0x00 && data[i + 5] == 0x00
            && data[i + 6] == 0x00 && data[i + 7] == 0x00 {
            return i - start;
        }
        i += 1;
    }
    data.len() - start
}

fn tag_name(group: u16, element: u16) -> String {
    let tag_map: HashMap<(u16, u16), &str> = [
        ((0x0008, 0x0005), "Specific Character Set"),
        ((0x0008, 0x0008), "Image Type"),
        ((0x0008, 0x0016), "SOP Class UID"),
        ((0x0008, 0x0018), "SOP Instance UID"),
        ((0x0008, 0x0020), "Study Date"),
        ((0x0008, 0x0021), "Series Date"),
        ((0x0008, 0x0022), "Acquisition Date"),
        ((0x0008, 0x0023), "Content Date"),
        ((0x0008, 0x0030), "Study Time"),
        ((0x0008, 0x0050), "Accession Number"),
        ((0x0008, 0x0060), "Modality"),
        ((0x0008, 0x0070), "Manufacturer"),
        ((0x0008, 0x0080), "Institution Name"),
        ((0x0008, 0x0090), "Referring Physician Name"),
        ((0x0008, 0x1010), "Station Name"),
        ((0x0008, 0x1030), "Study Description"),
        ((0x0008, 0x103E), "Series Description"),
        ((0x0008, 0x1090), "Manufacturer's Model Name"),
        ((0x0010, 0x0010), "Patient's Name"),
        ((0x0010, 0x0020), "Patient ID"),
        ((0x0010, 0x0030), "Patient's Birth Date"),
        ((0x0010, 0x0040), "Patient's Sex"),
        ((0x0010, 0x1010), "Patient's Age"),
        ((0x0010, 0x1030), "Patient's Weight"),
        ((0x0018, 0x0050), "Slice Thickness"),
        ((0x0018, 0x0088), "Spacing Between Slices"),
        ((0x0018, 0x1020), "Software Versions"),
        ((0x0018, 0x1063), "Frame Time"),
        ((0x0018, 0x1151), "X-Ray Tube Current"),
        ((0x0018, 0x1152), "Exposure"),
        ((0x0018, 0x1153), "Exposure Time"),
        ((0x0018, 0x1210), "Convolution Kernel"),
        ((0x0020, 0x000D), "Study Instance UID"),
        ((0x0020, 0x000E), "Series Instance UID"),
        ((0x0020, 0x0010), "Study ID"),
        ((0x0020, 0x0011), "Series Number"),
        ((0x0020, 0x0012), "Acquisition Number"),
        ((0x0020, 0x0013), "Instance Number"),
        ((0x0020, 0x0032), "Image Position (Patient)"),
        ((0x0020, 0x0037), "Image Orientation (Patient)"),
        ((0x0020, 0x0052), "Frame of Reference UID"),
        ((0x0020, 0x0060), "Laterality"),
        ((0x0020, 0x0100), "Temporal Position Identifier"),
        ((0x0020, 0x1040), "Position Reference Indicator"),
        ((0x0020, 0x1041), "Slice Location"),
        ((0x0028, 0x0002), "Samples Per Pixel"),
        ((0x0028, 0x0004), "Photometric Interpretation"),
        ((0x0028, 0x0008), "Number of Frames"),
        ((0x0028, 0x0010), "Rows"),
        ((0x0028, 0x0011), "Columns"),
        ((0x0028, 0x0030), "Pixel Spacing"),
        ((0x0028, 0x0100), "Bits Allocated"),
        ((0x0028, 0x0101), "Bits Stored"),
        ((0x0028, 0x0102), "High Bit"),
        ((0x0028, 0x0103), "Pixel Representation"),
        ((0x0028, 0x1050), "Window Center"),
        ((0x0028, 0x1051), "Window Width"),
        ((0x0028, 0x1052), "Rescale Intercept"),
        ((0x0028, 0x1053), "Rescale Slope"),
        ((0x0028, 0x1054), "Rescale Type"),
        ((0x7FE0, 0x0010), "Pixel Data"),
    ].iter().cloned().collect();

    tag_map.get(&(group, element))
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Unknown Tag ({:04X},{:04X})", group, element))
}

pub fn get_tag_value(tags: &[DicomTag], group: u16, element: u16) -> Option<String> {
    tags.iter()
        .find(|t| t.group == group && t.element == element)
        .map(|t| t.value.clone())
}

fn parse_multiple_doubles(value: &str) -> Vec<f64> {
    value
        .split('\\')
        .map(|s| s.trim().parse::<f64>().unwrap_or(0.0))
        .collect()
}

fn parse_doubles(value: &str) -> Option<Vec<f64>> {
    let vals = parse_multiple_doubles(value);
    if vals.is_empty() || vals.iter().all(|v| *v == 0.0 && value.trim().is_empty()) {
        None
    } else {
        Some(vals)
    }
}

pub fn parse_dicom_file(path: &Path) -> Result<(Instance, Vec<DicomTag>), String> {
    let mut file = fs::File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut data = Vec::new();
    file.read_to_end(&mut data).map_err(|e| format!("Failed to read file: {}", e))?;

    if data.len() < 132 {
        return Err("File too small to be DICOM".to_string());
    }

    if &data[128..132] != b"DICM" {
        return Err("Not a valid DICOM file (missing DICM prefix)".to_string());
    }

    let mut parser = DicomParser::new(data);
    parser.pos = 132;

    let meta_tags = parser.parse_tags();

    let transfer_syntax_uid = get_tag_value(&meta_tags, 0x0002, 0x0010).unwrap_or_default();
    parser.transfer_syntax = match transfer_syntax_uid.as_str() {
        "1.2.840.10008.1.2" => TransferSyntax::ImplicitVRLittleEndian,
        "1.2.840.10008.1.2.1" => TransferSyntax::ExplicitVRLittleEndian,
        "1.2.840.10008.1.2.2" => TransferSyntax::ExplicitVRBigEndian,
        "1.2.840.10008.1.2.4.50" => TransferSyntax::JpegBaseline,
        "1.2.840.10008.1.2.4.57" => TransferSyntax::JpegLossless,
        "1.2.840.10008.1.2.4.70" => TransferSyntax::JpegLossless,
        "1.2.840.10008.1.2.4.90" => TransferSyntax::Jpeg2000Lossless,
        "1.2.840.10008.1.2.4.91" => TransferSyntax::Jpeg2000Lossy,
        "1.2.840.10008.1.2.5" => TransferSyntax::RleLossless,
        _ => TransferSyntax::ExplicitVRLittleEndian,
    };

    let all_tags = parser.parse_tags();
    let mut combined_tags = meta_tags;
    combined_tags.extend(all_tags);

    let study_uid = get_tag_value(&combined_tags, 0x0020, 0x000D).unwrap_or_else(|| "unknown".to_string());
    let series_uid = get_tag_value(&combined_tags, 0x0020, 0x000E).unwrap_or_else(|| "unknown".to_string());
    let sop_instance_uid = get_tag_value(&combined_tags, 0x0008, 0x0018).unwrap_or_else(|| "unknown".to_string());

    let rows = get_tag_value(&combined_tags, 0x0028, 0x0010)
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(0);
    let columns = get_tag_value(&combined_tags, 0x0028, 0x0011)
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(0);
    let bits_allocated = get_tag_value(&combined_tags, 0x0028, 0x0100)
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(16);
    let bits_stored = get_tag_value(&combined_tags, 0x0028, 0x0101)
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(12);
    let high_bit = get_tag_value(&combined_tags, 0x0028, 0x0102)
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(11);
    let pixel_representation = get_tag_value(&combined_tags, 0x0028, 0x0103)
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(0);
    let samples_per_pixel = get_tag_value(&combined_tags, 0x0028, 0x0002)
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(1);
    let photometric_interpretation = get_tag_value(&combined_tags, 0x0028, 0x0004)
        .unwrap_or_else(|| "MONOCHROME2".to_string());
    let number_of_frames = get_tag_value(&combined_tags, 0x0028, 0x0008)
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(1);

    let pixel_spacing = get_tag_value(&combined_tags, 0x0028, 0x0030)
        .and_then(|v| {
            let vals = parse_multiple_doubles(&v);
            if vals.len() >= 2 {
                Some((vals[0], vals[1]))
            } else {
                None
            }
        });

    let slice_thickness = get_tag_value(&combined_tags, 0x0018, 0x0050)
        .and_then(|v| v.parse::<f64>().ok());

    let slice_location = get_tag_value(&combined_tags, 0x0020, 0x1041)
        .and_then(|v| v.parse::<f64>().ok());

    let image_position_patient = get_tag_value(&combined_tags, 0x0020, 0x0032)
        .and_then(|v| {
            let vals = parse_multiple_doubles(&v);
            if vals.len() >= 3 {
                Some((vals[0], vals[1], vals[2]))
            } else {
                None
            }
        });

    let image_orientation_patient = get_tag_value(&combined_tags, 0x0020, 0x0037)
        .and_then(|v| {
            let vals = parse_multiple_doubles(&v);
            if vals.len() >= 6 {
                Some((vals[0], vals[1], vals[2], vals[3], vals[4], vals[5]))
            } else {
                None
            }
        });

    let rescale_slope = get_tag_value(&combined_tags, 0x0028, 0x1053)
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(1.0);
    let rescale_intercept = get_tag_value(&combined_tags, 0x0028, 0x1052)
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(0.0);

    let window_center = get_tag_value(&combined_tags, 0x0028, 0x1050)
        .and_then(|v| parse_doubles(&v));
    let window_width = get_tag_value(&combined_tags, 0x0028, 0x1051)
        .and_then(|v| parse_doubles(&v));

    let instance_number = get_tag_value(&combined_tags, 0x0020, 0x0013)
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(0);

    let frame_time = get_tag_value(&combined_tags, 0x0018, 0x1063)
        .and_then(|v| v.parse::<f64>().ok());

    let instance_info = InstanceInfo {
        sop_instance_uid: sop_instance_uid.clone(),
        instance_number,
        rows,
        columns,
        bits_allocated,
        bits_stored,
        high_bit,
        pixel_representation,
        samples_per_pixel,
        photometric_interpretation,
        pixel_spacing,
        slice_thickness,
        slice_location,
        image_position_patient,
        image_orientation_patient,
        rescale_slope,
        rescale_intercept,
        window_width,
        window_center,
        number_of_frames,
    };

    let instance = Instance {
        file_path: path.to_string_lossy().to_string(),
        info: instance_info,
        tags: combined_tags.clone(),
        pixel_data_cache: None,
    };

    Ok((instance, combined_tags))
}

pub fn extract_pixel_data(path: &Path, frame_index: u32) -> Result<PixelData, String> {
    let (instance, tags) = parse_dicom_file(path)?;

    let mut file = fs::File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut data = Vec::new();
    file.read_to_end(&mut data).map_err(|e| format!("Failed to read file: {}", e))?;

    if data.len() < 132 {
        return Err("File too small".to_string());
    }

    let mut parser = DicomParser::new(data);
    parser.pos = 132;
    let _meta = parser.parse_tags();

    let transfer_syntax_uid = get_tag_value(&tags, 0x0002, 0x0010).unwrap_or_default();
    parser.transfer_syntax = match transfer_syntax_uid.as_str() {
        "1.2.840.10008.1.2" => TransferSyntax::ImplicitVRLittleEndian,
        "1.2.840.10008.1.2.1" => TransferSyntax::ExplicitVRLittleEndian,
        "1.2.840.10008.1.2.2" => TransferSyntax::ExplicitVRBigEndian,
        "1.2.840.10008.1.2.4.50" => TransferSyntax::JpegBaseline,
        "1.2.840.10008.1.2.4.57" => TransferSyntax::JpegLossless,
        "1.2.840.10008.1.2.4.70" => TransferSyntax::JpegLossless,
        "1.2.840.10008.1.2.4.90" => TransferSyntax::Jpeg2000Lossless,
        "1.2.840.10008.1.2.4.91" => TransferSyntax::Jpeg2000Lossy,
        "1.2.840.10008.1.2.5" => TransferSyntax::RleLossless,
        _ => TransferSyntax::ExplicitVRLittleEndian,
    };

    let info = &instance.info;
    let mut raw_pixels: Vec<i64> = Vec::new();

    while parser.pos < parser.data.len() {
        if parser.pos + 4 > parser.data.len() {
            break;
        }

        let group = if parser.is_big_endian() { parser.read_u16_be() } else { parser.read_u16_le() };
        let element = if parser.is_big_endian() { parser.read_u16_be() } else { parser.read_u16_le() };

        if group == 0xFFFE && (element == 0xE000 || element == 0xE00D || element == 0xE0DD) {
            let _length = if parser.is_big_endian() { parser.read_u32_be() } else { parser.read_u32_le() };
            continue;
        }

        if group == 0x7FE0 && element == 0x0010 {
            let vr = if parser.is_explicit_vr() {
                let vr = parser.read_string(2);
                if vr == "OB" || vr == "OW" || vr == "OF" || vr == "SQ" || vr == "UT" {
                    let _reserved = parser.read_u16_le();
                }
                vr
            } else {
                "OW".to_string()
            };
            let length = if parser.is_big_endian() { parser.read_u32_be() } else { parser.read_u32_le() };
            let pixel_len = if length == 0xFFFFFFFF {
                parser.data.len() - parser.pos
            } else {
                length as usize
            };

            let ts = parser.transfer_syntax;
            let is_compressed = matches!(
                ts,
                TransferSyntax::JpegBaseline
                    | TransferSyntax::JpegLossless
                    | TransferSyntax::Jpeg2000Lossless
                    | TransferSyntax::Jpeg2000Lossy
                    | TransferSyntax::RleLossless
            );

            let raw_data = parser.data[parser.pos..parser.pos + pixel_len].to_vec();
            raw_pixels = if is_compressed {
                decode_compressed_pixel_data(
                    &raw_data,
                    info.rows,
                    info.columns,
                    info.bits_allocated,
                    info.bits_stored,
                    info.high_bit,
                    info.pixel_representation,
                    info.samples_per_pixel,
                    info.photometric_interpretation.as_str(),
                    frame_index,
                    ts,
                )
            } else {
                let bytes_per_pixel = (info.bits_allocated / 8) as usize;
                let total_pixels = (info.rows * info.columns * info.samples_per_pixel as u32) as usize;
                let frame_size = total_pixels * bytes_per_pixel;
                let actual_frame = (frame_index as usize).min(info.number_of_frames.saturating_sub(1) as usize);
                let frame_start = actual_frame * frame_size;
                let frame_end = (frame_start + frame_size).min(raw_data.len());
                decode_pixel_data(
                    &raw_data[frame_start..frame_end],
                    info.rows,
                    info.columns,
                    info.bits_allocated,
                    info.bits_stored,
                    info.high_bit,
                    info.pixel_representation,
                    info.samples_per_pixel,
                    parser.is_big_endian(),
                )
            };
            parser.pos += pixel_len;
            break;
        } else {
            let vr = if parser.is_explicit_vr() {
                let vr = parser.read_string(2);
                if vr == "OB" || vr == "OW" || vr == "OF" || vr == "SQ" || vr == "UT" || vr == "UN" {
                    let _reserved = parser.read_u16_le();
                }
                vr
            } else {
                "UN".to_string()
            };
            let length = if vr == "OB" || vr == "OW" || vr == "OF" || vr == "SQ" || vr == "UT" || vr == "UN" {
                if parser.is_big_endian() { parser.read_u32_be() } else { parser.read_u32_le() }
            } else {
                if parser.is_big_endian() { parser.read_u16_be() as u32 } else { parser.read_u16_le() as u32 }
            };
            let actual_len = if length == 0xFFFFFFFF {
                find_sequence_end(&parser.data, parser.pos)
            } else {
                length as usize
            };
            parser.pos += actual_len;
        }
    }

    let pixels: Vec<f64> = raw_pixels
        .iter()
        .map(|&p| p as f64 * info.rescale_slope + info.rescale_intercept)
        .collect();

    Ok(PixelData {
        width: info.columns,
        height: info.rows,
        frames: info.number_of_frames,
        bits_allocated: info.bits_allocated,
        bits_stored: info.bits_stored,
        high_bit: info.high_bit,
        pixel_representation: info.pixel_representation,
        samples_per_pixel: info.samples_per_pixel,
        photometric_interpretation: info.photometric_interpretation.clone(),
        rescale_slope: info.rescale_slope,
        rescale_intercept: info.rescale_intercept,
        pixels,
        raw_pixels,
    })
}

fn decode_pixel_data(
    data: &[u8],
    rows: u32,
    columns: u32,
    bits_allocated: u16,
    bits_stored: u16,
    high_bit: u16,
    pixel_representation: u16,
    samples_per_pixel: u16,
    big_endian: bool,
) -> Vec<i64> {
    let bytes_per_pixel = (bits_allocated / 8) as usize;
    let total_pixels = (rows * columns * samples_per_pixel as u32) as usize;
    let mut pixels = Vec::with_capacity(total_pixels);

    let shift = high_bit - (bits_stored - 1);

    for i in 0..total_pixels {
        let offset = i * bytes_per_pixel;
        if offset + bytes_per_pixel > data.len() {
            pixels.push(0);
            continue;
        }

        let raw_value: i64 = match bytes_per_pixel {
            1 => data[offset] as i64,
            2 => {
                if big_endian {
                    BigEndian::read_u16(&data[offset..offset + 2]) as i64
                } else {
                    LittleEndian::read_u16(&data[offset..offset + 2]) as i64
                }
            }
            4 => {
                if big_endian {
                    BigEndian::read_u32(&data[offset..offset + 4]) as i64
                } else {
                    LittleEndian::read_u32(&data[offset..offset + 4]) as i64
                }
            }
            _ => 0,
        };

        let mut value = if shift > 0 { raw_value >> shift } else { raw_value };

        if pixel_representation == 1 && bits_stored < 16 {
            let sign_bit = 1i64 << (bits_stored - 1);
            if value & sign_bit != 0 {
                value = value - (1i64 << bits_stored);
            }
        }

        pixels.push(value);
    }

    pixels
}

fn decode_compressed_pixel_data(
    data: &[u8],
    rows: u32,
    columns: u32,
    _bits_allocated: u16,
    bits_stored: u16,
    high_bit: u16,
    pixel_representation: u16,
    samples_per_pixel: u16,
    photometric: &str,
    frame_index: u32,
    ts: TransferSyntax,
) -> Vec<i64> {
    let total = (rows * columns * samples_per_pixel as u32) as usize;

    if matches!(ts, TransferSyntax::RleLossless) {
        return decode_rle_lossless(data, rows, columns, bits_stored, high_bit, pixel_representation, samples_per_pixel, frame_index);
    }

    let mut fragments = Vec::new();
    let mut pos = 0;
    while pos + 8 <= data.len() {
        let group = LittleEndian::read_u16(&data[pos..pos + 2]);
        let element = LittleEndian::read_u16(&data[pos + 2..pos + 4]);
        let len = LittleEndian::read_u32(&data[pos + 4..pos + 8]) as usize;
        pos += 8;

        if group == 0xFFFE && element == 0xE000 {
            let end = (pos + len).min(data.len());
            if pos < end {
                fragments.push(&data[pos..end]);
            }
            pos = end;
        } else if group == 0xFFFE && (element == 0xE00D || element == 0xE0DD) {
            break;
        } else {
            pos = pos.saturating_add(len);
        }
    }

    if fragments.is_empty() {
        fragments.push(data);
    }

    let frag_idx = (frame_index as usize).min(fragments.len().saturating_sub(1));
    let jpeg_data = fragments[frag_idx];

    let mut img_result = image::load_from_memory(jpeg_data).ok();
    if img_result.is_none() {
        for (i, frag) in fragments.iter().enumerate() {
            if i == frag_idx {
                continue;
            }
            if let Ok(img) = image::load_from_memory(frag) {
                img_result = Some(img);
                break;
            }
        }
    }

    let img = match img_result {
        Some(img) => img,
        None => return vec![0; total],
    };

    let gray = match samples_per_pixel {
        1 => img.to_luma16(),
        _ => img.to_luma16(),
    };

    let is_jpeg_baseline = matches!(ts, TransferSyntax::JpegBaseline);
    let needs_8to16_scale = if is_jpeg_baseline && bits_stored > 8 {
        Some(((1i64 << bits_stored) - 1) as f64 / 255.0)
    } else {
        None
    };

    let shift = high_bit as i32 - (bits_stored as i32 - 1);
    let sign_bit = if pixel_representation == 1 && bits_stored < 16 {
        1i64 << (bits_stored - 1)
    } else {
        0
    };

    let mask = if bits_stored < 16 {
        (1i64 << bits_stored) - 1
    } else {
        0xFFFFi64
    };

    let mut pixels = Vec::with_capacity(total);
    let w = columns as usize;
    let h = rows as usize;

    for y in 0..h {
        for x in 0..w {
            let raw = if y < gray.height() as usize && x < gray.width() as usize {
                if is_jpeg_baseline {
                    let g8 = img.to_luma8().get_pixel(x as u32, y as u32)[0];
                    let mut v = g8 as i64;
                    if let Some(scale) = needs_8to16_scale {
                        v = (v as f64 * scale).round() as i64;
                    }
                    v
                } else if bits_stored <= 8 {
                    let g8 = img.to_luma8().get_pixel(x as u32, y as u32)[0];
                    g8 as i64
                } else {
                    let p = gray.get_pixel(x as u32, y as u32);
                    p[0] as i64
                }
            } else {
                0
            };

            let mut v = if shift > 0 { raw >> shift } else { raw << (-shift) };
            v &= mask;
            if sign_bit > 0 && v & sign_bit != 0 {
                v = v - (1i64 << bits_stored);
            }
            pixels.push(v);

            if samples_per_pixel > 1 {
                for _ in 1..samples_per_pixel {
                    pixels.push(v);
                }
            }
        }
    }

    pixels.truncate(total);
    if pixels.len() < total {
        pixels.resize(total, 0);
    }
    pixels
}

fn decode_rle_lossless(
    data: &[u8],
    rows: u32,
    columns: u32,
    bits_stored: u16,
    high_bit: u16,
    pixel_representation: u16,
    samples_per_pixel: u16,
    frame_index: u32,
) -> Vec<i64> {
    let total = (rows * columns * samples_per_pixel as u32) as usize;
    let bytes_per_sample = if bits_stored > 8 { 2 } else { 1 };

    let mut segments = Vec::new();
    let mut pos = 0;
    while pos + 8 <= data.len() {
        let group = LittleEndian::read_u16(&data[pos..pos + 2]);
        let element = LittleEndian::read_u16(&data[pos + 2..pos + 4]);
        let len = LittleEndian::read_u32(&data[pos + 4..pos + 8]) as usize;
        pos += 8;
        if group == 0xFFFE && element == 0xE000 {
            let end = (pos + len).min(data.len());
            segments.push(&data[pos..end]);
            pos = end;
        } else if group == 0xFFFE && (element == 0xE00D || element == 0xE0DD) {
            break;
        } else {
            pos = pos.saturating_add(len);
        }
    }

    if segments.is_empty() {
        segments.push(data);
    }

    let seg_idx = (frame_index as usize).min(segments.len().saturating_sub(1));
    let seg = segments[seg_idx];

    if seg.len() < 64 {
        return vec![0; total];
    }

    let header_count = LittleEndian::read_u32(&seg[0..4]) as usize;
    let mut offsets = Vec::with_capacity(header_count.min(samples_per_pixel as usize * bytes_per_sample));
    for i in 0..header_count.min(samples_per_pixel as usize * bytes_per_sample) {
        offsets.push(LittleEndian::read_u32(&seg[4 + i * 4..8 + i * 4]) as usize);
    }

    let num_segs = samples_per_pixel as usize * bytes_per_sample;
    let mut seg_data: Vec<Vec<u8>> = vec![Vec::new(); num_segs];

    for (i, &off) in offsets.iter().take(num_segs).enumerate() {
        if off >= seg.len() {
            continue;
        }
        let next_off = if i + 1 < offsets.len() {
            offsets[i + 1].min(seg.len())
        } else {
            seg.len()
        };
        let rle = &seg[off..next_off.min(seg.len())];

        let mut out = Vec::with_capacity((rows * columns) as usize);
        let mut j = 0;
        while j < rle.len() {
            let n = rle[j] as i8;
            j += 1;
            if n >= 0 {
                let count = (n as usize) + 1;
                let end = (j + count).min(rle.len());
                out.extend_from_slice(&rle[j..end]);
                j = end;
            } else if n != -128 {
                let count = (-(n as i16) + 1) as usize;
                if j < rle.len() {
                    let b = rle[j];
                    j += 1;
                    out.extend(std::iter::repeat(b).take(count));
                }
            }
        }
        seg_data[i] = out;
    }

    let shift = high_bit as i32 - (bits_stored as i32 - 1);
    let sign_bit = if pixel_representation == 1 && bits_stored < 16 {
        1i64 << (bits_stored - 1)
    } else {
        0
    };
    let mask = if bits_stored < 16 {
        (1i64 << bits_stored) - 1
    } else {
        0xFFFFi64
    };

    let w = columns as usize;
    let h = rows as usize;
    let mut pixels = Vec::with_capacity(total);

    for y in 0..h {
        for x in 0..w {
            let idx = y * w + x;
            for s in 0..samples_per_pixel as usize {
                let mut sample: i64 = 0;
                for b in 0..bytes_per_sample {
                    let seg_i = s * bytes_per_sample + (bytes_per_sample - 1 - b);
                    let byte = seg_data.get(seg_i).and_then(|v| v.get(idx)).copied().unwrap_or(0);
                    sample |= (byte as i64) << (b * 8);
                }
                let mut v = if shift > 0 { sample >> shift } else { sample << (-shift) };
                v &= mask;
                if sign_bit > 0 && v & sign_bit != 0 {
                    v = v - (1i64 << bits_stored);
                }
                pixels.push(v);
            }
        }
    }

    pixels.truncate(total);
    if pixels.len() < total {
        pixels.resize(total, 0);
    }
    pixels
}

pub fn generate_thumbnail(pixel_data: &PixelData) -> Vec<u8> {
    let max_size = 64u32;
    let scale_x = pixel_data.width as f64 / max_size as f64;
    let scale_y = pixel_data.height as f64 / max_size as f64;
    let scale = scale_x.max(scale_y);
    let thumb_w = ((pixel_data.width as f64 / scale) as u32).max(1);
    let thumb_h = ((pixel_data.height as f64 / scale) as u32).max(1);

    let mut min_val = f64::MAX;
    let mut max_val = f64::MIN;
    for &p in &pixel_data.pixels {
        min_val = min_val.min(p);
        max_val = max_val.max(p);
    }
    if min_val == f64::MAX {
        min_val = 0.0;
        max_val = 1.0;
    }

    let ww = (max_val - min_val).max(1.0);
    let wl = (max_val + min_val) / 2.0;

    let mut rgba = Vec::with_capacity((thumb_w * thumb_h * 4) as usize);
    for y in 0..thumb_h {
        for x in 0..thumb_w {
            let src_x = (x as f64 * scale) as usize;
            let src_y = (y as f64 * scale) as usize;
            let idx = (src_y.min(pixel_data.height as usize - 1)) * pixel_data.width as usize
                + src_x.min(pixel_data.width as usize - 1);
            let pixel_val = pixel_data.pixels.get(idx).copied().unwrap_or(0.0);

            let gray = apply_single_window(pixel_val, ww, wl, &pixel_data.photometric_interpretation);
            rgba.push(gray);
            rgba.push(gray);
            rgba.push(gray);
            rgba.push(255);
        }
    }

    let img = match image::RgbaImage::from_raw(thumb_w, thumb_h, rgba) {
        Some(img) => img,
        None => {
            let mut blank = image::RgbaImage::new(thumb_w, thumb_h);
            for pixel in blank.pixels_mut() {
                *pixel = image::Rgba([0, 0, 0, 255]);
            }
            blank
        }
    };

    let mut png_data = Vec::new();
    {
        let mut cursor = std::io::Cursor::new(&mut png_data);
        let encoder = image::codecs::png::PngEncoder::new(&mut cursor);
        use image::ImageEncoder;
        let _ = encoder.write_image(
            img.as_raw(),
            img.width(),
            img.height(),
            image::ColorType::Rgba8.into(),
        );
    }
    png_data
}

fn apply_single_window(value: f64, window_width: f64, window_center: f64, photometric: &str) -> u8 {
    let ww = window_width.max(1.0);
    let low = window_center - ww / 2.0;
    let high = window_center + ww / 2.0;

    let normalized = if value <= low {
        0.0
    } else if value >= high {
        1.0
    } else {
        (value - low) / ww
    };

    let gray = (normalized * 255.0).round() as u8;
    if photometric == "MONOCHROME1" {
        255 - gray
    } else {
        gray
    }
}

fn is_dicom_file(path: &Path) -> bool {
    match path.extension() {
        Some(ext) => {
            let ext = ext.to_string_lossy().to_lowercase();
            ext == "dcm" || ext == "dicom" || ext.is_empty()
        }
        None => false,
    }
}

#[tauri::command]
pub fn open_dicom_file(
    state: tauri::State<std::sync::Mutex<crate::AppState>>,
    path: String,
) -> Result<String, String> {
    let path = PathBuf::from(&path);
    if !is_dicom_file(&path) {
        return Err("Not a DICOM file".to_string());
    }

    let (instance, _tags) = parse_dicom_file(&path).map_err(|e| e.to_string())?;

    let study_uid = get_tag_value(&instance.tags, 0x0020, 0x000D).unwrap_or_else(|| "unknown".to_string());
    let series_uid = get_tag_value(&instance.tags, 0x0020, 0x000E).unwrap_or_else(|| "unknown".to_string());

    let patient = PatientInfo {
        name: get_tag_value(&instance.tags, 0x0010, 0x0010).unwrap_or_default(),
        id: get_tag_value(&instance.tags, 0x0010, 0x0020).unwrap_or_default(),
        birth_date: get_tag_value(&instance.tags, 0x0010, 0x0030).unwrap_or_default(),
    };

    let study_info = StudyInfo {
        study_uid: study_uid.clone(),
        study_date: get_tag_value(&instance.tags, 0x0008, 0x0020).unwrap_or_default(),
        study_description: get_tag_value(&instance.tags, 0x0008, 0x1030).unwrap_or_default(),
        modality: get_tag_value(&instance.tags, 0x0008, 0x0060).unwrap_or_default(),
        institution: get_tag_value(&instance.tags, 0x0008, 0x0080).unwrap_or_default(),
        patient,
    };

    let frame_time = get_tag_value(&instance.tags, 0x0018, 0x1063)
        .and_then(|v| v.parse::<f64>().ok());

    let series_number = get_tag_value(&instance.tags, 0x0020, 0x0011)
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(0);

    let mut state = state.lock().unwrap();

    if !state.studies.contains_key(&study_uid) {
        state.studies.insert(study_uid.clone(), Study {
            info: study_info,
            series: HashMap::new(),
        });
    }

    let study = state.studies.get_mut(&study_uid).unwrap();
    if !study.series.contains_key(&series_uid) {
        study.series.insert(series_uid.clone(), Series {
            info: SeriesInfo {
                series_uid: series_uid.clone(),
                series_description: get_tag_value(&instance.tags, 0x0008, 0x103E).unwrap_or_default(),
                series_number,
                modality: study.info.modality.clone(),
                instance_count: 0,
                thumbnail: None,
                is_multiframe: instance.info.number_of_frames > 1,
                number_of_frames: instance.info.number_of_frames,
                frame_time,
            },
            instances: Vec::new(),
        });
    }

    let series = study.series.get_mut(&series_uid).unwrap();
    series.instances.push(instance);
    series.instances.sort_by(|a, b| a.info.instance_number.cmp(&b.info.instance_number));
    series.info.instance_count = series.instances.len() as u32;

    Ok(study_uid)
}

#[tauri::command]
pub fn open_dicom_directory(
    state: tauri::State<std::sync::Mutex<crate::AppState>>,
    path: String,
) -> Result<Vec<String>, String> {
    let dir_path = PathBuf::from(&path);
    if !dir_path.is_dir() {
        return Err("Not a directory".to_string());
    }

    let mut study_uids = Vec::new();
    let mut errors = Vec::new();

    for entry in WalkDir::new(&dir_path).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() && is_dicom_file(path) {
            match open_dicom_file(state.clone(), path.to_string_lossy().to_string()) {
                Ok(uid) => {
                    if !study_uids.contains(&uid) {
                        study_uids.push(uid);
                    }
                }
                Err(e) => {
                    errors.push(format!("{}: {}", path.display(), e));
                }
            }
        }
    }

    if study_uids.is_empty() && !errors.is_empty() {
        return Err(errors.join("\n"));
    }

    Ok(study_uids)
}

#[tauri::command]
pub fn get_studies(
    state: tauri::State<std::sync::Mutex<crate::AppState>>,
) -> Vec<StudyInfo> {
    let state = state.lock().unwrap();
    state.studies.values().map(|s| s.info.clone()).collect()
}

#[tauri::command]
pub fn get_series_info(
    state: tauri::State<std::sync::Mutex<crate::AppState>>,
    study_uid: String,
) -> Result<Vec<SeriesInfo>, String> {
    let mut state = state.lock().unwrap();
    let study = state.studies.get_mut(&study_uid).ok_or("Study not found")?;

    for series in study.series.values_mut() {
        if series.info.thumbnail.is_none() && !series.instances.is_empty() {
            let mid_idx = series.instances.len() / 2;
            let mid_instance = &series.instances[mid_idx];
            if let Ok(pixel_data) = extract_pixel_data(Path::new(&mid_instance.file_path), 0) {
                series.info.thumbnail = Some(generate_thumbnail(&pixel_data));
            }
        }
    }

    Ok(study.series.values().map(|s| s.info.clone()).collect())
}

#[tauri::command]
pub fn get_series_thumbnail(
    state: tauri::State<std::sync::Mutex<crate::AppState>>,
    study_uid: String,
    series_uid: String,
) -> Result<Vec<u8>, String> {
    let state = state.lock().unwrap();
    let study = state.studies.get(&study_uid).ok_or("Study not found")?;
    let series = study.series.get(&series_uid).ok_or("Series not found")?;
    series.info.thumbnail.clone().ok_or("No thumbnail".to_string())
}

#[tauri::command]
pub fn get_instance_pixel_data(
    state: tauri::State<std::sync::Mutex<crate::AppState>>,
    study_uid: String,
    series_uid: String,
    instance_index: u32,
    frame_index: u32,
) -> Result<crate::image_proc::PixelDataResponse, String> {
    let state = state.lock().unwrap();
    let study = state.studies.get(&study_uid).ok_or("Study not found")?;
    let series = study.series.get(&series_uid).ok_or("Series not found")?;
    let instance = series.instances.get(instance_index as usize).ok_or("Instance not found")?;

    let pixel_data = extract_pixel_data(Path::new(&instance.file_path), frame_index)?;

    let mut min_val = f64::MAX;
    let mut max_val = f64::MIN;
    for &p in &pixel_data.pixels {
        min_val = min_val.min(p);
        max_val = max_val.max(p);
    }

    let default_ww = instance.info.window_width.as_ref().and_then(|w| w.first()).copied();
    let default_wl = instance.info.window_center.as_ref().and_then(|w| w.first()).copied();

    Ok(crate::image_proc::PixelDataResponse {
        width: pixel_data.width,
        height: pixel_data.height,
        frames: pixel_data.frames,
        pixels: pixel_data.pixels,
        photometric_interpretation: pixel_data.photometric_interpretation,
        rescale_slope: pixel_data.rescale_slope,
        rescale_intercept: pixel_data.rescale_intercept,
        default_window_width: default_ww,
        default_window_center: default_wl,
        pixel_spacing: instance.info.pixel_spacing,
        slice_thickness: instance.info.slice_thickness,
        slice_location: instance.info.slice_location,
        image_position_patient: instance.info.image_position_patient,
        image_orientation_patient: instance.info.image_orientation_patient,
        total_slices: series.instances.len() as u32,
        min_pixel_value: min_val,
        max_pixel_value: max_val,
    })
}

#[tauri::command]
pub fn get_dicom_tags(
    state: tauri::State<std::sync::Mutex<crate::AppState>>,
    study_uid: String,
    series_uid: String,
    instance_index: u32,
) -> Result<Vec<DicomTag>, String> {
    let state = state.lock().unwrap();
    let study = state.studies.get(&study_uid).ok_or("Study not found")?;
    let series = study.series.get(&series_uid).ok_or("Series not found")?;
    let instance = series.instances.get(instance_index as usize).ok_or("Instance not found")?;
    Ok(instance.tags.clone())
}

pub fn encode_tag_header(group: u16, element: u16, vr: &str, length: u32, is_explicit: bool, big_endian: bool) -> Vec<u8> {
    let mut out = Vec::new();
    if big_endian {
        out.extend_from_slice(&group.to_be_bytes());
        out.extend_from_slice(&element.to_be_bytes());
    } else {
        out.extend_from_slice(&group.to_le_bytes());
        out.extend_from_slice(&element.to_le_bytes());
    }
    if is_explicit {
        out.extend_from_slice(vr.as_bytes());
        let is_long_vr = vr == "OB" || vr == "OW" || vr == "OF" || vr == "SQ" || vr == "UT" || vr == "UN";
        if is_long_vr {
            out.extend_from_slice(&[0u8, 0u8]);
            if big_endian {
                out.extend_from_slice(&length.to_be_bytes());
            } else {
                out.extend_from_slice(&length.to_le_bytes());
            }
        } else {
            let len16 = length.min(0xFFFF) as u16;
            if big_endian {
                out.extend_from_slice(&len16.to_be_bytes());
            } else {
                out.extend_from_slice(&len16.to_le_bytes());
            }
        }
    } else {
        if big_endian {
            out.extend_from_slice(&length.to_be_bytes());
        } else {
            out.extend_from_slice(&length.to_le_bytes());
        }
    }
    out
}

pub fn encode_tag(tag: &DicomTag, is_explicit: bool, big_endian: bool) -> Vec<u8> {
    let value_bytes = if tag.value.is_empty() {
        Vec::new()
    } else {
        let mut bytes = tag.value.as_bytes().to_vec();
        if bytes.len() % 2 != 0 {
            if tag.vr == "UI" {
                bytes.push(0x00);
            } else {
                bytes.push(b' ');
            }
        }
        bytes
    };
    let mut out = encode_tag_header(tag.group, tag.element, &tag.vr, value_bytes.len() as u32, is_explicit, big_endian);
    out.extend_from_slice(&value_bytes);
    out
}

pub fn write_tag<W: std::io::Write>(out: &mut W, tag: &DicomTag, is_explicit: bool, big_endian: bool) -> std::io::Result<usize> {
    let bytes = encode_tag(tag, is_explicit, big_endian);
    out.write_all(&bytes)?;
    Ok(bytes.len())
}

