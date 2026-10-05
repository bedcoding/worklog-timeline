/** 파일 내려받기. 브라우저 다운로드 폴더에 저장됩니다. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  // 다운로드가 시작될 시간을 준 뒤 주소를 정리합니다
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** 20261004 */
export function fileStamp(iso: string): string {
  return iso.replaceAll('-', '');
}
