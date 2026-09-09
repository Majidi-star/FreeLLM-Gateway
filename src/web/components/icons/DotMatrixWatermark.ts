export interface DotMatrixWatermarkOptions {
  patternId?: string;
  className?: string;
}

export function getDotMatrixWatermarkSvg(options: DotMatrixWatermarkOptions = {}): string {
  const {
    patternId = 'dot-matrix-pattern',
    className = 'w-32 h-32 opacity-15 text-gray-400 pointer-events-none',
  } = options;

  return `<svg class="${className}" fill="currentColor" viewBox="0 0 100 100" aria-hidden="true"><defs><pattern id="${patternId}" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.5" fill="currentColor"/></pattern></defs><rect width="100" height="100" fill="url(#${patternId})"/></svg>`;
}
