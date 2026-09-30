/** 업로드한 사진을 긴 변 maxSide 이하로 줄여 dataURL로 변환 (저장 용량 절약) */
export function fileToDataUrl(file: File, maxSide = 2400): Promise<{ src: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * s);
      const h = Math.round(img.height * s);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const isPng = file.type === 'image/png';
      resolve({ src: c.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.9), width: w, height: h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 읽을 수 없습니다'));
    };
    img.src = url;
  });
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
