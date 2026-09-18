import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ModelDetail } from './ModelCompareModal.js';
import { Sliders, Maximize2, ZoomIn, ZoomOut, RotateCcw, Move, Tag, Eye } from 'lucide-react';

export type MetricKey =
  | 'benchReasoningScore'
  | 'benchCodingScore'
  | 'benchMathScore'
  | 'benchVisionScore'
  | 'benchLongContextScore'
  | 'benchCommandScore'
  | 'benchTps'
  | 'benchP95LatencyMs'
  | 'costInputPer1k'
  | 'contextWindow';

export interface MetricOption {
  key: MetricKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  invertAxis?: boolean;
}

export const METRIC_OPTIONS: MetricOption[] = [
  { key: 'benchReasoningScore', label: 'Reasoning Score', unit: 'pts', min: 0, max: 100 },
  { key: 'benchCodingScore', label: 'Coding Score', unit: 'pts', min: 0, max: 100 },
  { key: 'benchMathScore', label: 'Math Score', unit: 'pts', min: 0, max: 100 },
  { key: 'benchVisionScore', label: 'Vision Score', unit: 'pts', min: 0, max: 100 },
  { key: 'benchLongContextScore', label: 'Long Context Fitness', unit: 'pts', min: 0, max: 100 },
  { key: 'benchCommandScore', label: 'Command Execution', unit: 'pts', min: 0, max: 100 },
  { key: 'benchTps', label: 'Throughput (TPS)', unit: 'tok/s', min: 0, max: 200 },
  { key: 'benchP95LatencyMs', label: 'P95 Latency', unit: 'ms', min: 0, max: 5000, invertAxis: true },
  { key: 'costInputPer1k', label: 'Input Cost (per 1K)', unit: '$', min: 0, max: 0.01, invertAxis: true },
  { key: 'contextWindow', label: 'Context Window', unit: 'tokens', min: 0, max: 2000000 },
];

const PROVIDER_COLORS: Record<string, string> = {
  groq: '#10b981', // emerald
  openrouter: '#06b6d4', // cyan
  gemini: '#8b5cf6', // purple
  openai: '#3b82f6', // blue
  anthropic: '#f59e0b', // amber
  deepseek: '#ec4899', // pink
  together: '#f97316', // orange
  ollama: '#84cc16', // lime
  vllm: '#14b8a6', // teal
};

const getProviderColor = (providerSlug: string): string => {
  const slug = providerSlug.toLowerCase();
  for (const [key, color] of Object.entries(PROVIDER_COLORS)) {
    if (slug.includes(key)) return color;
  }
  return '#6366f1';
};

interface BenchmarkMatrixChartProps {
  models: ModelDetail[];
  selectedModelIds: string[];
  onToggleSelectModel: (modelId: string) => void;
  onOpenCompareModal: () => void;
}

