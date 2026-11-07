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

function capabilityList(body) {
  if (Array.isArray(body)) {
    return body;
  }
  if (Array.isArray(body?.value)) {
    return body.value;
  }
  return [];
}

function capabilityName(item) {
  return String(item?.properties?.name || item?.name || '');
}

function capabilityValue(item) {
  if (item?.properties && Object.prototype.hasOwnProperty.call(item.properties, 'value')) {
    return item.properties.value;
  }
  return item?.value;
}

function memoryMbFromCapabilities(capabilities) {
  const match = (capabilities || []).find((item) => capabilityName(item).toLowerCase() === 'memory');
  const value = Number(capabilityValue(match));
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

// Azure's plan capabilities call returns scale-out, not RAM. These are the
// published sizes for the SKU name on the plan resource.
const PUBLISHED_MEMORY_MB = {
  b1: 1792,
  s1: 1792,
  p1: 1792,
  b2: 3584,
  s2: 3584,
  p2: 3584,
  b3: 7168,
  s3: 7168,
  p3: 7168,
  p1v2: 3584,
  p2v2: 7168,
  p3v2: 14336,
  p0v3: 4096,
  p1v3: 8192,
  p1mv3: 16384,
  p2v3: 16384,
  p2mv3: 32768,
  p3v3: 32768,
  p3mv3: 65536,
  p4mv3: 131072,
  p5mv3: 262144,
  p0v4: 4096,
  p1v4: 8192,
  p1mv4: 16384,
  p2v4: 16384,
  p2mv4: 32768,
  p3v4: 32768,
  p3mv4: 65536,
  p4mv4: 131072,
  p5mv4: 262144,
  i1: 3584,
  i2: 7168,
  i3: 14336,
  i1v2: 8192,
  i1mv2: 16384,
  i2v2: 16384,
  i2mv2: 32768,
  i3v2: 32768,
  i3mv2: 65536,
  f1: 1024,
  d1: 1024,
};

function publishedMemoryMb(sku) {
  const key = String(sku || '').toLowerCase();
  return PUBLISHED_MEMORY_MB[key] ?? null;
}

function positiveCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return Math.round(number);
}

function workerCount(plan) {
  return positiveCount(plan?.properties?.currentNumberOfWorkers)
    ?? positiveCount(plan?.properties?.numberOfWorkers)
    ?? positiveCount(plan?.sku?.capacity);
}

const OS_RESERVE_MB = 2048;

function osReserveMb(memoryMb) {
  if (memoryMb == null || !(memoryMb > 0)) {
    return null;
  }
  if (memoryMb <= OS_RESERVE_MB) {
    return Math.floor(memoryMb / 2);
  }
  return OS_RESERVE_MB;
}

function appCapacityMb(memoryMb) {
  const reserve = osReserveMb(memoryMb);
  if (reserve == null) {
    return null;
  }
  return memoryMb - reserve;
}

function usagePercent(appBytes, memoryMb) {
  if (appBytes == null || Number.isNaN(appBytes) || memoryMb == null || !(memoryMb > 0)) {
    return null;
  }
  return (appBytes / (memoryMb * 1024 * 1024)) * 100;
}

function planMemory({ memoryMb, appBytes, cacheValues, incomplete }) {
  const reserve = osReserveMb(memoryMb);
  const capacity = appCapacityMb(memoryMb);
  const memoryHour = usagePercent(appBytes, capacity);
  return {
    appMemoryMb: appBytes == null ? null : appBytes / (1024 * 1024),
    osReserveMb: reserve,
    appCapacityMb: capacity,
    memoryHour,
    memoryLevel: memoryLevel(memoryHour),
    cacheHour: mean(cacheValues),
    memoryIncomplete: Boolean(incomplete) && appBytes != null,
  };
}

function sumSeries(seriesList) {
  const buckets = new Map();
  for (const series of seriesList || []) {
    for (const point of series || []) {
      if (point?.value == null || Number.isNaN(point.value)) {
        continue;
      }
      const list = buckets.get(point.t) || [];
      list.push(point.value);
      buckets.set(point.t, list);
    }
  }
  return [...buckets.entries()]
    .sort((left, right) => (left[0] < right[0] ? -1 : 1))
    .map(([t, values]) => ({
      t,
      value: values.reduce((sum, value) => sum + value, 0),
    }));
}

function formatMegabytes(mb) {
  if (mb == null || Number.isNaN(Number(mb))) {
    return '—';
  }
  const value = Number(mb);
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs === 0 || abs >= 1024) {
    const rounded = Math.round((abs / 1024) * 10) / 10;
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${sign}${text} GB`;
  }
  return `${sign}${Math.round(abs)} MB`;
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
  OS_RESERVE_MB,
  appCapacityMb,
  capabilityList,
  chartTimeLabel,
  clampPercent,
  cpuLevel,
  formatMegabytes,
  formatPercent,
  mean,
  memoryLevel,
  memoryMbFromCapabilities,
  osReserveMb,
  publishedMemoryMb,
  parseMetricSeries,
  planMemory,
  renderMemoryChart,
  sumSeries,
  usagePercent,
  workerCount,
};
