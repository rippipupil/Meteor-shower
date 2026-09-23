'use strict';

// Todas las fuentes son gratuitas y no necesitan clave:
// - Open-Meteo combina los modelos de los servicios meteorológicos nacionales
//   (AEMET, ECMWF, DWD, NOAA…) y da previsión real hasta 16 días.
// - Su API de archivo ofrece el reanálisis ERA5, con el que se calcula la
//   media real de los últimos años para los días que quedan fuera de la
//   previsión (nadie puede prever el tiempo de un día concreto a 30 días).
const API = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  archive: 'https://archive-api.open-meteo.com/v1/archive',
  geocode: 'https://geocoding-api.open-meteo.com/v1/search',
  reverse: 'https://api.bigdatacloud.net/data/reverse-geocode-client'
};

const PLACE_KEY = 'meteor-shower:place';
const WIDGET_HINT_KEY = 'meteor-shower:widget-hint';
const UNIT_KEY = 'meteor-shower:unit';
const CLIMATE_KEY = 'meteor-shower:climate';
const CLIMATE_YEARS = 10;
const MONTH_DAYS = 30;
const WEEK_DAYS = 7;
const SMOOTH = 3; // media móvil de ±3 días para suavizar la climatología
const STALE_MS = 30 * 60 * 1000;

// Códigos meteorológicos de la OMM que devuelve Open-Meteo, con el icono
// pixel art de día y de noche (archivos de icons/).
const WMO = {
  0: ['Despejado', 'clear-day', 'clear-night'],
  1: ['Mayormente despejado', 'clear-day', 'clear-night'],
  2: ['Parcialmente nuboso', 'partly-day', 'partly-night'],
  3: ['Cubierto', 'cloudy', 'cloudy'],
  45: ['Niebla', 'fog', 'fog'],
  48: ['Niebla con escarcha', 'fog', 'fog'],
  51: ['Llovizna débil', 'drizzle', 'drizzle'],
  53: ['Llovizna', 'drizzle', 'drizzle'],
  55: ['Llovizna intensa', 'drizzle', 'drizzle'],
  56: ['Llovizna helada', 'drizzle', 'drizzle'],
  57: ['Llovizna helada intensa', 'drizzle', 'drizzle'],
  61: ['Lluvia débil', 'rain', 'rain'],
  63: ['Lluvia', 'rain', 'rain'],
  65: ['Lluvia fuerte', 'rain', 'rain'],
  66: ['Lluvia helada', 'rain', 'rain'],
  67: ['Lluvia helada fuerte', 'rain', 'rain'],
  71: ['Nevada débil', 'snow', 'snow'],
  73: ['Nevada', 'snow', 'snow'],
  75: ['Nevada intensa', 'snow', 'snow'],
  77: ['Granizo fino', 'snow', 'snow'],
  80: ['Chubascos débiles', 'rain', 'rain'],
  81: ['Chubascos', 'rain', 'rain'],
  82: ['Chubascos muy fuertes', 'storm', 'storm'],
  85: ['Chubascos de nieve', 'snow', 'snow'],
  86: ['Chubascos de nieve fuertes', 'snow', 'snow'],
  95: ['Tormenta', 'storm', 'storm'],
  96: ['Tormenta con granizo', 'storm', 'storm'],
  99: ['Tormenta fuerte con granizo', 'storm', 'storm']
};
const SNOW_CODES = [71, 73, 75, 77, 85, 86];

const $ = (sel) => document.querySelector(sel);
const el = {
  place: $('#place'), placeName: $('#placeName'), placeDetail: $('#placeDetail'), actions: $('#actions'),
  unitBtn: $('#unitBtn'), refreshBtn: $('#refreshBtn'), changeBtn: $('#changeBtn'),
  welcome: $('#welcome'), locateBtn: $('#locateBtn'), searchForm: $('#searchForm'),
  searchInput: $('#searchInput'), searchResults: $('#searchResults'), welcomeMsg: $('#welcomeMsg'),
  cancelBtn: $('#cancelBtn'), loading: $('#loading'), error: $('#error'), errorMsg: $('#errorMsg'),
  retryBtn: $('#retryBtn'), errorChangeBtn: $('#errorChangeBtn'), weather: $('#weather'),
  hero: $('#hero'), tabs: document.querySelectorAll('[role="tab"]'),
  panels: { hoy: $('#panel-hoy'), semana: $('#panel-semana'), mes: $('#panel-mes') }
};

const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
  }
};

const state = {
  place: validPlace(store.get(PLACE_KEY)),
  unit: store.get(UNIT_KEY) === 'fahrenheit' ? 'fahrenheit' : 'celsius',
  tab: 'hoy',
  forecast: null,
  climate: null, // null = cargando, 'error' o { days, years }
  loadedAt: 0,
  requestId: 0
};

function validPlace(p) {
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? p : null;
}

/* ---------- Utilidades ---------- */