export const BenchmarkMatrixChart: React.FC<BenchmarkMatrixChartProps> = ({
  models,
  selectedModelIds,
  onToggleSelectModel,
  onOpenCompareModal,
}) => {
  const [xAxisKey, setXAxisKey] = useState<MetricKey>('benchReasoningScore');
  const [yAxisKey, setYAxisKey] = useState<MetricKey>('benchCodingScore');
  const [hoveredModel, setHoveredModel] = useState<ModelDetail | null>(null);
  const [filterProvider, setFilterProvider] = useState<string>('all');
  const [labelMode, setLabelMode] = useState<'hover' | 'all'>('hover'); // Clean text decluttering

  // Zoom & Pan State
  const [zoomLevel, setZoomLevel] = useState<number>(1.0); // 1.0x to 4.0x
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const chartContainerRef = useRef<HTMLDivElement>(null);

  const xMetric = useMemo(() => METRIC_OPTIONS.find((m) => m.key === xAxisKey) || METRIC_OPTIONS[0], [xAxisKey]);
  const yMetric = useMemo(() => METRIC_OPTIONS.find((m) => m.key === yAxisKey) || METRIC_OPTIONS[1], [yAxisKey]);

  const providers = useMemo(() => {
    const map = new Map<string, string>();
    models.forEach((m) => map.set(m.providerSlug, m.providerDisplayName));
    return Array.from(map.entries());
  }, [models]);

  const filteredModels = useMemo(() => {
    if (filterProvider === 'all') return models;
    return models.filter((m) => m.providerSlug === filterProvider);
  }, [models, filterProvider]);

  const getValue = (model: ModelDetail, key: MetricKey): number => {
    const val = model[key];
    if (val === null || val === undefined) return 0;
    return typeof val === 'number' ? val : 0;
  };

  // SVG dimensions
  const width = 800;
  const height = 480;
  const padding = { top: 40, right: 40, bottom: 60, left: 65 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const centerX = padding.left + innerWidth / 2;
  const centerY = padding.top + innerHeight / 2;

  // Compute dynamic domain min/max
  const xDomain = useMemo(() => {
    const vals = filteredModels.map((m) => getValue(m, xAxisKey));
    const maxVal = Math.max(...vals, xMetric.max * 0.5, 1);
    return { min: 0, max: Math.max(maxVal, 100) };
  }, [filteredModels, xAxisKey, xMetric]);

  const yDomain = useMemo(() => {
    const vals = filteredModels.map((m) => getValue(m, yAxisKey));
    const maxVal = Math.max(...vals, yMetric.max * 0.5, 1);
    return { min: 0, max: Math.max(maxVal, 100) };
  }, [filteredModels, yAxisKey, yMetric]);

  const getSvgCoords = (model: ModelDetail) => {
    const xVal = getValue(model, xAxisKey);
    const yVal = getValue(model, yAxisKey);

    let xPct = (xVal - xDomain.min) / (xDomain.max - xDomain.min || 1);
    let yPct = (yVal - yDomain.min) / (yDomain.max - yDomain.min || 1);

    if (xMetric.invertAxis) xPct = 1 - xPct;
    if (yMetric.invertAxis) yPct = 1 - yPct;

    xPct = Math.min(1, Math.max(0, xPct));
    yPct = Math.min(1, Math.max(0, yPct));

    const cx = padding.left + xPct * innerWidth;
    const cy = padding.top + (1 - yPct) * innerHeight;

    return { cx, cy, xVal, yVal };
  };

  // Zoom Handler Functions
  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(4.0, Number((prev + 0.25).toFixed(2))));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => {
      const next = Math.max(1.0, Number((prev - 0.25).toFixed(2)));
      if (next === 1.0) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleResetZoom = () => {
    setZoomLevel(1.0);
    setPan({ x: 0, y: 0 });
  };

  // Non-passive wheel event listener to prevent page scroll without browser errors
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;

    const onWheelNonPassive = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        setZoomLevel((prev) => Math.min(4.0, Number((prev + 0.25).toFixed(2))));
      } else {
        setZoomLevel((prev) => {
          const next = Math.max(1.0, Number((prev - 0.25).toFixed(2)));
          if (next === 1.0) setPan({ x: 0, y: 0 });
          return next;
        });
      }
    };

    el.addEventListener('wheel', onWheelNonPassive, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheelNonPassive);
    };
  }, []);

  // Click & Drag Pan Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (zoomLevel <= 1.0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || zoomLevel <= 1.0) return;
    const maxPan = (zoomLevel - 1) * (innerWidth / 2);
    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;

    const clampedX = Math.min(maxPan, Math.max(-maxPan, newX));
    const clampedY = Math.min(maxPan, Math.max(-maxPan, newY));

    setPan({ x: clampedX, y: clampedY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div className="space-y-4">
      
      {/* Chart Control Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm">
        
        {/* Metric Axes & Provider Selectors */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center space-x-2 text-xs font-bold text-[var(--text-primary)] font-mono">
            <Sliders className="w-4 h-4 text-[var(--accent-primary)]" />
            <span>X-Axis:</span>
            <select
              value={xAxisKey}
              onChange={(e) => setXAxisKey(e.target.value as MetricKey)}
              className="bg-[var(--bg-well)] text-[var(--text-primary)] border border-[var(--border-hover)] rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:border-[var(--accent-primary)] cursor-pointer"
            >
              {METRIC_OPTIONS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label} ({m.unit})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2 text-xs font-bold text-[var(--text-primary)] font-mono">
            <span>Y-Axis:</span>
            <select
              value={yAxisKey}
              onChange={(e) => setYAxisKey(e.target.value as MetricKey)}
              className="bg-[var(--bg-well)] text-[var(--text-primary)] border border-[var(--border-hover)] rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:border-[var(--accent-primary)] cursor-pointer"
            >
              {METRIC_OPTIONS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label} ({m.unit})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2 text-xs text-[var(--text-secondary)] font-mono">
            <span>Provider:</span>
            <select
              value={filterProvider}
              onChange={(e) => setFilterProvider(e.target.value)}
              className="bg-[var(--bg-well)] text-[var(--text-primary)] border border-[var(--border-hover)] rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:border-[var(--accent-primary)] cursor-pointer"
            >
              <option value="all">All Providers ({models.length})</option>
              {providers.map(([slug, name]) => (
                <option key={slug} value={slug}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Controls: Labels, Zoom, Compare */}
        <div className="flex flex-wrap items-center gap-3">
          
          {/* Label Display Mode Toggle */}
          <button
            onClick={() => setLabelMode((prev) => (prev === 'hover' ? 'all' : 'hover'))}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all border cursor-pointer ${
              labelMode === 'hover'
                ? 'bg-[var(--bg-well)] text-[var(--accent-primary)] border-[var(--accent-primary)]/30'
                : 'bg-[var(--accent-primary)]/10 text-[var(--signal-mint)] border-[var(--signal-mint)]/30'
            }`}
            title="Toggle text labels declutter mode"
          >
            <Tag className="w-3.5 h-3.5" />
            <span>Labels: {labelMode === 'hover' ? 'Hover / Focus' : 'Show All'}</span>
          </button>

          {/* Zoom Controls Group */}
          <div className="flex items-center bg-[var(--bg-well)] p-1 rounded-xl border border-[var(--border-subtle)] space-x-1">
            <button
              onClick={handleZoomOut}
              disabled={zoomLevel <= 1.0}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title="Zoom Out (-)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>

            <span className="px-2 font-mono text-xs font-bold text-[var(--text-primary)] min-w-[50px] text-center">
              {Math.round(zoomLevel * 100)}%
            </span>

            <button
              onClick={handleZoomIn}
              disabled={zoomLevel >= 4.0}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title="Zoom In (+)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>

            {(zoomLevel > 1.0 || pan.x !== 0 || pan.y !== 0) && (
              <button
                onClick={handleResetZoom}
                className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--signal-mint)] transition-colors cursor-pointer ml-1"
                title="Reset Zoom & Pan (100%)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Compare Button */}
          <button
            onClick={onOpenCompareModal}
            disabled={selectedModelIds.length === 0}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer ${
              selectedModelIds.length > 0
                ? 'bg-[var(--accent-primary)] text-white hover:opacity-90'
                : 'bg-[var(--bg-well)] text-[var(--text-muted)] border border-[var(--border-subtle)] cursor-not-allowed opacity-60'
            }`}
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Compare Selected ({selectedModelIds.length})</span>
          </button>
        </div>

      </div>

      {/* Main Interactive Chart Container */}
      <div
        ref={chartContainerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className={`relative p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-md overflow-hidden select-none ${
          zoomLevel > 1.0 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
        }`}
      >
        {/* Zoom Hint Banner */}
        <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)] mb-2 px-2">
          <span className="flex items-center gap-1.5">
            <Move className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
            <span>
              {zoomLevel > 1.0
                ? 'Zoomed view active • Click & drag to pan • Scroll wheel to adjust'
                : 'Scroll wheel inside chart to zoom • Hover node for model details'}
            </span>
          </span>
          <span className="text-[var(--text-secondary)] font-bold">
            Showing {filteredModels.length} models
          </span>
        </div>

        {/* SVG Scatter Chart Canvas */}
        <div className="relative w-full aspect-[16/9] max-h-[500px]">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-full overflow-visible select-none"
          >
            <defs>
              <pattern id="matrixGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--border-subtle)" strokeWidth="0.5" opacity="0.6" />
              </pattern>

              {/* Clip path for zoom inner plot area */}
              <clipPath id="chartInnerClip">
                <rect x={padding.left} y={padding.top} width={innerWidth} height={innerHeight} />
              </clipPath>
            </defs>

            {/* Static Outer Plot Area Border */}
            <rect
              x={padding.left}
              y={padding.top}
              width={innerWidth}
              height={innerHeight}
              fill="none"
              stroke="var(--border-hover)"
              strokeWidth="1"
            />

            {/* Static X-Axis Ticks & Labels */}
            {[0, 0.25, 0.5, 0.75, 1].map((step, idx) => {
              const xPos = padding.left + step * innerWidth;
              const val = xDomain.min + step * (xDomain.max - xDomain.min);
              return (
                <g key={`x-tick-${idx}`}>
                  <line
                    x1={xPos}
                    y1={padding.top + innerHeight}
                    x2={xPos}
                    y2={padding.top + innerHeight + 6}
                    stroke="var(--text-muted)"
                    strokeWidth="1"
                  />
                  <text
                    x={xPos}
                    y={padding.top + innerHeight + 20}
                    textAnchor="middle"
                    fill="var(--text-muted)"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    {xMetric.invertAxis ? (xDomain.max - val).toFixed(0) : val.toFixed(0)}
                  </text>
                </g>
              );
            })}

            {/* Static Y-Axis Ticks & Labels */}
            {[0, 0.25, 0.5, 0.75, 1].map((step, idx) => {
              const yPos = padding.top + (1 - step) * innerHeight;
              const val = yDomain.min + step * (yDomain.max - yDomain.min);
              return (
                <g key={`y-tick-${idx}`}>
                  <line
                    x1={padding.left - 6}
                    y1={yPos}
                    x2={padding.left}
                    y2={yPos}
                    stroke="var(--text-muted)"
                    strokeWidth="1"
                  />
                  <text
                    x={padding.left - 10}
                    y={yPos + 4}
                    textAnchor="end"
                    fill="var(--text-muted)"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    {yMetric.invertAxis ? (yDomain.max - val).toFixed(0) : val.toFixed(0)}
                  </text>
                </g>
              );
            })}

            {/* Static X-Axis Title */}
            <text
              x={padding.left + innerWidth / 2}
              y={height - 12}
              textAnchor="middle"
              fill="var(--text-primary)"
              fontSize="12"
              fontWeight="bold"
              fontFamily="sans-serif"
            >
              {xMetric.label} ({xMetric.unit}) {xMetric.invertAxis ? '← Lower is better' : '→ Higher is better'}
            </text>

            {/* Static Y-Axis Title */}
            <text
              x={20}
              y={padding.top + innerHeight / 2}
              textAnchor="middle"
              transform={`rotate(-90 20 ${padding.top + innerHeight / 2})`}
              fill="var(--text-primary)"
              fontSize="12"
              fontWeight="bold"
              fontFamily="sans-serif"
            >
              {yMetric.label} ({yMetric.unit}) {yMetric.invertAxis ? '← Lower is better' : '↑ Higher is better'}
            </text>

            {/* ZOOMABLE & PANNING PLOT INNER CONTAINER */}
            <g clipPath="url(#chartInnerClip)">
              <g
                transform={`translate(${pan.x}, ${pan.y}) scale(${zoomLevel})`}
                style={{
                  transformOrigin: `${centerX}px ${centerY}px`,
                  transition: isDragging ? 'none' : 'transform 0.15s ease-out',
                }}
              >
                {/* Background Grid Pattern */}
                <rect
                  x={padding.left}
                  y={padding.top}
                  width={innerWidth}
                  height={innerHeight}
                  fill="url(#matrixGrid)"
                />

                {/* Quadrant Divider Axis Lines */}
                <line
                  x1={padding.left + innerWidth / 2}
                  y1={padding.top}
                  x2={padding.left + innerWidth / 2}
                  y2={padding.top + innerHeight}
                  stroke="var(--border-hover)"
                  strokeDasharray="4 4"
                  strokeWidth="1.5"
                />
                <line
                  x1={padding.left}
                  y1={padding.top + innerHeight / 2}
                  x2={padding.left + innerWidth}
                  y2={padding.top + innerHeight / 2}
                  stroke="var(--border-hover)"
                  strokeDasharray="4 4"
                  strokeWidth="1.5"
                />

                {/* Quadrant Labels */}
                <text
                  x={padding.left + innerWidth - 10}
                  y={padding.top + 20}
                  textAnchor="end"
                  fill="var(--signal-mint)"
                  fontSize="10"
                  fontWeight="bold"
                  fontFamily="monospace"
                  className="opacity-70"
                >
                  ✦ S-Tier Frontier Leader
                </text>
                <text
                  x={padding.left + 10}
                  y={padding.top + 20}
                  textAnchor="start"
                  fill="var(--accent-primary)"
                  fontSize="10"
                  fontWeight="bold"
                  fontFamily="monospace"
                  className="opacity-70"
                >
                  High {yMetric.label}
                </text>
                <text
                  x={padding.left + innerWidth - 10}
                  y={padding.top + innerHeight - 15}
                  textAnchor="end"
                  fill="var(--text-muted)"
                  fontSize="10"
                  fontWeight="bold"
                  fontFamily="monospace"
                  className="opacity-70"
                >
                  High {xMetric.label}
                </text>

                {/* Model Scatter Point Nodes */}
                {filteredModels.map((model) => {
                  const { cx, cy } = getSvgCoords(model);
                  const isSelected = selectedModelIds.includes(model.id);
                  const isHovered = hoveredModel?.id === model.id;
                  const color = getProviderColor(model.providerSlug);
                  const shouldShowLabel = labelMode === 'all' || isHovered || isSelected;

                  return (
                    <g
                      key={model.id}
                      className="cursor-pointer transition-transform duration-150"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelectModel(model.id);
                      }}
                      onMouseEnter={() => setHoveredModel(model)}
                      onMouseLeave={() => setHoveredModel(null)}
                    >
                      {/* Selection Pulsing Ring */}
                      {isSelected && (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={14 / Math.sqrt(zoomLevel)}
                          fill="none"
                          stroke="var(--signal-mint)"
                          strokeWidth={2.5 / Math.sqrt(zoomLevel)}
                          strokeDasharray="3 3"
                        />
                      )}

                      {/* Node Point Circle */}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={(isHovered ? 8 : isSelected ? 7 : 5) / Math.sqrt(zoomLevel)}
                        fill={color}
                        stroke="var(--bg-obsidian)"
                        strokeWidth={1.5 / Math.sqrt(zoomLevel)}
                        className="transition-all duration-150 shadow-md"
                      />

                      {/* Model Label Badge (rendered cleanly when hovered, selected, or when Show All is enabled) */}
                      {shouldShowLabel && (
                        <text
                          x={cx + (8 / Math.sqrt(zoomLevel))}
                          y={cy + (4 / Math.sqrt(zoomLevel))}
                          fill={isHovered || isSelected ? 'var(--text-primary)' : 'var(--text-secondary)'}
                          fontSize={Math.max(8, 10 / Math.sqrt(zoomLevel))}
                          fontWeight={isHovered || isSelected ? 'bold' : 'normal'}
                          fontFamily="sans-serif"
                          className="pointer-events-none drop-shadow"
                        >
                          {model.displayName}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
        </div>

        {/* Hover Tooltip Overlay Card */}
        {hoveredModel && (
          <div className="absolute top-10 right-6 p-4 rounded-xl bg-[var(--bg-rail)] border border-[var(--border-hover)] shadow-2xl z-20 max-w-xs animate-fadeIn space-y-2 pointer-events-none">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2">
              <div>
                <div className="font-bold text-sm text-[var(--text-primary)]">
                  {hoveredModel.displayName}
                </div>
                <div className="text-xs text-[var(--accent-primary)] font-mono">
                  {hoveredModel.providerDisplayName}
                </div>
              </div>
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: getProviderColor(hoveredModel.providerSlug) }}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div>
                <span className="text-[var(--text-muted)] block text-[10px]">{xMetric.label}:</span>
                <span className="font-bold text-[var(--text-primary)]">
                  {getValue(hoveredModel, xAxisKey)} {xMetric.unit}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)] block text-[10px]">{yMetric.label}:</span>
                <span className="font-bold text-[var(--text-primary)]">
                  {getValue(hoveredModel, yAxisKey)} {yMetric.unit}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)] block text-[10px]">Context:</span>
                <span className="text-[var(--text-secondary)]">{(hoveredModel.contextWindow / 1024).toFixed(0)}K</span>
              </div>
              <div>
                <span className="text-[var(--text-muted)] block text-[10px]">Input Pricing:</span>
                <span className="text-[var(--text-secondary)]">
                  {hoveredModel.costInputPer1k === 0 ? 'FREE' : `$${hoveredModel.costInputPer1k}/1K`}
                </span>
              </div>
            </div>
            <div className="text-[10px] text-[var(--signal-mint)] font-mono pt-1 text-right">
              Click node to toggle comparison selection
            </div>
          </div>
        )}

      </div>

    </div>
  );
};
