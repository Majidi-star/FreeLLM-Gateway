export interface WavesWatermarkOptions {
  variant?: 'dashboard' | 'studio';
  className?: string;
  strokeWidth?: string;
}

export function getWavesWatermarkSvg(options: WavesWatermarkOptions = {}): string {
  const {
    variant = 'dashboard',
    className = 'w-48 h-40 text-accent opacity-15 pointer-events-none',
    strokeWidth = '1.8',
  } = options;

  if (variant === 'studio') {
    return `<svg class="${className}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" viewBox="0 0 300 120" aria-hidden="true"><path d="M0 60 C50 20, 100 100, 150 60 C200 20, 250 100, 300 60"/><path d="M0 90 C50 50, 100 130, 150 90 C200 50, 250 130, 300 90"/><path d="M0 30 C50 -10, 100 70, 150 30 C200 -10, 250 70, 300 30"/></svg>`;
  }

  return `<svg class="${className}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" viewBox="0 0 160 120" aria-hidden="true"><path d="M0 60 C40 30, 80 90, 120 60 C140 45, 160 55, 180 65"/><path d="M0 80 C40 50, 80 110, 120 80 C140 65, 160 75, 180 85"/><path d="M0 100 C40 70, 80 130, 120 100 C140 85, 160 95, 180 105"/></svg>`;
}
