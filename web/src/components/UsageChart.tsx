/**
 * Pure SVG line chart for token usage trends.
 * No external chart library — renders <polyline> with axis labels.
 */

import { useMemo, useState } from "preact/hooks";
import type { UsageDataPoint } from "../../../shared/hooks/use-usage-stats";

interface UsageChartProps {
  data: UsageDataPoint[];
  height?: number;
}

interface ChartPoint extends UsageDataPoint {
  x: number;
  inputY: number;
  outputY: number;
  cacheReadY: number;
  requestY: number;
}

interface TooltipLine {
  label: string;
  value: string;
  color: string;
}

const PADDING = { top: 20, right: 20, bottom: 40, left: 65 };

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function formatExactNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function ChartTooltip({
  anchorX,
  anchorY,
  canvasWidth,
  timestamp,
  lines,
}: {
  anchorX: number;
  anchorY: number;
  canvasWidth: number;
  timestamp: string;
  lines: TooltipLine[];
}) {
  const boxWidth = 182;
  const boxHeight = 26 + lines.length * 18;
  const boxX = anchorX > canvasWidth - boxWidth - 12
    ? Math.max(8, anchorX - boxWidth - 12)
    : anchorX + 12;
  const boxY = Math.max(8, anchorY);

  return (
    <g pointer-events="none">
      <rect
        x={boxX}
        y={boxY}
        width={boxWidth}
        height={boxHeight}
        rx="10"
        fill="rgba(15, 23, 42, 0.96)"
        stroke="rgba(148, 163, 184, 0.35)"
      />
      <text
        x={boxX + 10}
        y={boxY + 16}
        fill="#cbd5e1"
        font-size="10"
      >
        {timestamp}
      </text>
      {lines.map((line, index) => (
        <g key={`${timestamp}-${line.label}`}>
          <circle
            cx={boxX + 12}
            cy={boxY + 29 + index * 18}
            r="3"
            fill={line.color}
          />
          <text
            x={boxX + 20}
            y={boxY + 32 + index * 18}
            fill="#cbd5e1"
            font-size="10"
          >
            <tspan>{line.label}: </tspan>
            <tspan fill="#f8fafc">{line.value}</tspan>
          </text>
        </g>
      ))}
    </g>
  );
}