async function fetchJSON(url, timeout = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) throw new Error((data && data.reason) || `error ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

const isoToDate = (iso) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const dateToIso = (d) => d.toISOString().slice(0, 10);
function addDays(iso, n) {
  const d = isoToDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return dateToIso(d);
}
function addYears(iso, n) {
  const d = isoToDate(iso);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return dateToIso(d);
}
const fmtDate = (iso, opts) => new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', ...opts }).format(isoToDate(iso));
const hhmm = (isoTime) => (isoTime ? isoTime.slice(11, 16) : '–');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (v, digits = 0) => (v == null ? '–' : Number(v).toLocaleString('es-ES', { maximumFractionDigits: digits }));
const temp = (v) => (v == null ? '–' : `${Math.round(v)}°`);
const mean = (arr) => {
  const vals = arr.filter((v) => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};
const sum = (arr) => arr.reduce((a, b) => a + (b || 0), 0);
const isF = () => state.unit === 'fahrenheit';
// Umbrales pensados en °C, convertidos si se muestra en °F.
const tUnit = (c) => (isF() ? c * 9 / 5 + 32 : c);
const tDelta = (c) => (isF() ? c * 9 / 5 : c);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function wmo(code, isDay = true) {
  const w = WMO[code] || ['Sin datos', 'cloudy', 'cloudy'];
  return { text: w[0], icon: isDay ? w[1] : w[2] };
}

// Icono pixel art. Los tamaños se fijan por CSS (px-hero, px-md, px-sm…).
const px = (key, cls = '') => `<img class="px ${cls}" src="icons/${key}.svg" alt="" aria-hidden="true">`;
const li = (icon, html) => `<li>${px(icon, 'px-sm')}<span>${html}</span></li>`;

// El puente con Android solo existe dentro del APK: guarda la ubicación
// para que el widget de la pantalla de inicio pueda consultar el tiempo.
const widgetBridge = () => window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.WidgetBridge;

function dayLabel(iso, index, long = false) {
  if (index === 0) return 'Hoy';
  if (index === 1) return 'Mañana';
  return cap(fmtDate(iso, long ? { weekday: 'long', day: 'numeric' } : { weekday: 'short', day: 'numeric' }));
}

function compass(deg) {
  if (deg == null) return '';
  return ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8];
}

// El viento se nombra por de dónde viene; la flecha apunta hacia dónde sopla.
function windArrow(deg) {
  if (deg == null) return '';
  return `<span class="arrow" style="transform: rotate(${Math.round(deg + 180)}deg)" aria-hidden="true">↑</span>`;
}

function uvLevel(uv) {
  if (uv == null) return '';
  if (uv < 3) return 'Bajo';
  if (uv < 6) return 'Moderado';
  if (uv < 8) return 'Alto';
  if (uv < 11) return 'Muy alto';
  return 'Extremo';
}

function humidityLevel(h) {
  if (h == null) return '';
  if (h < 30) return 'Ambiente seco';
  if (h < 60) return 'Confortable';
  if (h < 80) return 'Húmedo';
  return 'Muy húmedo';
}

function pressureLevel(p) {
  if (p == null) return '';
  if (p > 1020) return 'Alta · tiempo estable';
  if (p < 1005) return 'Baja · tiempo inestable';
  return 'Normal';
}

function duration(seconds) {
  if (seconds == null) return '–';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h} h ${m} min`;
}

function isRainy(daily, i) {
  return (daily.precipitation_probability_max[i] ?? 0) >= 50 || (daily.precipitation_sum[i] ?? 0) >= 1;
}

