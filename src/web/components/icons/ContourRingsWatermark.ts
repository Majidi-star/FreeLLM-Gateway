export interface ContourRingsWatermarkOptions {
  variant?: 'dashboard' | 'compact';
  className?: string;
  strokeWidth?: string;
}

export function getContourRingsWatermarkSvg(options: ContourRingsWatermarkOptions = {}): string {
  const {
    variant = 'dashboard',
    className = 'w-48 h-40 text-mint opacity-15 pointer-events-none',
    strokeWidth = '1.8',
  } = options;

  if (variant === 'compact') {
    return `<svg class="${className}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" viewBox="0 0 100 100" aria-hidden="true"><circle cx="80" cy="80" r="30"/><circle cx="80" cy="80" r="50" stroke-dasharray="4 4"/><circle cx="80" cy="80" r="70"/></svg>`;
  }

  return `<svg class="${className}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" viewBox="0 0 160 120" aria-hidden="true"><circle cx="130" cy="90" r="30"/><circle cx="130" cy="90" r="55" stroke-dasharray="3 3"/><circle cx="130" cy="90" r="80"/><circle cx="130" cy="90" r="105" stroke-dasharray="4 4"/></svg>`;
}
