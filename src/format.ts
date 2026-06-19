export function formatRelativeTime(isoTimestamp: string): string {
  if (!isoTimestamp) return '';

  const diff = Date.now() - new Date(isoTimestamp).getTime();
  const totalSec = Math.floor(diff / 1000);
  const totalMin = Math.floor(totalSec / 60);
  const totalHr = Math.floor(totalMin / 60);
  const totalDay = Math.floor(totalHr / 24);
  const totalWk = Math.floor(totalDay / 7);
  const totalMo = Math.floor(totalDay / 30);
  const totalYr = Math.floor(totalDay / 365);

  if (totalSec < 10) return 'just now';
  if (totalSec < 60) return `${totalSec} sec ago`;
  if (totalMin < 60) return `${totalMin} min ago`;
  if (totalHr < 24) {
    const remMin = totalMin - totalHr * 60;
    return remMin > 0 ? `${totalHr} hr ${remMin} min ago` : `${totalHr} hr ago`;
  }
  if (totalDay < 14) return totalDay === 1 ? '1 day ago' : `${totalDay} days ago`;
  if (totalDay < 30) return totalWk === 1 ? '1 wk ago' : `${totalWk} wks ago`;
  if (totalMo < 12) return totalMo === 1 ? '1 mo ago' : `${totalMo} mo ago`;
  return totalYr === 1 ? '1 yr ago' : `${totalYr} yrs ago`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function visibleWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0) ?? 0;
    // CJK and fullwidth character ranges (double-width in terminal)
    if (
      (cp >= 0x1100 && cp <= 0x115F) ||
      (cp >= 0x2E80 && cp <= 0x303E) ||
      (cp >= 0x3041 && cp <= 0x33BF) ||
      (cp >= 0x33FF && cp <= 0xA4CF) ||
      (cp >= 0xAC00 && cp <= 0xD7AF) ||
      (cp >= 0xF900 && cp <= 0xFAFF) ||
      (cp >= 0xFE10 && cp <= 0xFE1F) ||
      (cp >= 0xFE30 && cp <= 0xFE6F) ||
      (cp >= 0xFF01 && cp <= 0xFF60) ||
      (cp >= 0xFFE0 && cp <= 0xFFE6) ||
      (cp >= 0x1F300 && cp <= 0x1F9FF)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}