function joinEs(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/* ---------- Datos ---------- */

function forecastUrl(place, unit) {
  const params = new URLSearchParams({
    latitude: place.lat,
    longitude: place.lon,
    timezone: 'auto',
    forecast_days: 16,
    temperature_unit: unit,
    wind_speed_unit: 'kmh',
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,is_day,uv_index,visibility',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,daylight_duration,uv_index_max,precipitation_sum,precipitation_probability_max,precipitation_hours,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant'
  });
  return `${API.forecast}?${params}`;
}

// Media real de los últimos CLIMATE_YEARS años para los próximos 30 días,
// calculada con el reanálisis ERA5 y suavizada con una ventana de ±3 días.
async function loadClimate(place, todayIso, unit) {
  const cacheKey = `${place.lat.toFixed(2)},${place.lon.toFixed(2)}|${todayIso}|${unit}`;
  const cached = store.get(CLIMATE_KEY);
  if (cached && cached.key === cacheKey) return cached.value;

  const span = MONTH_DAYS - 1 + 2 * SMOOTH;
  const start0 = addDays(todayIso, -SMOOTH);
  const requests = [];
  for (let y = 1; y <= CLIMATE_YEARS; y += 1) {
    const start = addYears(start0, -y);
    const params = new URLSearchParams({
      latitude: place.lat,
      longitude: place.lon,
      start_date: start,
      end_date: addDays(start, span),
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
      timezone: 'auto',
      temperature_unit: unit
    });
    requests.push(fetchJSON(`${API.archive}?${params}`, 20000));
  }
  const years = (await Promise.allSettled(requests))
    .filter((r) => r.status === 'fulfilled' && r.value.daily)
    .map((r) => r.value.daily);
  if (years.length < 3) throw new Error('sin datos históricos');

  const days = [];
  for (let i = 0; i < MONTH_DAYS; i += 1) {
    const maxes = [];
    const mins = [];
    const rains = [];
    let recordMax = null;
    let recordMin = null;
    for (const y of years) {
      for (let k = i; k <= i + 2 * SMOOTH; k += 1) {
        if (y.temperature_2m_max[k] != null) maxes.push(y.temperature_2m_max[k]);
        if (y.temperature_2m_min[k] != null) mins.push(y.temperature_2m_min[k]);
        if (y.precipitation_sum[k] != null) rains.push(y.precipitation_sum[k]);
      }
      const hi = y.temperature_2m_max[i + SMOOTH];
      const lo = y.temperature_2m_min[i + SMOOTH];
      if (hi != null && (recordMax == null || hi > recordMax)) recordMax = hi;
      if (lo != null && (recordMin == null || lo < recordMin)) recordMin = lo;
    }
    days.push({
      max: mean(maxes),
      min: mean(mins),
      rain: mean(rains),
      rainChance: rains.length ? rains.filter((p) => p >= 1).length / rains.length : null,
      recordMax,
      recordMin
    });
  }
  const value = { days, years: years.length };
  store.set(CLIMATE_KEY, { key: cacheKey, value });
  return value;
}

async function reverseName(lat, lon) {
  const params = new URLSearchParams({ latitude: lat, longitude: lon, localityLanguage: 'es' });
  const d = await fetchJSON(`${API.reverse}?${params}`, 8000);
  const name = d.city || d.locality || d.principalSubdivision;
  if (!name) return null;
  const region = d.principalSubdivision && d.principalSubdivision !== name ? d.principalSubdivision : null;
  return { name, detail: [region, d.countryName].filter(Boolean).join(', ') };
}

async function searchPlaces(query) {
  const params = new URLSearchParams({ name: query, count: 6, language: 'es', format: 'json' });
  const d = await fetchJSON(`${API.geocode}?${params}`, 8000);
  return (d.results || []).map((r) => ({
    lat: r.latitude,
    lon: r.longitude,
    name: r.name,
    detail: [r.admin1 && r.admin1 !== r.name ? r.admin1 : null, r.country].filter(Boolean).join(', ')
  }));
}

/* ---------- Vistas ---------- */

function showView(name) {
  for (const view of ['welcome', 'loading', 'error', 'weather']) el[view].hidden = view !== name;
  el.actions.hidden = name !== 'weather';
  el.place.hidden = !state.place || name === 'welcome';
}

function showWelcome() {
  el.cancelBtn.hidden = !state.forecast;
  el.searchInput.value = '';
  el.searchResults.innerHTML = '';
  setWelcomeMsg('');
  showView('welcome');
}

function setWelcomeMsg(text, isError = false) {
  el.welcomeMsg.textContent = text;
  el.welcomeMsg.classList.toggle('is-error', isError);
}

function showError(message) {
  el.errorMsg.textContent = message;
  showView('error');
}

function renderHeader() {
  el.placeName.textContent = state.place.name;
  el.placeDetail.textContent = state.place.detail || '';
  el.unitBtn.textContent = isF() ? '°F' : '°C';
  el.unitBtn.setAttribute('aria-label', isF() ? 'Cambiar a grados Celsius' : 'Cambiar a grados Fahrenheit');
}

function renderHero() {
  const f = state.forecast;
  const { current: c, daily: d } = f;
  const w = wmo(c.weather_code, c.is_day);
  const rt = rainTiming(f);
  el.hero.innerHTML = `
    <div class="lcd-bubbles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <div class="lcd-top">
      <span>${cap(fmtDate(d.time[0], { weekday: 'long', day: 'numeric', month: 'short' })).replace('.', '')}</span>
      <span>${hhmm(c.time)} h</span>
    </div>
    <div class="hero-main">
      ${px(w.icon, 'px-hero')}
      <span class="hero-temp">${temp(c.temperature_2m)}</span>
    </div>
    <p class="hero-desc">${w.text}</p>
    <p class="hero-sub">Sensación ${temp(c.apparent_temperature)} · Máx ${temp(d.temperature_2m_max[0])} · Mín ${temp(d.temperature_2m_min[0])}</p>
    <p class="hero-rain ${rt.wet ? 'is-wet' : ''}">${px(rt.wet ? 'umbrella' : 'check', 'px-xs')}<span>${rt.text}</span></p>`;
}

function currentHourIndex(f) {
  const times = f.hourly.time;
  const hour = `${f.current.time.slice(0, 13)}:00`;
  const exact = times.indexOf(hour);
  if (exact !== -1) return exact;
  const next = times.findIndex((t) => t >= f.current.time);
  return next === -1 ? 0 : next;
}

// Primera hora de lo que queda de hoy en la que se espera lluvia (o nieve).
function rainTiming(f) {
  const h = f.hourly;
  const today = f.current.time.slice(0, 10);
  let first = -1;
  let best = -1;
  for (let i = currentHourIndex(f); i < h.time.length && h.time[i].startsWith(today); i += 1) {
    const prob = h.precipitation_probability[i] ?? 0;
    if (first === -1 && (prob >= 50 || (h.precipitation[i] ?? 0) >= 0.3)) first = i;
    if (best === -1 || prob > (h.precipitation_probability[best] ?? 0)) best = i;
  }
  const code = f.current.weather_code;
  if (code >= 51) return { wet: true, text: SNOW_CODES.includes(code) ? 'Nevando ahora' : 'Lloviendo ahora' };
  if (first !== -1) {
    const what = SNOW_CODES.includes(h.weather_code[first]) ? 'Nieve' : 'Lluvia';
    const prob = h.precipitation_probability[first];
    return { wet: true, text: `${what} hoy a las ${hhmm(h.time[first])}${prob != null ? ` (${prob} %)` : ''}` };
  }
  const bestProb = best === -1 ? 0 : (h.precipitation_probability[best] ?? 0);
  if (bestProb >= 25) return { wet: false, text: `Poca lluvia: ${bestProb} % a las ${hhmm(h.time[best])}` };
  return { wet: false, text: 'Sin lluvia prevista hoy' };
}

function buildAdvice(f) {
  const d = f.daily;
  const tips = [];
  const prob = d.precipitation_probability_max[0] ?? 0;
  const rain = d.precipitation_sum[0] ?? 0;
  const code = d.weather_code[0];
  const rt = rainTiming(f);
  if (code >= 95) tips.push(['storm', 'Tormentas posibles']);
  if (SNOW_CODES.includes(code)) tips.push(['snow', 'Nieve · cuidado al conducir']);
  if (rt.wet) tips.push(['umbrella', `${rt.text} · lleva paraguas`]);
  else if (prob >= 30 && rt.text !== 'Sin lluvia prevista hoy') tips.push(['drizzle', rt.text]);
  const uv = d.uv_index_max[0];
  if (uv != null && uv >= 6) tips.push(['clear-day', `UV ${uvLevel(uv).toLowerCase()} (${num(uv)}) · usa protector`]);
  const max = d.temperature_2m_max[0];
  const min = d.temperature_2m_min[0];
  if (max >= tUnit(32)) tips.push(['thermo', 'Mucho calor · bebe agua']);
  if (min <= tUnit(3)) tips.push(['thermo', 'Frío al amanecer · abrígate']);
  else if (max - min >= tDelta(12)) tips.push(['thermo', `${Math.round(max - min)}° entre día y noche · lleva chaqueta`]);
  const gusts = d.wind_gusts_10m_max[0];
  if (gusts >= 50) tips.push(['wind', `Rachas de ${Math.round(gusts)} km/h`]);
  if (!tips.length) tips.push(['check', 'Día tranquilo']);
  return tips;
}

function renderHourly(f) {
  const start = currentHourIndex(f);
  const h = f.hourly;
  const end = Math.min(start + 24, h.time.length);
  const hours = [];
  for (let i = start; i < end; i += 1) hours.push(i);
  if (!hours.length) return '';

  const colW = 58;
  const width = hours.length * colW;
  const height = 58;
  const temps = hours.map((i) => h.temperature_2m[i]);
  // Rango mínimo de 6° para que un día de temperaturas casi planas no deje
  // la línea pegada arriba con un hueco vacío debajo.
  const mid = (Math.min(...temps) + Math.max(...temps)) / 2;
  const half = Math.max((Math.max(...temps) - Math.min(...temps)) / 2, tDelta(3));
  const lo = mid - half;
  const range = half * 2;
  const y = (v) => 22 + (1 - (v - lo) / range) * (height - 30);
  const points = hours.map((_, k) => `${k * colW + colW / 2},${y(temps[k]).toFixed(1)}`).join(' ');
  const labels = hours.map((_, k) => `
    <circle cx="${k * colW + colW / 2}" cy="${y(temps[k]).toFixed(1)}" r="3"></circle>
    <text x="${k * colW + colW / 2}" y="${(y(temps[k]) - 9).toFixed(1)}">${temp(temps[k])}</text>`).join('');

  const cells = hours.map((i, k) => {
    const w = wmo(h.weather_code[i], h.is_day[i]);
    const prob = h.precipitation_probability[i];
    return `
      <li class="hour" title="${w.text}">
        <span class="hour-time">${k === 0 ? 'Ahora' : hhmm(h.time[i])}</span>
        ${px(w.icon, 'px-md')}
        <span class="hour-rain ${prob >= 30 ? 'is-wet' : ''}">${prob == null ? '–' : `${prob}%`}</span>
      </li>`;
  }).join('');

  return `
    <section class="card">
      <h3>Próximas 24 horas</h3>
      <div class="screen hours-scroll">
        <div class="hours" style="width:${width}px">
          <svg class="hours-chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
            <polyline points="${points}"></polyline>${labels}
          </svg>
          <ul class="hours-row">${cells}</ul>
        </div>
      </div>
    </section>`;
}

function detailTile(icon, label, value, sub = '') {
  return `
    <div class="tile">
      <span class="tile-label">${px(icon, 'px-xs')} ${label}</span>
      <span class="tile-value">${value}</span>
      ${sub ? `<span class="tile-sub">${sub}</span>` : ''}
    </div>`;
}

function renderToday() {
  const f = state.forecast;
  const c = f.current;
  const d = f.daily;
  const hi = currentHourIndex(f);
  const uvNow = f.hourly.uv_index[hi];
  const vis = f.hourly.visibility[hi];

  const tiles = [
    detailTile('thermo', 'Sensación', temp(c.apparent_temperature), `Temperatura real ${temp(c.temperature_2m)}`),
    detailTile('drop', 'Humedad', `${num(c.relative_humidity_2m)} %`, humidityLevel(c.relative_humidity_2m)),
    detailTile('wind', 'Viento', `${num(c.wind_speed_10m)} km/h ${windArrow(c.wind_direction_10m)}`,
      `Del ${compass(c.wind_direction_10m)} · rachas ${num(c.wind_gusts_10m)} km/h`),
    detailTile('umbrella', 'Lluvia hoy', `${num(d.precipitation_sum[0], 1)} mm`,
      `Probabilidad ${d.precipitation_probability_max[0] ?? '–'} %${d.precipitation_hours[0] ? ` · ${num(d.precipitation_hours[0])} h` : ''}`),
    detailTile('clear-day', 'Índice UV', num(d.uv_index_max[0]), `${uvLevel(d.uv_index_max[0])} · ahora ${num(uvNow)}`),
    detailTile('cloudy', 'Nubosidad', `${num(c.cloud_cover)} %`, wmo(c.weather_code, c.is_day).text),
    detailTile('gauge', 'Presión', `${num(c.pressure_msl)} hPa`, pressureLevel(c.pressure_msl)),
    detailTile('eye', 'Visibilidad', vis == null ? '–' : `${num(vis / 1000, vis < 10000 ? 1 : 0)} km`,
      vis == null ? '' : vis < 1000 ? 'Muy reducida' : vis < 5000 ? 'Reducida' : 'Buena'),
    detailTile('sunrise', 'Amanecer', hhmm(d.sunrise[0]), `${duration(d.daylight_duration[0])} de luz`),
    detailTile('sunset', 'Atardecer', hhmm(d.sunset[0]), 'Hora local')
  ].join('');

  let normal = '';
  if (state.climate && state.climate !== 'error') {
    const n = state.climate.days[0];
    const diff = d.temperature_2m_max[0] - n.max;
    const verdict = Math.abs(diff) < tDelta(1.5)
      ? 'Temperaturas normales para la época.'
      : `Hoy hace ${Math.round(Math.abs(diff))}° ${diff > 0 ? 'más calor' : 'más frío'} de lo habitual.`;
    normal = `
      <section class="card">
        <h3>Comparado con otros años</h3>
        <p class="lead">${verdict}</p>
        <p class="muted">Media de los últimos ${state.climate.years} años para esta fecha: máx ${temp(n.max)}, mín ${temp(n.min)}.
        Récords en ese periodo: ${temp(n.recordMax)} de máxima y ${temp(n.recordMin)} de mínima.</p>
      </section>`;
  }

  el.panels.hoy.innerHTML = `
    <section class="card advice">
      <h3>Resumen del día</h3>
      <ul class="summary-list">${buildAdvice(f).map(([icon, text]) => li(icon, text)).join('')}</ul>
    </section>
    ${renderHourly(f)}
    <section class="tiles">${tiles}</section>
    ${normal}
    ${widgetHint()}`;
}

function widgetHint() {
  if (!widgetBridge() || store.get(WIDGET_HINT_KEY)) return '';
  return `
    <section class="card widget-hint">
      <h3>Widget en la pantalla de inicio</h3>
      <p>Mantén pulsado un hueco de la pantalla de inicio, toca <strong>Widgets</strong> y arrastra <strong>Meteor Shower</strong>.
      Verás los grados, el cielo y si va a llover hoy sin abrir la app.</p>
      <button type="button" class="link-btn" data-dismiss-widget-hint>Entendido</button>
    </section>`;
}

// Pasa la ubicación al widget de Android para que se actualice solo.
function syncWidget() {
  const bridge = widgetBridge();
  if (!bridge || !state.place) return;
  const { lat, lon, name } = state.place;
  Promise.resolve(bridge.setPlace({ lat, lon, name, unit: state.unit })).catch(() => {});
}

// Burbujas de fondo con tamaños, velocidades y posiciones al azar.
function createBubbles() {
  const box = document.getElementById('bubbles');
  if (!box || box.childElementCount) return;
  const count = window.innerWidth < 600 ? 44 : 64;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i += 1) {
    const b = document.createElement('i');
    const size = Math.round(7 + Math.random() ** 1.7 * 30);
    const dur = 14 + Math.random() * 24;
    b.style.left = `${(Math.random() * 100).toFixed(1)}%`;
    b.style.width = b.style.height = `${size}px`;
    b.style.animationDuration = `${dur.toFixed(1)}s`;
    // Retraso negativo: desde el primer momento hay burbujas repartidas por la pantalla.
    b.style.animationDelay = `${(-Math.random() * dur).toFixed(1)}s`;
    b.style.setProperty('--drift', `${Math.round(Math.random() * 70 - 35)}px`);
    frag.appendChild(b);
  }
  box.appendChild(frag);
}

