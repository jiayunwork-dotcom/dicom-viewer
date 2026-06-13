import type { Point, Annotation, AnnotationColor, LineMeasurement, AngleMeasurement, RectRoiMeasurement, EllipseRoiMeasurement } from '../types';

const COLOR_MAP: Record<AnnotationColor, string> = {
  red: '#ef4444',
  yellow: '#fbbf24',
  green: '#22c55e',
  blue: '#3b82f6',
};

export function getAnnotationColor(color: AnnotationColor): string {
  return COLOR_MAP[color] || '#ef4444';
}

export function pixelToCanvas(
  px: number,
  py: number,
  canvasW: number,
  canvasH: number,
  imageW: number,
  imageH: number,
  zoom: number,
  panX: number,
  panY: number,
  rotation: number,
  flipH: boolean,
  flipV: boolean
): Point {
  let x = px;
  let y = py;

  if (flipH) x = imageW - 1 - x;
  if (flipV) y = imageH - 1 - y;

  const rad = (rotation * Math.PI) / 180;
  const cx = imageW / 2;
  const cy = imageH / 2;
  const dx = x - cx;
  const dy = y - cy;
  x = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
  y = cy + dx * Math.sin(rad) + dy * Math.cos(rad);

  const scaleX = (canvasW / imageW) * zoom;
  const scaleY = (canvasH / imageH) * zoom;
  const scale = Math.min(scaleX, scaleY);

  const offsetX = (canvasW - imageW * scale) / 2 + panX;
  const offsetY = (canvasH - imageH * scale) / 2 + panY;

  return {
    x: x * scale + offsetX,
    y: y * scale + offsetY,
  };
}

export function canvasToPixel(
  cx: number,
  cy: number,
  canvasW: number,
  canvasH: number,
  imageW: number,
  imageH: number,
  zoom: number,
  panX: number,
  panY: number,
  rotation: number,
  flipH: boolean,
  flipV: boolean
): Point {
  const scaleX = (canvasW / imageW) * zoom;
  const scaleY = (canvasH / imageH) * zoom;
  const scale = Math.min(scaleX, scaleY);

  const offsetX = (canvasW - imageW * scale) / 2 + panX;
  const offsetY = (canvasH - imageH * scale) / 2 + panY;

  let x = (cx - offsetX) / scale;
  let y = (cy - offsetY) / scale;

  const rad = (-rotation * Math.PI) / 180;
  const imgCx = imageW / 2;
  const imgCy = imageH / 2;
  const dx = x - imgCx;
  const dy = y - imgCy;
  x = imgCx + dx * Math.cos(rad) - dy * Math.sin(rad);
  y = imgCy + dx * Math.sin(rad) + dy * Math.cos(rad);

  if (flipH) x = imageW - 1 - x;
  if (flipV) y = imageH - 1 - y;

  return {
    x: Math.max(0, Math.min(imageW - 1, x)),
    y: Math.max(0, Math.min(imageH - 1, y)),
  };
}

export function drawImage(
  ctx: CanvasRenderingContext2D,
  rgbaData: Uint8ClampedArray,
  width: number,
  height: number,
  canvasW: number,
  canvasH: number,
  zoom: number,
  panX: number,
  panY: number,
  rotation: number,
  flipH: boolean,
  flipV: boolean
) {
  const scaleX = (canvasW / width) * zoom;
  const scaleY = (canvasH / height) * zoom;
  const scale = Math.min(scaleX, scaleY);

  const offsetX = (canvasW - width * scale) / 2 + panX;
  const offsetY = (canvasH - height * scale) / 2 + panY;

  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  if (rotation !== 0 || flipH || flipV) {
    ctx.translate(width / 2, height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.translate(-width / 2, -height / 2);
  }

  const imageData = new ImageData(rgbaData as unknown as Uint8ClampedArray<ArrayBuffer>, width, height);
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.putImageData(imageData, 0, 0);
  ctx.drawImage(tempCanvas, 0, 0);

  ctx.restore();
}

export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  canvasW: number,
  canvasH: number,
  imageW: number,
  imageH: number,
  zoom: number,
  panX: number,
  panY: number,
  rotation: number,
  flipH: boolean,
  flipV: boolean,
  pixelSpacing: [number, number] | null,
  selectedId: string | null
) {
  for (const ann of annotations) {
    const color = getAnnotationColor(ann.color);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = selectedId === ann.id ? 3 : 2;
    ctx.font = '12px monospace';

    switch (ann.type) {
      case 'line':
        drawLineMeasurement(ctx, ann, canvasW, canvasH, imageW, imageH, zoom, panX, panY, rotation, flipH, flipV, pixelSpacing);
        break;
      case 'angle':
        drawAngleMeasurement(ctx, ann, canvasW, canvasH, imageW, imageH, zoom, panX, panY, rotation, flipH, flipV);
        break;
      case 'rect_roi':
      case 'ellipse_roi':
        drawRoiMeasurement(ctx, ann, canvasW, canvasH, imageW, imageH, zoom, panX, panY, rotation, flipH, flipV, pixelSpacing);
        break;
      case 'arrow':
        drawArrowAnnotation(ctx, ann, canvasW, canvasH, imageW, imageH, zoom, panX, panY, rotation, flipH, flipV);
        break;
      case 'text':
        drawTextAnnotation(ctx, ann, canvasW, canvasH, imageW, imageH, zoom, panX, panY, rotation, flipH, flipV);
        break;
      case 'brush':
        drawBrushAnnotation(ctx, ann, canvasW, canvasH, imageW, imageH, zoom, panX, panY, rotation, flipH, flipV);
        break;
    }
  }
}

