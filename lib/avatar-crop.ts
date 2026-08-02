export interface AvatarCropLayout {
  sourceWidth: number;
  sourceHeight: number;
  cropSize: number;
  baseScale: number;
  baseWidth: number;
  baseHeight: number;
}

export interface AvatarCropTransform {
  zoom: number;
  translateX: number;
  translateY: number;
}

export interface AvatarCropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function getAvatarCropLayout(
  sourceWidth: number,
  sourceHeight: number,
  cropSize: number,
): AvatarCropLayout {
  const safeWidth = Math.max(1, sourceWidth);
  const safeHeight = Math.max(1, sourceHeight);
  const safeCropSize = Math.max(1, cropSize);
  const baseScale = Math.max(safeCropSize / safeWidth, safeCropSize / safeHeight);

  return {
    sourceWidth: safeWidth,
    sourceHeight: safeHeight,
    cropSize: safeCropSize,
    baseScale,
    baseWidth: safeWidth * baseScale,
    baseHeight: safeHeight * baseScale,
  };
}

export function constrainAvatarCropTranslation(
  layout: AvatarCropLayout,
  zoom: number,
  translateX: number,
  translateY: number,
): Pick<AvatarCropTransform, 'translateX' | 'translateY'> {
  const safeZoom = Math.max(1, zoom);
  const maxX = Math.max(0, (layout.baseWidth * safeZoom - layout.cropSize) / 2);
  const maxY = Math.max(0, (layout.baseHeight * safeZoom - layout.cropSize) / 2);

  return {
    translateX: clamp(translateX, -maxX, maxX),
    translateY: clamp(translateY, -maxY, maxY),
  };
}

export function getAvatarCropRect(
  layout: AvatarCropLayout,
  transform: AvatarCropTransform,
): AvatarCropRect {
  const zoom = Math.max(1, transform.zoom);
  const translation = constrainAvatarCropTranslation(
    layout,
    zoom,
    transform.translateX,
    transform.translateY,
  );
  const displayScale = layout.baseScale * zoom;
  const displayedWidth = layout.sourceWidth * displayScale;
  const displayedHeight = layout.sourceHeight * displayScale;
  const imageLeft = (layout.cropSize - displayedWidth) / 2 + translation.translateX;
  const imageTop = (layout.cropSize - displayedHeight) / 2 + translation.translateY;
  const width = Math.min(layout.sourceWidth, Math.max(1, Math.round(layout.cropSize / displayScale)));
  const height = Math.min(layout.sourceHeight, Math.max(1, Math.round(layout.cropSize / displayScale)));

  return {
    originX: clamp(Math.round(-imageLeft / displayScale), 0, layout.sourceWidth - width),
    originY: clamp(Math.round(-imageTop / displayScale), 0, layout.sourceHeight - height),
    width,
    height,
  };
}