function renderWeek() {
  const d = state.forecast.daily;
  const n = Math.min(WEEK_DAYS, d.time.length);
  const idx = [...Array(n).keys()];
  const lo = Math.min(...idx.map((i) => d.temperature_2m_min[i]));
  const hi = Math.max(...idx.map((i) => d.temperature_2m_max[i]));
  const span = hi - lo || 1;

  const warmest = idx.reduce((a, b) => (d.temperature_2m_max[b] > d.temperature_2m_max[a] ? b : a), 0);
  const coldest = idx.reduce((a, b) => (d.temperature_2m_min[b] < d.temperature_2m_min[a] ? b : a), 0);
  const rainyDays = idx.filter((i) => isRainy(d, i));
  const rainText = rainyDays.length
    ? `Lluvia probable ${rainyDays.length === 1 ? 'el día' : 'los días'}: ${joinEs(rainyDays.map((i) => dayLabel(d.time[i], i, true).toLowerCase()))} (≈ ${num(sum(rainyDays.map((i) => d.precipitation_sum[i])), 1)} mm en total).`
    : 'No se espera lluvia esta semana.';

  const rows = idx.map((i) => {
    const w = wmo(d.weather_code[i]);
    const min = d.temperature_2m_min[i];
    const max = d.temperature_2m_max[i];
    const left = ((min - lo) / span) * 100;
    const width = Math.max(((max - min) / span) * 100, 4);
    const prob = d.precipitation_probability_max[i];
    return `
      <li>
        <details class="day">
          <summary>
            <span class="day-name">${dayLabel(d.time[i], i)}</span>
            <span class="day-icon" title="${w.text}">${px(w.icon, 'px-md')}</span>
            <span class="day-rain ${prob >= 30 ? 'is-wet' : ''}">${prob ? `${prob}%` : ''}</span>
            <span class="day-min">${temp(min)}</span>
            <span class="range" aria-hidden="true"><span style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></span></span>
            <span class="day-max">${temp(max)}</span>
          </summary>
          <div class="day-details">
            <p><strong>${w.text}</strong> · sensación entre ${temp(d.apparent_temperature_min[i])} y ${temp(d.apparent_temperature_max[i])}</p>
            <dl>
              <div><dt>Lluvia</dt><dd>${num(d.precipitation_sum[i], 1)} mm · ${prob ?? '–'} %</dd></div>
              <div><dt>Viento</dt><dd>${num(d.wind_speed_10m_max[i])} km/h del ${compass(d.wind_direction_10m_dominant[i])} · rachas ${num(d.wind_gusts_10m_max[i])}</dd></div>
              <div><dt>UV máx.</dt><dd>${num(d.uv_index_max[i])} · ${uvLevel(d.uv_index_max[i])}</dd></div>
              <div><dt>Sol</dt><dd>${hhmm(d.sunrise[i])} – ${hhmm(d.sunset[i])}</dd></div>
            </dl>
          </div>
        </details>
      </li>`;
  }).join('');

  el.panels.semana.innerHTML = `
    <section class="card">
      <h3>Resumen de la semana</h3>
      <ul class="summary-list">
        ${li('thermo', `Día más caluroso: <strong>${dayLabel(d.time[warmest], warmest, true).toLowerCase()}</strong> con ${temp(d.temperature_2m_max[warmest])}.`)}
        ${li('clear-night', `Noche más fría: <strong>${dayLabel(d.time[coldest], coldest, true).toLowerCase()}</strong> con ${temp(d.temperature_2m_min[coldest])}.`)}
        ${li('umbrella', rainText)}
      </ul>
    </section>
    <section class="card">
      <h3>Próximos 7 días</h3>
      <p class="muted small">Toca un día para ver más detalles.</p>
      <ul class="week">${rows}</ul>
    </section>`;
}