function drawLineMeasurement(
  ctx: CanvasRenderingContext2D,
  ann: LineMeasurement,
  canvasW: number,
  canvasH: number,
  imageW: number,
  imageH: number,
  zoom: number,
  panX: number,
  panY: number,
  rotation: number,
  flipH: boolean,
  flipV: boolean,
  pixelSpacing: [number, number] | null
) {
  const p1 = pixelToCanvas(ann.start.x, ann.start.y, canvasW, canvasH, imageW, imageH, zoom, panX, panY, rotation, flipH, flipV);
  const p2 = pixelToCanvas(ann.end.x, ann.end.y, canvasW, canvasH, imageW, imageH, zoom, panX, panY, rotation, flipH, flipV);

  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  [p1, p2].forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  const label = pixelSpacing
    ? `${ann.distance.toFixed(2)} mm`
    : `${Math.hypot(ann.end.x - ann.start.x, ann.end.y - ann.start.y).toFixed(2)} px`;

  ctx.fillStyle = '#000';
  ctx.fillRect(midX - 4, midY - 14, ctx.measureText(label).width + 8, 16);
  ctx.fillStyle = getAnnotationColor(ann.color);
  ctx.fillText(label, midX, midY - 2);
}

function drawAngleMeasurement(
  ctx: CanvasRenderingContext2D,
  ann: AngleMeasurement,
  canvasW: number,
  canvasH: number,
  imageW: number,
  imageH: number,
  zoom: number,
  panX: number,
  panY: number,
  rotation: number,
  flipH: boolean,
  flipV: boolean
) {
  const pts = ann.points.map(p =>
    pixelToCanvas(p.x, p.y, canvasW, canvasH, imageW, imageH, zoom, panX, panY, rotation, flipH, flipV)
  );

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  ctx.lineTo(pts[1].x, pts[1].y);
  ctx.lineTo(pts[2].x, pts[2].y);
  ctx.stroke();

  pts.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  const label = `${ann.angle.toFixed(2)}°`;
  const vx = pts[1].x;
  const vy = pts[1].y;

  ctx.fillStyle = '#000';
  ctx.fillRect(vx - 4, vy - 14, ctx.measureText(label).width + 8, 16);
  ctx.fillStyle = getAnnotationColor(ann.color);
  ctx.fillText(label, vx, vy - 2);
}

function drawRoiMeasurement(
  ctx: CanvasRenderingContext2D,
  ann: RectRoiMeasurement | EllipseRoiMeasurement,
  canvasW: number,
  canvasH: number,
  imageW: number,
  imageH: number,
  zoom: number,
  panX: number,
  panY: number,
  rotation: number,
  flipH: boolean,
  flipV: boolean,
  pixelSpacing: [number, number] | null
) {
  const tl = pixelToCanvas(ann.x, ann.y, canvasW, canvasH, imageW, imageH, zoom, panX, panY, rotation, flipH, flipV);
  const br = pixelToCanvas(ann.x + ann.width, ann.y + ann.height, canvasW, canvasH, imageW, imageH, zoom, panX, panY, rotation, flipH, flipV);

  const w = Math.abs(br.x - tl.x);
  const h = Math.abs(br.y - tl.y);
  const x = Math.min(tl.x, br.x);
  const y = Math.min(tl.y, br.y);

  ctx.beginPath();
  if (ann.type === 'rect_roi') {
    ctx.rect(x, y, w, h);
  } else {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  }
  ctx.stroke();

  const lines = [
    `Mean: ${ann.mean.toFixed(2)}`,
    `Std: ${ann.std.toFixed(2)}`,
    `Min: ${ann.min.toFixed(2)} Max: ${ann.max.toFixed(2)}`,
    pixelSpacing ? `Area: ${ann.area.toFixed(2)} mm²` : `Area: ${ann.area.toFixed(0)} px²`,
  ];

  const maxWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x, y - lines.length * 14 - 8, maxWidth + 8, lines.length * 14 + 8);
  ctx.fillStyle = getAnnotationColor(ann.color);
  lines.forEach((line, i) => {
    ctx.fillText(line, x + 4, y - (lines.length - i) * 14 - 2);
  });
}

function drawArrowAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: { start: Point; end: Point; text: string; color: AnnotationColor },
  canvasW: number,
  canvasH: number,
  imageW: number,
  imageH: number,
  zoom: number,
  panX: number,
  panY: number,
  rotation: number,
  flipH: boolean,
  flipV: boolean
) {
  const p1 = pixelToCanvas(ann.start.x, ann.start.y, canvasW, canvasH, imageW, imageH, zoom, panX, panY, rotation, flipH, flipV);
  const p2 = pixelToCanvas(ann.end.x, ann.end.y, canvasW, canvasH, imageW, imageH, zoom, panX, panY, rotation, flipH, flipV);

  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const headLen = 10;
  ctx.beginPath();
  ctx.moveTo(p2.x, p2.y);
  ctx.lineTo(p2.x - headLen * Math.cos(angle - Math.PI / 6), p2.y - headLen * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(p2.x, p2.y);
  ctx.lineTo(p2.x - headLen * Math.cos(angle + Math.PI / 6), p2.y - headLen * Math.sin(angle + Math.PI / 6));
  ctx.stroke();

  if (ann.text) {
    ctx.fillStyle = '#000';
    ctx.fillRect(p2.x + 8, p2.y - 12, ctx.measureText(ann.text).width + 8, 16);
    ctx.fillStyle = getAnnotationColor(ann.color);
    ctx.fillText(ann.text, p2.x + 12, p2.y);
  }
}

function drawTextAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: { position: Point; text: string; color: AnnotationColor },
  canvasW: number,
  canvasH: number,
  imageW: number,
  imageH: number,
  zoom: number,
  panX: number,
  panY: number,
  rotation: number,
  flipH: boolean,
  flipV: boolean
) {
  const p = pixelToCanvas(ann.position.x, ann.position.y, canvasW, canvasH, imageW, imageH, zoom, panX, panY, rotation, flipH, flipV);

  ctx.fillStyle = '#000';
  ctx.fillRect(p.x, p.y - 12, ctx.measureText(ann.text).width + 8, 16);
  ctx.fillStyle = getAnnotationColor(ann.color);
  ctx.fillText(ann.text, p.x + 4, p.y);
}

function drawBrushAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: { points: Point[]; color: AnnotationColor },
  canvasW: number,
  canvasH: number,
  imageW: number,
  imageH: number,
  zoom: number,
  panX: number,
  panY: number,
  rotation: number,
  flipH: boolean,
  flipV: boolean
) {
  if (ann.points.length < 2) return;

  ctx.beginPath();
  const first = pixelToCanvas(ann.points[0].x, ann.points[0].y, canvasW, canvasH, imageW, imageH, zoom, panX, panY, rotation, flipH, flipV);
  ctx.moveTo(first.x, first.y);

  for (let i = 1; i < ann.points.length; i++) {
    const p = pixelToCanvas(ann.points[i].x, ann.points[i].y, canvasW, canvasH, imageW, imageH, zoom, panX, panY, rotation, flipH, flipV);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

export function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string = '#ef4444'
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);

  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(ctx.canvas.width, y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, ctx.canvas.height);
  ctx.stroke();

  ctx.setLineDash([]);
}

export function calculateDistance(
  p1: Point,
  p2: Point,
  pixelSpacing: [number, number] | null
): number {
  const dx = (p2.x - p1.x) * (pixelSpacing?.[0] || 1);
  const dy = (p2.y - p1.y) * (pixelSpacing?.[1] || 1);
  return Math.hypot(dx, dy);
}

export function calculateAngle(p1: Point, vertex: Point, p2: Point): number {
  const v1x = p1.x - vertex.x;
  const v1y = p1.y - vertex.y;
  const v2x = p2.x - vertex.x;
  const v2y = p2.y - vertex.y;

  const dot = v1x * v2x + v1y * v2y;
  const mag1 = Math.hypot(v1x, v1y);
  const mag2 = Math.hypot(v2x, v2y);

  if (mag1 === 0 || mag2 === 0) return 0;

  const cos = dot / (mag1 * mag2);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

export function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}
