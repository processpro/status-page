'use strict';

const MEMORY_WARN = 70;
const MEMORY_RED = 85;
const CPU_HOUR_RED = 40;
const CPU_SUSTAINED = 80;
const CPU_SUSTAINED_POINTS = 3;

function mean(values) {
  const nums = (values || []).filter((value) => value != null && !Number.isNaN(value));
  if (!nums.length) {
    return null;
  }
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function memoryLevel(value) {
  if (value == null || Number.isNaN(value)) {
    return 'none';
  }
  if (value >= MEMORY_RED) {
    return 'hot';
  }
  if (value >= MEMORY_WARN) {
    return 'warn';
  }
  return 'ok';
}

function cpuLevel(hourAverage, recent) {
  const samples = (recent || []).filter((value) => value != null && !Number.isNaN(value));
  const sustained = samples.slice(-CPU_SUSTAINED_POINTS);
  if (sustained.length >= CPU_SUSTAINED_POINTS && sustained.every((value) => value > CPU_SUSTAINED)) {
    return 'hot';
  }
  if (hourAverage == null || Number.isNaN(hourAverage)) {
    return samples.length ? 'ok' : 'none';
  }
  if (hourAverage > CPU_HOUR_RED) {
    return 'hot';
  }
  return 'ok';
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return `${Math.round(value * 10) / 10}%`;
}

function clampPercent(value) {
  if (value == null || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function parseMetricSeries(body) {
  const byName = {};
  for (const metric of body?.value || []) {
    const name = metric.name?.value || metric.name;
    const buckets = new Map();
    for (const series of metric.timeseries || []) {
      for (const point of series.data || []) {
        const reading = point.average ?? point.total;
        if (reading == null) {
          continue;
        }
        const list = buckets.get(point.timeStamp) || [];
        list.push(reading);
        buckets.set(point.timeStamp, list);
      }
    }
    byName[name] = [...buckets.entries()]
      .sort((left, right) => (left[0] < right[0] ? -1 : 1))
      .map(([t, values]) => ({
        t,
        value: values.reduce((sum, value) => sum + value, 0) / values.length,
      }));
  }
  return byName;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function chartTimeLabel(iso, span) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()];
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return span === '24h' ? `${hours}:${minutes}` : `${day} ${month}`;
}

function renderMemoryChart(points, { limit = MEMORY_RED, unit = 'percent', span = '24h' } = {}) {
  const samples = (points || []).filter((point) => point && point.value != null);
  if (samples.length < 2) {
    return '<p class="muted">Not enough readings yet to show a line. The next points arrive every 5 minutes, and this chart keeps the last 24 hours, 7 days, or 30 days.</p>';
  }
  const width = 720;
  const height = 240;
  const padLeft = 52;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 36;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const showLimit = unit === 'percent' && limit != null;
  const max = unit === 'percent'
    ? 100
    : Math.max(...samples.map((point) => point.value), 1) * 1.15;
  const yOf = (value) => padTop + plotHeight - (Math.max(0, value) / max) * plotHeight;
  const step = plotWidth / (samples.length - 1);
  const coords = samples.map((point, index) => `${padLeft + step * index},${yOf(point.value)}`);
  const yTicks = unit === 'percent' ? [100, 50, 0] : [max, max / 2, 0];
  const grid = yTicks.map((tick) => {
    const y = yOf(tick);
    const label = unit === 'percent' ? `${Math.round(tick)}%` : `${Math.round(tick)}`;
    return `<line class="vital-chart-grid" x1="${padLeft}" x2="${width - padRight}" y1="${y}" y2="${y}" />
      <text class="vital-chart-axis" x="${padLeft - 8}" y="${y + 4}" text-anchor="end">${label}</text>`;
  }).join('');
  const limitLine = showLimit
    ? `<line class="vital-chart-limit" x1="${padLeft}" x2="${width - padRight}" y1="${yOf(limit)}" y2="${yOf(limit)}" />
       <text class="vital-chart-label" x="${width - padRight}" y="${Math.max(12, yOf(limit) - 6)}" text-anchor="end">${limit}%</text>`
    : '';
  const marks = [0, Math.floor((samples.length - 1) / 2), samples.length - 1];
  const times = marks.map((index) => {
    const x = padLeft + step * index;
    const anchor = index === 0 ? 'start' : index === samples.length - 1 ? 'end' : 'middle';
    return `<text class="vital-chart-axis" x="${x}" y="${height - 12}" text-anchor="${anchor}">${chartTimeLabel(samples[index].t, span)}</text>`;
  }).join('');
  const last = samples[samples.length - 1];
  const latest = unit === 'percent' ? formatPercent(last.value) : `${Math.round(last.value)}`;
  return `<svg class="vital-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="History ending at ${latest}. Time runs from left to right.">
    ${grid}
    ${limitLine}
    <polyline class="vital-chart-line" fill="none" points="${coords.join(' ')}" />
    ${times}
  </svg>`;
}

module.exports = {
  CPU_HOUR_RED,
  CPU_SUSTAINED,
  CPU_SUSTAINED_POINTS,
  MEMORY_RED,
  MEMORY_WARN,
  clampPercent,
  cpuLevel,
  formatPercent,
  mean,
  memoryLevel,
  parseMetricSeries,
  renderMemoryChart,
  chartTimeLabel,
};