// Une la previsión (16 días) con la media histórica para completar 30 días.
function monthDays() {
  const d = state.forecast.daily;
  const clim = state.climate && state.climate !== 'error' ? state.climate.days : null;
  const today = d.time[0];
  const days = [];
  const total = clim ? MONTH_DAYS : Math.min(MONTH_DAYS, d.time.length);
  for (let i = 0; i < total; i += 1) {
    const iso = addDays(today, i);
    const normal = clim ? clim[i] : null;
    if (i < d.time.length && d.temperature_2m_max[i] != null) {
      days.push({
        iso, forecast: true, normal,
        max: d.temperature_2m_max[i], min: d.temperature_2m_min[i],
        rain: d.precipitation_sum[i], rainy: isRainy(d, i),
        icon: wmo(d.weather_code[i]).icon, text: wmo(d.weather_code[i]).text
      });
    } else if (normal) {
      const icon = normal.rainChance >= 0.4 ? 'rain' : normal.rainChance >= 0.2 ? 'drizzle' : 'partly-day';
      days.push({
        iso, forecast: false, normal,
        max: normal.max, min: normal.min, rain: normal.rain, rainChance: normal.rainChance,
        icon, text: `Media histórica · lluvia en ${Math.round(normal.rainChance * 100)} % de los años`
      });
    }
  }
  return days;
}

