import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { ModelDetail } from './ModelCompareModal.js';
import { Sliders, Maximize2, ZoomIn, ZoomOut, RotateCcw, Move, Tag, Layers } from 'lucide-react';

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

interface PlottedPoint {
  model: ModelDetail;
  xVal: number;
  yVal: number;
  cx: number;
  cy: number;
  color: string;
  clusterIndex: number;
  clusterTotal: number;
}

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
  const [filterProvider, setFilterProvider] = useState<string>('all');
  const [showOnlyBenchmarked, setShowOnlyBenchmarked] = useState<boolean>(false);
  const [labelMode, setLabelMode] = useState<'hover' | 'all'>('hover');

  // Zoom & Pan State
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Hovered Cluster Stack State
  const [hoveredCluster, setHoveredCluster] = useState<{
    models: ModelDetail[];
    xVal: number;
    yVal: number;
    screenX: number;
    screenY: number;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const xMetric = useMemo(() => METRIC_OPTIONS.find((m) => m.key === xAxisKey) || METRIC_OPTIONS[0], [xAxisKey]);
  const yMetric = useMemo(() => METRIC_OPTIONS.find((m) => m.key === yAxisKey) || METRIC_OPTIONS[1], [yAxisKey]);

  const providers = useMemo(() => {
    const map = new Map<string, string>();
    models.forEach((m) => map.set(m.providerSlug, m.providerDisplayName));
    return Array.from(map.entries());
  }, [models]);

  const filteredModels = useMemo(() => {
    let list = models;
    if (filterProvider !== 'all') {
      list = list.filter((m) => m.providerSlug === filterProvider);
    }
    if (showOnlyBenchmarked) {
      list = list.filter((m) => (m[xAxisKey] ?? 0) > 0 || (m[yAxisKey] ?? 0) > 0);
    }
    return list;
  }, [models, filterProvider, showOnlyBenchmarked, xAxisKey, yAxisKey]);

  const getValue = (model: ModelDetail, key: MetricKey): number => {
    const val = model[key];
    if (val === null || val === undefined) return 0;
    return typeof val === 'number' ? val : 0;
  };

  // Dimensions
  const width = 800;
  const height = 480;
  const padding = { top: 40, right: 40, bottom: 60, left: 65 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const centerX = padding.left + innerWidth / 2;
  const centerY = padding.top + innerHeight / 2;

  // Domain Min/Max
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

  // Compute Plotted Points with Deterministic Golden Spiral Jittering for Stacked Models
  const plottedPoints = useMemo<PlottedPoint[]>(() => {
    // 1. Group models by exact (xVal, yVal) key
    const clusters = new Map<string, ModelDetail[]>();
    filteredModels.forEach((m) => {
      const xVal = getValue(m, xAxisKey);
      const yVal = getValue(m, yAxisKey);
      const key = `${xVal.toFixed(2)}_${yVal.toFixed(2)}`;
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key)!.push(m);
    });

    const points: PlottedPoint[] = [];

    // Golden ratio angle (~137.5 deg in radians)
    const GOLDEN_ANGLE = 2.39996;

    clusters.forEach((clusterModels, key) => {
      const totalInCluster = clusterModels.length;

      clusterModels.forEach((model, idx) => {
        const xVal = getValue(model, xAxisKey);
        const yVal = getValue(model, yAxisKey);

        let xPct = (xVal - xDomain.min) / (xDomain.max - xDomain.min || 1);
        let yPct = (yVal - yDomain.min) / (yDomain.max - yDomain.min || 1);

        if (xMetric.invertAxis) xPct = 1 - xPct;
        if (yMetric.invertAxis) yPct = 1 - yPct;

        xPct = Math.min(1, Math.max(0, xPct));
        yPct = Math.min(1, Math.max(0, yPct));

        let baseX = padding.left + xPct * innerWidth;
        let baseY = padding.top + (1 - yPct) * innerHeight;

        // Apply Golden Spiral Jitter if multiple models share the exact same score coordinate
        let cx = baseX;
        let cy = baseY;

        if (totalInCluster > 1 && idx > 0) {
          const radius = Math.min(22, 4 + Math.sqrt(idx) * 3.5);
          const angle = idx * GOLDEN_ANGLE;
          cx += Math.cos(angle) * radius;
          cy += Math.sin(angle) * radius;
        }

        points.push({
          model,
          xVal,
          yVal,
          cx,
          cy,
          color: getProviderColor(model.providerSlug),
          clusterIndex: idx,
          clusterTotal: totalInCluster,
        });
      });
    });

    return points;
  }, [filteredModels, xAxisKey, yAxisKey, xDomain, yDomain, xMetric, yMetric, innerWidth, innerHeight]);

  // High Performance Canvas 2D Drawing Effect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    // Save Context for Zoom/Pan Transform
    ctx.save();

    // Set Plot Clip Path
    ctx.beginPath();
    ctx.rect(padding.left, padding.top, innerWidth, innerHeight);
    ctx.clip();

    // Apply Zoom & Pan Matrix
    ctx.translate(centerX + pan.x, centerY + pan.y);
    ctx.scale(zoomLevel, zoomLevel);
    ctx.translate(-centerX, -centerY);

    // Draw Grid Pattern
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 0.5 / zoomLevel;
    ctx.globalAlpha = 0.4;

    const gridSize = 40;
    for (let x = padding.left; x <= padding.left + innerWidth; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + innerHeight);
      ctx.stroke();
    }
    for (let y = padding.top; y <= padding.top + innerHeight; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + innerWidth, y);
      ctx.stroke();
    }

    // Draw Quadrant Divider Lines
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5 / zoomLevel;
    ctx.setLineDash([4 / zoomLevel, 4 / zoomLevel]);
    ctx.globalAlpha = 0.7;

    ctx.beginPath();
    ctx.moveTo(padding.left + innerWidth / 2, padding.top);
    ctx.lineTo(padding.left + innerWidth / 2, padding.top + innerHeight);
    ctx.moveTo(padding.left, padding.top + innerHeight / 2);
    ctx.lineTo(padding.left + innerWidth, padding.top + innerHeight / 2);
    ctx.stroke();
    ctx.setLineDash([]); // Reset line dash

    // Draw Quadrant Labels
    ctx.font = `bold ${Math.max(9, 10 / zoomLevel)}px monospace`;
    ctx.fillStyle = '#10b981';
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.75;
    ctx.fillText('✦ S-Tier Frontier Leader', padding.left + innerWidth - 10, padding.top + 20);

    ctx.fillStyle = '#6366f1';
    ctx.textAlign = 'start';
    ctx.fillText(`High ${yMetric.label}`, padding.left + 10, padding.top + 20);

    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'right';
    ctx.fillText(`High ${xMetric.label}`, padding.left + innerWidth - 10, padding.top + innerHeight - 15);

    // Draw Plotted Model Points
    plottedPoints.forEach((pt) => {
      const isSelected = selectedModelIds.includes(pt.model.id);
      const isHovered = hoveredCluster?.models.some((m) => m.id === pt.model.id);

      ctx.globalAlpha = isHovered ? 1.0 : isSelected ? 0.95 : 0.85;

      // Draw Selection Pulse Outer Ring
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(pt.cx, pt.cy, 12 / Math.sqrt(zoomLevel), 0, Math.PI * 2);
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2.5 / Math.sqrt(zoomLevel);
        ctx.stroke();
      }

      // Draw Main Node Circle
      const baseRadius = isHovered ? 7.5 : isSelected ? 6.5 : 4.5;
      const r = Math.max(2.5, baseRadius / Math.sqrt(zoomLevel));

      ctx.beginPath();
      ctx.arc(pt.cx, pt.cy, r, 0, Math.PI * 2);
      ctx.fillStyle = pt.color;
      ctx.fill();
      ctx.strokeStyle = '#020617';
      ctx.lineWidth = 1.2 / Math.sqrt(zoomLevel);
      ctx.stroke();

      // Draw Model Text Badge when Show All mode is active
      if (labelMode === 'all' || isHovered || isSelected) {
        ctx.font = `${isHovered || isSelected ? 'bold' : 'normal'} ${Math.max(8, 10 / Math.sqrt(zoomLevel))}px sans-serif`;
        ctx.fillStyle = isHovered || isSelected ? '#f8fafc' : '#cbd5e1';
        ctx.textAlign = 'left';
        ctx.globalAlpha = 0.95;
        ctx.fillText(pt.model.displayName, pt.cx + 7 / Math.sqrt(zoomLevel), pt.cy + 3 / Math.sqrt(zoomLevel));
      }
    });

    ctx.restore();
  }, [plottedPoints, selectedModelIds, hoveredCluster, zoomLevel, pan, width, height, innerWidth, innerHeight, labelMode, xMetric, yMetric]);

  // Zoom Handlers
  const handleZoomIn = () => setZoomLevel((prev) => Math.min(4.0, Number((prev + 0.25).toFixed(2))));
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

  // Non-passive wheel event listener
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
    return () => el.removeEventListener('wheel', onWheelNonPassive);
  }, []);

  // Hover & Drag Events on Canvas
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (zoomLevel <= 1.0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging && zoomLevel > 1.0) {
      const maxPan = (zoomLevel - 1) * (innerWidth / 2);
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      setPan({
        x: Math.min(maxPan, Math.max(-maxPan, newX)),
        y: Math.min(maxPan, Math.max(-maxPan, newY)),
      });
      return;
    }

    // Spatial Hit Test for Tooltip Detection
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = (e.clientX - rect.left) * (width / rect.width);
    const mouseY = (e.clientY - rect.top) * (height / rect.height);

    // Transform mouse into canvas plot coordinates
    const transformedX = (mouseX - centerX - pan.x) / zoomLevel + centerX;
    const transformedY = (mouseY - centerY - pan.y) / zoomLevel + centerY;

    const hitThreshold = 14 / zoomLevel;
    const hits = plottedPoints.filter((pt) => {
      const dx = pt.cx - transformedX;
      const dy = pt.cy - transformedY;
      return Math.sqrt(dx * dx + dy * dy) <= hitThreshold;
    });

    if (hits.length > 0) {
      const hitModels = hits.map((h) => h.model);
      setHoveredCluster({
        models: hitModels,
        xVal: hits[0].xVal,
        yVal: hits[0].yVal,
        screenX: e.clientX - rect.left,
        screenY: e.clientY - rect.top,
      });
    } else {
      setHoveredCluster(null);
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (hoveredCluster && hoveredCluster.models.length > 0) {
      onToggleSelectModel(hoveredCluster.models[0].id);
    }
  };

  return (
    <div className="space-y-4">
      
      {/* Control Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm">
        
        {/* Metric Axes & Provider Filter */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center space-x-2 text-xs font-bold text-[var(--text-primary)] font-mono">
            <Sliders className="w-4 h-4 text-[var(--accent-primary)]" />
            <span>X-Axis:</span>
            <select
              value={xAxisKey}
              onChange={(e) => setXAxisKey(e.target.value as MetricKey)}
              className="bg-[var(--bg-well)] text-[var(--text-primary)] border border-[var(--border-hover)] rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none cursor-pointer"
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
              className="bg-[var(--bg-well)] text-[var(--text-primary)] border border-[var(--border-hover)] rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none cursor-pointer"
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
              className="bg-[var(--bg-well)] text-[var(--text-primary)] border border-[var(--border-hover)] rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none cursor-pointer"
            >
              <option value="all">All Providers ({models.length})</option>
              {providers.map(([slug, name]) => (
                <option key={slug} value={slug}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setShowOnlyBenchmarked(!showOnlyBenchmarked)}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all border cursor-pointer ${
              showOnlyBenchmarked
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                : 'bg-[var(--bg-well)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
            }`}
          >
            <span>Benchmarked Only ({filteredModels.length})</span>
          </button>
        </div>

        {/* Labels, Zoom & Compare Action */}
        <div className="flex flex-wrap items-center gap-3">
          
          <button
            onClick={() => setLabelMode((prev) => (prev === 'hover' ? 'all' : 'hover'))}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all border cursor-pointer ${
              labelMode === 'hover'
                ? 'bg-[var(--bg-well)] text-[var(--accent-primary)] border-[var(--accent-primary)]/30'
                : 'bg-[var(--accent-primary)]/10 text-[var(--signal-mint)] border-[var(--signal-mint)]/30'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            <span>Labels: {labelMode === 'hover' ? 'Hover / Focus' : 'Show All'}</span>
          </button>

          {/* Zoom Controls */}
          <div className="flex items-center bg-[var(--bg-well)] p-1 rounded-xl border border-[var(--border-subtle)] space-x-1">
            <button
              onClick={handleZoomOut}
              disabled={zoomLevel <= 1.0}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-secondary)] disabled:opacity-40 cursor-pointer"
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
              className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-secondary)] disabled:opacity-40 cursor-pointer"
              title="Zoom In (+)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>

            {(zoomLevel > 1.0 || pan.x !== 0 || pan.y !== 0) && (
              <button
                onClick={handleResetZoom}
                className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--signal-mint)] cursor-pointer ml-1"
                title="Reset Zoom & Pan"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

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

      {/* Main Plot Container */}
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
        <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)] mb-2 px-2">
          <span className="flex items-center gap-1.5">
            <Move className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
            <span>
              {zoomLevel > 1.0
                ? 'Zoomed view active • Click & drag to pan • Scroll wheel to adjust'
                : 'Scroll wheel inside chart to zoom • Hover points to inspect model clusters'}
            </span>
          </span>
          <span className="text-[var(--signal-mint)] font-bold">
            Displaying {plottedPoints.length} model points across {providers.length} providers
          </span>
        </div>

        {/* High Performance Canvas 2D Surface */}
        <div className="relative w-full aspect-[16/9] max-h-[500px]">
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className="w-full h-full block cursor-pointer"
          />

          {/* SVG Overlay for Axis Tick Labels & Axis Headers */}
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            {/* X-Axis Ticks */}
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

            {/* Y-Axis Ticks */}
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

            {/* X-Axis Title */}
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

            {/* Y-Axis Title */}
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
          </svg>
        </div>

        {/* Hover Cluster Stack Tooltip */}
        {hoveredCluster && (
          <div
            className="absolute p-4 rounded-2xl bg-[var(--bg-rail)] border border-[var(--border-hover)] shadow-2xl z-30 max-w-sm animate-fadeIn space-y-2 pointer-events-none"
            style={{
              left: `${Math.min(hoveredCluster.screenX + 15, width - 250)}px`,
              top: `${Math.min(hoveredCluster.screenY + 15, height - 200)}px`,
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2">
              <div>
                <div className="font-bold text-xs text-[var(--text-primary)]">
                  {hoveredCluster.models.length > 1
                    ? `${hoveredCluster.models.length} Models at this Benchmark Coordinate`
                    : hoveredCluster.models[0].displayName}
                </div>
                <div className="text-[10px] text-[var(--accent-primary)] font-mono">
                  {xMetric.label}: {hoveredCluster.xVal} | {yMetric.label}: {hoveredCluster.yVal}
                </div>
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1.5 custom-scrollbar">
              {hoveredCluster.models.slice(0, 6).map((m) => (
                <div key={m.id} className="flex items-center justify-between text-xs font-mono p-1 rounded bg-[var(--bg-well)]">
                  <span className="font-bold text-[var(--text-primary)] truncate max-w-[170px]">
                    {m.displayName}
                  </span>
                  <span className="text-[10px] text-[var(--accent-primary)] font-semibold">
                    {m.providerDisplayName}
                  </span>
                </div>
              ))}
              {hoveredCluster.models.length > 6 && (
                <div className="text-[10px] text-[var(--text-muted)] font-mono text-center">
                  + {hoveredCluster.models.length - 6} more models at this score
                </div>
              )}
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
