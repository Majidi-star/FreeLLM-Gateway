export function sanitizeForClipboard(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n/g, '\n')
    .trimEnd();
}