function renderMonthChart(days) {
  const W = 400;
  const H = 190;
  const pad = { l: 30, r: 8, t: 16, b: 24 };
  const values = days.flatMap((x) => [x.max, x.min, x.normal && x.normal.max, x.normal && x.normal.min]).filter((v) => v != null);
  const lo = Math.floor(Math.min(...values)) - 1;
  const hi = Math.ceil(Math.max(...values)) + 1;
  const xs = (i) => pad.l + (i / Math.max(days.length - 1, 1)) * (W - pad.l - pad.r);
  const ys = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = (pick) => days.map((x, i) => [i, pick(x)]).filter(([, v]) => v != null)
    .map(([i, v]) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ');

  const fc = days.filter((x) => x.forecast);
  const lastFc = fc.length - 1;
  const fcLine = (key) => fc.map((x, i) => `${xs(i).toFixed(1)},${ys(x[key]).toFixed(1)}`).join(' ');

  const step = Math.max(1, Math.round((hi - lo) / 4));
  let grid = '';
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    grid += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${ys(v).toFixed(1)}" y2="${ys(v).toFixed(1)}"></line>
      <text class="axis" x="${pad.l - 6}" y="${(ys(v) + 4).toFixed(1)}" text-anchor="end">${v}°</text>`;
  }
  let xLabels = '';
  for (let i = 0; i < days.length; i += 7) {
    xLabels += `<text class="axis" x="${xs(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${fmtDate(days[i].iso, { day: 'numeric', month: 'short' })}</text>`;
  }
  const hasNormal = days.some((x) => x.normal);
  const divider = lastFc >= 0 && lastFc < days.length - 1
    ? `<line class="divider" x1="${xs(lastFc).toFixed(1)}" x2="${xs(lastFc).toFixed(1)}" y1="${pad.t}" y2="${H - pad.b}"></line>
       <text class="axis" x="${(xs(lastFc) + 4).toFixed(1)}" y="${pad.t - 4}">histórico →</text>`
    : '';

  return `
    <figure class="month-chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Temperaturas máximas y mínimas de los próximos ${days.length} días">
        ${grid}${xLabels}${divider}
        ${hasNormal ? `<polyline class="normal" points="${line((x) => x.normal && x.normal.max)}"></polyline>
        <polyline class="normal" points="${line((x) => x.normal && x.normal.min)}"></polyline>` : ''}
        <polyline class="max" points="${fcLine('max')}"></polyline>
        <polyline class="min" points="${fcLine('min')}"></polyline>
      </svg>
      <figcaption class="legend">
        <span><i class="sw max"></i>Máxima prevista</span>
        <span><i class="sw min"></i>Mínima prevista</span>
        ${hasNormal ? '<span><i class="sw normal"></i>Media de otros años</span>' : ''}
      </figcaption>
    </figure>`;
}

