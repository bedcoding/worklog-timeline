export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const ACCEPT_ATTR = ACCEPTED_IMAGE_TYPES.join(',');
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** 받을 수 없는 파일이면 이유를, 괜찮으면 null 을 돌려줍니다 */
export function validateImage(file: Blob): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return 'PNG, JPG, WebP, GIF 이미지만 넣을 수 있어요.';
  if (file.size > MAX_IMAGE_BYTES) return '이미지는 10MB 이하만 넣을 수 있어요.';
  return null;
}

/** 붙여넣기(Ctrl+V)에 들어 있는 이미지 파일. 캡처 도구로 복사한 화면도 여기로 들어옵니다. */
export function imagesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (!files.length) {
    for (const file of Array.from(data.files ?? [])) if (file.type.startsWith('image/')) files.push(file);
  }
  return files.map((file, i) => renamePasted(file, i));
}

export function imagesFromDrop(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files ?? []).filter((f) => f.type.startsWith('image/'));
}

export function hasFiles(data: DataTransfer | null): boolean {
  return !!data && Array.from(data.types ?? []).includes('Files');
}

/** 붙여넣은 캡처는 이름이 image.png 로 똑같아서 시각을 붙여 구분합니다 */
function renamePasted(file: File, index: number): File {
  if (file.name && file.name !== 'image.png') return file;
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const ext = file.type.split('/')[1] || 'png';
  return new File([file], `capture-${stamp}${index ? '-' + (index + 1) : ''}.${ext}`, { type: file.type });
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('파일을 읽지 못했어요.'));
    reader.readAsDataURL(blob);
  });
}

/** 저장 서버에서 이미지 원본을 받아 옵니다(내보내기와 백업에 씀) */
export async function fetchImageBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('이미지 파일을 읽지 못했어요.');
  return res.blob();
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 열지 못했어요.'));
    img.src = url;
  });
}

/** 이미지의 원래 크기(px) */
export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 이미지가 실제로 열리는지 확인합니다(확장자만 이미지인 깨진 파일 걸러내기) */
export async function checkDecodable(blob: Blob): Promise<boolean> {
  const url = URL.createObjectURL(blob);
  try {
    await loadImage(url);
    return true;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface Png {
  data: ArrayBuffer;
  width: number;
  height: number;
}

/** Word 문서에 넣기 위해 PNG로 바꿉니다. SVG 예시 이미지도 이 과정을 거칩니다. */
export async function blobToPng(blob: Blob, maxWidth = 1400): Promise<Png> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const naturalW = img.naturalWidth || 1200;
    const naturalH = img.naturalHeight || 675;
    const scale = Math.min(1, maxWidth / naturalW);
    const width = Math.max(1, Math.round(naturalW * scale));
    const height = Math.max(1, Math.round(naturalH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('이미지를 변환하지 못했어요.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 변환하지 못했어요.'))), 'image/png'),
    );
    return { data: await png.arrayBuffer(), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