export function UsageChart({ data, height = 260 }: UsageChartProps) {
  const [hovered, setHovered] = useState<{ index: number; section: "tokens" | "requests" } | null>(null);
  const width = 720; // SVG viewBox width, responsive via CSS
  const reqHeight = Math.round(height * 0.6);
  const chartW = width - PADDING.left - PADDING.right;
  const chartH = height - PADDING.top - PADDING.bottom;
  const reqChartH = reqHeight - PADDING.top - PADDING.bottom;

  const { points, inputPoints, outputPoints, cacheReadPoints, requestPoints, xLabels, yTokenLabels, yReqLabels } = useMemo(() => {
    if (data.length === 0) {
      return {
        points: [] as ChartPoint[],
        inputPoints: "",
        outputPoints: "",
        cacheReadPoints: "",
        requestPoints: "",
        xLabels: [] as Array<{ x: number; label: string }>,
        yTokenLabels: [] as Array<{ y: number; label: string }>,
        yReqLabels: [] as Array<{ y: number; label: string }>,
      };
    }

    const maxInput = Math.max(...data.map((d) => d.input_tokens));
    const maxOutput = Math.max(...data.map((d) => d.output_tokens));
    const maxCacheRead = Math.max(...data.map((d) => d.cache_read_input_tokens ?? 0));
    const yMaxT = Math.max(maxInput, maxOutput, maxCacheRead, 1);
    const yMaxR = Math.max(...data.map((d) => d.request_count), 1);

    const toX = (i: number) => data.length === 1
      ? PADDING.left + chartW / 2
      : PADDING.left + (i / (data.length - 1)) * chartW;
    const toYTokens = (v: number) => PADDING.top + chartH - (v / yMaxT) * chartH;
    const toYReqs = (v: number) => PADDING.top + reqChartH - (v / yMaxR) * reqChartH;

    const computedPoints = data.map((d, i) => ({
      ...d,
      x: toX(i),
      inputY: toYTokens(d.input_tokens),
      outputY: toYTokens(d.output_tokens),
      cacheReadY: toYTokens(d.cache_read_input_tokens ?? 0),
      requestY: toYReqs(d.request_count),
    }));

    const inp = computedPoints.map((point) => `${point.x},${point.inputY}`).join(" ");
    const out = computedPoints.map((point) => `${point.x},${point.outputY}`).join(" ");
    const cache = computedPoints.map((point) => `${point.x},${point.cacheReadY}`).join(" ");
    const req = computedPoints.map((point) => `${point.x},${point.requestY}`).join(" ");

    const step = Math.max(1, Math.floor(data.length / 5));
    const xl: Array<{ x: number; label: string }> = [];
    for (let i = 0; i < data.length; i += step) {
      xl.push({ x: toX(i), label: formatTime(data[i].timestamp) });
    }
    const lastPoint = computedPoints[computedPoints.length - 1];
    if (xl[xl.length - 1]?.x !== lastPoint.x) {
      xl.push({ x: lastPoint.x, label: formatTime(lastPoint.timestamp) });
    }

    const yTL: Array<{ y: number; label: string }> = [];
    const yRL: Array<{ y: number; label: string }> = [];
    for (let i = 0; i <= 4; i++) {
      const frac = i / 4;
      yTL.push({ y: PADDING.top + chartH - frac * chartH, label: formatNumber(Math.round(yMaxT * frac)) });
      yRL.push({ y: PADDING.top + reqChartH - frac * reqChartH, label: formatNumber(Math.round(yMaxR * frac)) });
    }

    return {
      points: computedPoints,
      inputPoints: inp,
      outputPoints: out,
      cacheReadPoints: cache,
      requestPoints: req,
      xLabels: xl,
      yTokenLabels: yTL,
      yReqLabels: yRL,
    };
  }, [chartH, chartW, data, reqChartH]);

  const activePoint = hovered ? points[hovered.index] ?? null : null;

  if (data.length === 0) {
    return (
      <div class="text-center py-12 text-slate-400 dark:text-text-dim text-sm">
        No usage data yet
      </div>
    );
  }

  return (
    <div class="space-y-6">
      <div>
        <div class="flex items-center gap-4 mb-2 text-xs text-slate-500 dark:text-text-dim">
          <span class="flex items-center gap-1">
            <span class="inline-block w-3 h-0.5 bg-blue-500 rounded" /> Input Tokens
          </span>
          <span class="flex items-center gap-1">
            <span class="inline-block w-3 h-0.5 bg-emerald-500 rounded" /> Output Tokens
          </span>
          <span class="flex items-center gap-1">
            <span class="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: "var(--chart-violet)" }} /> Cache Read
          </span>
        </div>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          class="w-full"
          style={{ maxHeight: `${height}px` }}
          onMouseLeave={() => setHovered(null)}
        >
          {yTokenLabels.map((tick) => (
            <line
              key={`grid-${tick.y}`}
              x1={PADDING.left}
              y1={tick.y}
              x2={width - PADDING.right}
              y2={tick.y}
              stroke="currentColor"
              class="text-gray-200 dark:text-border-dark"
              stroke-width="0.5"
            />
          ))}

          {yTokenLabels.map((tick) => (
            <text
              key={`yl-${tick.y}`}
              x={PADDING.left - 8}
              y={tick.y + 3}
              text-anchor="end"
              class="fill-slate-400 dark:fill-text-dim"
              font-size="10"
            >
              {tick.label}
            </text>
          ))}

          {xLabels.map((tick) => (
            <text
              key={`xl-${tick.x}`}
              x={tick.x}
              y={height - 8}
              text-anchor="middle"
              class="fill-slate-400 dark:fill-text-dim"
              font-size="9"
            >
              {tick.label}
            </text>
          ))}

          {activePoint && (
            <line
              x1={activePoint.x}
              y1={PADDING.top}
              x2={activePoint.x}
              y2={PADDING.top + chartH}
              stroke="rgba(148, 163, 184, 0.45)"
              stroke-dasharray="3 3"
            />
          )}

          <polyline
            points={inputPoints}
            fill="none"
            stroke="var(--chart-blue)"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <polyline
            points={outputPoints}
            fill="none"
            stroke="var(--chart-green)"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <polyline
            points={cacheReadPoints}
            fill="none"
            stroke="var(--chart-violet)"
            stroke-width="2"
            stroke-linejoin="round"
          />

          {points.map((point, index) => (
            <g key={`token-point-${point.timestamp}`}>
              <circle
                cx={point.x}
                cy={point.inputY}
                r={hovered?.index === index ? 4 : 3}
                fill="var(--chart-blue)"
                stroke="rgba(15, 23, 42, 0.9)"
                stroke-width="1.2"
              />
              <circle
                cx={point.x}
                cy={point.outputY}
                r={hovered?.index === index ? 4 : 3}
                fill="var(--chart-green)"
                stroke="rgba(15, 23, 42, 0.9)"
                stroke-width="1.2"
              />
              <circle
                cx={point.x}
                cy={point.cacheReadY}
                r={hovered?.index === index ? 4 : 3}
                fill="var(--chart-violet)"
                stroke="rgba(15, 23, 42, 0.9)"
                stroke-width="1.2"
              />
            </g>
          ))}

          {points.map((point, index) => {
            const left = index === 0 ? PADDING.left : (points[index - 1].x + point.x) / 2;
            const right = index === points.length - 1 ? width - PADDING.right : (point.x + points[index + 1].x) / 2;
            return (
              <rect
                key={`token-hit-${point.timestamp}`}
                x={left}
                y={PADDING.top}
                width={Math.max(12, right - left)}
                height={chartH}
                fill="transparent"
                class="cursor-crosshair"
                onMouseEnter={() => setHovered({ index, section: "tokens" })}
              />
            );
          })}

          {activePoint && hovered?.section === "tokens" && (
            <ChartTooltip
              anchorX={activePoint.x}
              anchorY={10}
              canvasWidth={width}
              timestamp={formatTime(activePoint.timestamp)}
              lines={[
                { label: "Input Tokens", value: formatExactNumber(activePoint.input_tokens), color: "var(--chart-blue)" },
                { label: "Output Tokens", value: formatExactNumber(activePoint.output_tokens), color: "var(--chart-green)" },
                { label: "Cache Read", value: formatExactNumber(activePoint.cache_read_input_tokens), color: "var(--chart-violet)" },
                { label: "Requests", value: formatExactNumber(activePoint.request_count), color: "var(--chart-amber)" },
              ]}
            />
          )}
        </svg>
      </div>

      <div>
        <div class="flex items-center gap-4 mb-2 text-xs text-slate-500 dark:text-text-dim">
          <span class="flex items-center gap-1">
            <span class="inline-block w-3 h-0.5 bg-amber-500 rounded" /> Requests
          </span>
        </div>
        <svg
          viewBox={`0 0 ${width} ${reqHeight}`}
          class="w-full"
          style={{ maxHeight: `${reqHeight}px` }}
          onMouseLeave={() => setHovered(null)}
        >
          {yReqLabels.map((tick) => (
            <line
              key={`rgrid-${tick.y}`}
              x1={PADDING.left}
              y1={tick.y}
              x2={width - PADDING.right}
              y2={tick.y}
              stroke="currentColor"
              class="text-gray-200 dark:text-border-dark"
              stroke-width="0.5"
            />
          ))}

          {yReqLabels.map((tick) => (
            <text
              key={`ryl-${tick.y}`}
              x={PADDING.left - 8}
              y={tick.y + 3}
              text-anchor="end"
              class="fill-slate-400 dark:fill-text-dim"
              font-size="10"
            >
              {tick.label}
            </text>
          ))}

          {xLabels.map((tick) => (
            <text
              key={`rxl-${tick.x}`}
              x={tick.x}
              y={reqHeight - 8}
              text-anchor="middle"
              class="fill-slate-400 dark:fill-text-dim"
              font-size="9"
            >
              {tick.label}
            </text>
          ))}

          {activePoint && (
            <line
              x1={activePoint.x}
              y1={PADDING.top}
              x2={activePoint.x}
              y2={PADDING.top + reqChartH}
              stroke="rgba(148, 163, 184, 0.45)"
              stroke-dasharray="3 3"
            />
          )}

          <polyline
            points={requestPoints}
            fill="none"
            stroke="var(--chart-amber)"
            stroke-width="2"
            stroke-linejoin="round"
          />

          {points.map((point, index) => (
            <circle
              key={`request-point-${point.timestamp}`}
              cx={point.x}
              cy={point.requestY}
              r={hovered?.index === index ? 4 : 3}
              fill="var(--chart-amber)"
              stroke="rgba(15, 23, 42, 0.9)"
              stroke-width="1.2"
            />
          ))}

          {points.map((point, index) => {
            const left = index === 0 ? PADDING.left : (points[index - 1].x + point.x) / 2;
            const right = index === points.length - 1 ? width - PADDING.right : (point.x + points[index + 1].x) / 2;
            return (
              <rect
                key={`request-hit-${point.timestamp}`}
                x={left}
                y={PADDING.top}
                width={Math.max(12, right - left)}
                height={reqChartH}
                fill="transparent"
                class="cursor-crosshair"
                onMouseEnter={() => setHovered({ index, section: "requests" })}
              />
            );
          })}

          {activePoint && hovered?.section === "requests" && (
            <ChartTooltip
              anchorX={activePoint.x}
              anchorY={10}
              canvasWidth={width}
              timestamp={formatTime(activePoint.timestamp)}
              lines={[
                { label: "Requests", value: formatExactNumber(activePoint.request_count), color: "var(--chart-amber)" },
                { label: "Input Tokens", value: formatExactNumber(activePoint.input_tokens), color: "var(--chart-blue)" },
                { label: "Output Tokens", value: formatExactNumber(activePoint.output_tokens), color: "var(--chart-green)" },
                { label: "Cache Read", value: formatExactNumber(activePoint.cache_read_input_tokens), color: "var(--chart-violet)" },
              ]}
            />
          )}
        </svg>
      </div>
    </div>
  );
}