function renderMonth() {
  const days = monthDays();
  const fc = days.filter((x) => x.forecast);
  const cl = days.filter((x) => !x.forecast);
  const climReady = state.climate && state.climate !== 'error';

  let summary = `
    ${li('thermo', `Próximas ${fc.length === 16 ? 'dos semanas' : `${fc.length} días`}: máximas de ${temp(mean(fc.map((x) => x.max)))} y mínimas de ${temp(mean(fc.map((x) => x.min)))} de media.`)}
    ${li('umbrella', `${fc.filter((x) => x.rainy).length} días con lluvia probable en la previsión (≈ ${num(sum(fc.map((x) => x.rain)), 0)} mm).`)}`;

  if (climReady && fc.length && cl.length) {
    const fcNormal = mean(fc.map((x) => x.normal.max));
    const diff = mean(fc.map((x) => x.max)) - fcNormal;
    const trend = Math.abs(diff) < tDelta(1)
      ? 'Temperaturas en la media de la época.'
      : `Unos ${num(Math.abs(diff), 1)}° ${diff > 0 ? 'más cálido' : 'más fresco'} de lo normal para estas fechas.`;
    const expectedRain = cl.reduce((a, x) => a + x.rainChance, 0);
    summary += `
      ${li('gauge', trend)}
      ${li('partly-day', `Del ${fmtDate(cl[0].iso, { day: 'numeric', month: 'long' })} en adelante lo habitual es ${temp(mean(cl.map((x) => x.max)))} de máxima y ${temp(mean(cl.map((x) => x.min)))} de mínima, con unos ${Math.round(expectedRain)} días de lluvia.`)}`;
  }

  const blanks = (isoToDate(days[0].iso).getUTCDay() + 6) % 7;
  const weekdays = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((w) => `<span class="cal-head">${w}</span>`).join('');
  const cells = days.map((x, i) => {
    const dayNum = isoToDate(x.iso).getUTCDate();
    const label = i === 0 ? 'Hoy' : dayNum === 1 ? `1 ${fmtDate(x.iso, { month: 'short' }).replace('.', '')}` : dayNum;
    const rainMark = x.forecast && x.rainy ? px('drop', 'cal-drop') : '';
    return `
      <div class="cal-day ${x.forecast ? '' : 'is-normal'} ${i === 0 ? 'is-today' : ''}"
           title="${cap(fmtDate(x.iso, { weekday: 'long', day: 'numeric', month: 'long' }))}: ${x.text}. Máx ${temp(x.max)}, mín ${temp(x.min)}${x.rain != null ? `, ${num(x.rain, 1)} mm` : ''}">
        <span class="cal-num">${label}</span>
        ${px(x.icon, 'cal-icon')}
        <span class="cal-max">${x.forecast ? '' : '≈'}${temp(x.max)}</span>
        <span class="cal-min">${temp(x.min)}</span>
        ${rainMark}
      </div>`;
  }).join('');

  let climNote;
  if (state.climate === null) climNote = '<p class="muted small"><span class="mini-spinner"></span> Calculando la media histórica para completar el mes…</p>';
  else if (state.climate === 'error') climNote = '<p class="muted small">No se pudo cargar el histórico; se muestran solo los días con previsión.</p>';
  else climNote = `<p class="muted small">Los días con borde discontinuo (≈) no tienen previsión fiable todavía: muestran la media real de los últimos ${state.climate.years} años en tu zona.</p>`;

  el.panels.mes.innerHTML = `
    <section class="card">
      <h3>Los próximos 30 días</h3>
      <ul class="summary-list">${summary}</ul>
    </section>
    <section class="card">
      <h3>Evolución de las temperaturas</h3>
      <div class="screen">${renderMonthChart(days)}</div>
    </section>
    <section class="card">
      <h3>Calendario</h3>
      <div class="calendar">${weekdays}${'<span></span>'.repeat(blanks)}${cells}</div>
      ${climNote}
    </section>`;
}

function renderAll() {
  renderHeader();
  renderHero();
  renderToday();
  renderWeek();
  renderMonth();
}

function selectTab(tab) {
  state.tab = tab;
  el.tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  for (const [name, panel] of Object.entries(el.panels)) panel.hidden = name !== tab;
}

/* ---------- Flujo principal ---------- */

