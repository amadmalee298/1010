/**
 * Browser-only: shrink a photo before upload. iPhone photos are often 3–6 MB (and may be HEIC),
 * while product images are capped at 2 MB and Server Action bodies at 1 MB. The photo is drawn on a
 * canvas at most `maxSide` px wide/high and re-encoded as JPEG, lowering quality until it fits
 * `maxBytes`. Re-encoding also drops EXIF data such as the GPS location.
 */
export async function shrinkImage(file: File, { maxSide = 1200, maxBytes = 900 * 1024 } = {}): Promise<File> {
  const source = await decode(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.fillStyle = '#fff'; // transparent PNG areas become white instead of black
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source.image, 0, 0, width, height);
    for (const quality of [0.85, 0.75, 0.65, 0.5]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= maxBytes) {
        const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
        return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
      }
    }
    throw new Error('image too large');
  } finally {
    source.close();
  }
}

type Decoded = { image: CanvasImageSource; width: number; height: number; close: () => void };

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { image: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // fall through: some browsers cannot decode every format this way (e.g. HEIC on older Safari)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}