async function loadWeather({ quiet = false } = {}) {
  const id = ++state.requestId;
  const { place, unit } = state;
  if (quiet) el.refreshBtn.classList.add('is-spinning');
  else showView('loading');

  try {
    const data = await fetchJSON(forecastUrl(place, unit));
    if (id !== state.requestId) return;
    state.forecast = data;
    state.climate = null;
    state.loadedAt = Date.now();
    renderAll();
    showView('weather');
    syncWidget();

    loadClimate(place, data.daily.time[0], unit)
      .then((climate) => { if (id === state.requestId) state.climate = climate; })
      .catch(() => { if (id === state.requestId) state.climate = 'error'; })
      .finally(() => {
        if (id !== state.requestId) return;
        renderToday();
        renderMonth();
      });
  } catch (err) {
    if (id !== state.requestId) return;
    let msg = 'No se pudo obtener el tiempo. Comprueba tu conexión e inténtalo de nuevo.';
    if (!navigator.onLine) msg = 'Parece que no tienes conexión a internet.';
    else if (err.name === 'AbortError') msg = 'El servicio meteorológico está tardando demasiado en responder. Inténtalo de nuevo.';
    showError(msg);
  } finally {
    if (id === state.requestId) el.refreshBtn.classList.remove('is-spinning');
  }
}

function selectPlace(place) {
  state.place = place;
  state.forecast = null;
  store.set(PLACE_KEY, place);
  renderHeaderFromPlace();
  loadWeather();
}

function renderHeaderFromPlace() {
  el.placeName.textContent = state.place.name;
  el.placeDetail.textContent = state.place.detail || '';
}

function locate() {
  if (!('geolocation' in navigator)) {
    setWelcomeMsg('Tu navegador no permite obtener la ubicación. Busca tu ciudad.', true);
    return;
  }
  if (!window.isSecureContext) {
    setWelcomeMsg('La ubicación solo funciona si la página se abre desde https://. Busca tu ciudad mientras tanto.', true);
    return;
  }
  setWelcomeMsg('Obteniendo tu ubicación…');
  el.locateBtn.disabled = true;
  navigator.geolocation.getCurrentPosition(async (pos) => {
    el.locateBtn.disabled = false;
    setWelcomeMsg('');
    const lat = Number(pos.coords.latitude.toFixed(4));
    const lon = Number(pos.coords.longitude.toFixed(4));
    const place = { lat, lon, name: 'Mi ubicación', detail: `${lat.toFixed(2)}, ${lon.toFixed(2)}` };
    selectPlace(place);
    try {
      const named = await reverseName(lat, lon);
      if (named && state.place === place) {
        Object.assign(place, named);
        store.set(PLACE_KEY, place);
        renderHeaderFromPlace();
        syncWidget();
      }
    } catch { /* se queda con las coordenadas */ }
  }, (err) => {
    el.locateBtn.disabled = false;
    const messages = {
      1: 'Has denegado el permiso de ubicación. Puedes activarlo en los ajustes del navegador o buscar tu ciudad aquí abajo.',
      2: 'No se pudo determinar tu posición. Prueba a buscar tu ciudad.',
      3: 'La ubicación ha tardado demasiado. Inténtalo otra vez o busca tu ciudad.'
    };
    setWelcomeMsg(messages[err.code] || messages[2], true);
  }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 });
}

let searchTimer = 0;
let searchSeq = 0;
async function runSearch(query) {
  const seq = ++searchSeq;
  query = query.trim();
  if (query.length < 2) {
    el.searchResults.innerHTML = '';
    return;
  }
  try {
    const results = await searchPlaces(query);
    if (seq !== searchSeq) return;
    if (!results.length) {
      el.searchResults.innerHTML = '<li class="muted">No se encontró ninguna ciudad con ese nombre.</li>';
      return;
    }
    el.searchResults.innerHTML = results.map((r, i) => `
      <li><button type="button" data-i="${i}">
        <strong>${escapeHtml(r.name)}</strong>
        <span>${escapeHtml(r.detail)}</span>
      </button></li>`).join('');
    el.searchResults.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => selectPlace(results[Number(b.dataset.i)]));
    });
  } catch {
    if (seq === searchSeq) el.searchResults.innerHTML = '<li class="muted">No se pudo buscar. Comprueba tu conexión.</li>';
  }
}

function bindEvents() {
  el.locateBtn.addEventListener('click', locate);
  el.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(el.searchInput.value), 350);
  });
  el.searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(searchTimer);
    runSearch(el.searchInput.value);
  });
  el.cancelBtn.addEventListener('click', () => {
    renderHeader();
    showView('weather');
  });
  el.changeBtn.addEventListener('click', showWelcome);
  el.errorChangeBtn.addEventListener('click', () => {
    state.forecast = null;
    showWelcome();
  });
  el.retryBtn.addEventListener('click', () => loadWeather());
  el.refreshBtn.addEventListener('click', () => loadWeather({ quiet: true }));
  el.unitBtn.addEventListener('click', () => {
    state.unit = isF() ? 'celsius' : 'fahrenheit';
    store.set(UNIT_KEY, state.unit);
    loadWeather({ quiet: true });
  });
  el.tabs.forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
  el.panels.hoy.addEventListener('click', (e) => {
    if (!e.target.closest('[data-dismiss-widget-hint]')) return;
    store.set(WIDGET_HINT_KEY, true);
    const card = e.target.closest('.widget-hint');
    if (card) card.remove();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.forecast && !el.weather.hidden && Date.now() - state.loadedAt > STALE_MS) {
      loadWeather({ quiet: true });
    }
  });
}

createBubbles();
bindEvents();
if (state.place) {
  renderHeaderFromPlace();
  loadWeather();
} else {
  showWelcome();
}
