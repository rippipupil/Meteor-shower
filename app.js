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
  air: 'https://air-quality-api.open-meteo.com/v1/air-quality',
  reverse: 'https://api.bigdatacloud.net/data/reverse-geocode-client'
};

const PLACE_KEY = 'meteor-shower:place';
const PLACES_KEY = 'meteor-shower:places';
const MAX_PLACES = 8;
const WIDGET_HINT_KEY = 'meteor-shower:widget-hint';
const NOTIF_KEY = 'meteor-shower:notifications';
const UNIT_KEY = 'meteor-shower:unit';
const CLIMATE_KEY = 'meteor-shower:climate';
const FORECAST_KEY = 'meteor-shower:forecast';
const CACHE_MAX_AGE = 3 * 24 * 60 * 60 * 1000; // más viejo que esto ya no sirve
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
  welcomeTitle: $('#welcomeTitle'), placeChips: $('#placeChips'), savedPlaces: $('#savedPlaces'), savedList: $('#savedList'),
  hero: $('#hero'), offline: $('#offline'), offlineText: $('#offlineText'), offlineRetry: $('#offlineRetry'), tabs: document.querySelectorAll('[role="tab"]'),
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

// Lugares guardados. El primero es el principal (el que muestra el widget).
function loadPlaces() {
  const saved = store.get(PLACES_KEY);
  if (Array.isArray(saved)) return saved.filter(validPlace);
  const old = validPlace(store.get(PLACE_KEY)); // versión anterior: un solo lugar
  return old ? [old] : [];
}
const initialPlaces = loadPlaces();

const state = {
  places: initialPlaces,
  place: initialPlaces.find((p) => validPlace(store.get(PLACE_KEY)) && samePlace(p, store.get(PLACE_KEY))) || initialPlaces[0] || null,
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

// Dos lugares son el mismo si son "mi ubicación" o están a menos de ~2 km.
function samePlace(a, b) {
  if (!a || !b) return false;
  if (a.gps && b.gps) return true;
  return Math.abs(a.lat - b.lat) < 0.02 && Math.abs(a.lon - b.lon) < 0.02;
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
// Chincheta pixel art para el nombre del lugar en la pantalla LCD.
const PIN = '<svg class="pin" viewBox="0 0 8 8" width="12" height="12" shape-rendering="crispEdges" aria-hidden="true" fill="currentColor">'
  + '<path d="M2 0h4v1h1v1h1v2h-1v1h-1v1h-1v2h-2v-2h-1v-1h-1v-1h-1v-2h1v-1h1zM3 2v2h2v-2z"/></svg>';
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
    hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,is_day,uv_index,visibility,cloud_cover',
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
  el.place.hidden = !state.place || name === 'welcome' || name === 'weather';
  el.placeChips.hidden = state.places.length < 2 || name === 'welcome';
}

function showWelcome() {
  el.cancelBtn.hidden = !state.forecast;
  // Con lugares guardados, la pantalla sirve para gestionarlos.
  const manage = state.places.length > 0;
  el.welcome.classList.toggle('is-manage', manage);
  el.welcomeTitle.textContent = manage ? 'Añadir un lugar' : '¿Qué tiempo hace donde estás?';
  renderSavedPlaces();
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
  setSky(skyMode(c));
  el.hero.innerHTML = `
    <div class="lcd-bubbles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <div class="lcd-top">
      <span class="lcd-place">${PIN}<span>${escapeHtml(state.place.name)}</span></span>
      <span>${cap(fmtDate(d.time[0], { weekday: 'short', day: 'numeric' })).replace('.', '')} · ${hhmm(c.time)}</span>
    </div>
    <div class="hero-main">
      <img class="px px-hero" src="icons/anim/${w.icon}.svg" alt="" aria-hidden="true">
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
  if (rt.wet && /^Nev|^Nieve/.test(rt.text)) tips.push(['snow', `${rt.text} · abrígate`]);
  else if (rt.wet) tips.push(['umbrella', `${rt.text} · lleva paraguas`]);
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
  if (state.climate && state.climate !== 'error') {
    const diff = max - state.climate.days[0].max;
    const normalMax = temp(state.climate.days[0].max);
    if (Math.abs(diff) < tDelta(1.5)) tips.push(['gauge', `Normal para la época (${normalMax})`]);
    else tips.push(['gauge', `${Math.round(Math.abs(diff))}° ${diff > 0 ? 'más' : 'menos'} que lo normal (${normalMax})`]);
  }
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

  // Cuatro fichas a la vista; el resto, en un desplegable.
  const tiles = [
    detailTile('thermo', 'Sensación', temp(c.apparent_temperature), `Real ${temp(c.temperature_2m)}`),
    detailTile('wind', 'Viento', `${num(c.wind_speed_10m)} km/h ${windArrow(c.wind_direction_10m)}`,
      `Del ${compass(c.wind_direction_10m)} · rachas ${num(c.wind_gusts_10m)}`),
    detailTile('umbrella', 'Lluvia hoy', `${num(d.precipitation_sum[0], 1)} mm`,
      `${d.precipitation_probability_max[0] ?? '–'} % de probabilidad`),
    detailTile('clear-day', 'Índice UV', num(d.uv_index_max[0]), `${uvLevel(d.uv_index_max[0])} · ahora ${num(uvNow)}`)
  ].join('');

  const facts = [
    ['drop', 'Humedad', `${num(c.relative_humidity_2m)} %`, humidityLevel(c.relative_humidity_2m)],
    ['cloudy', 'Nubosidad', `${num(c.cloud_cover)} %`, ''],
    ['gauge', 'Presión', `${num(c.pressure_msl)} hPa`, pressureLevel(c.pressure_msl).split(' · ')[0]],
    ['eye', 'Visibilidad', vis == null ? '–' : `${num(vis / 1000, vis < 10000 ? 1 : 0)} km`, '']
  ].map(([icon, label, value, note]) => `
      <div class="fact">
        <dt>${px(icon, 'px-xs')} ${label}</dt>
        <dd>${value}${note ? ` <small>${note}</small>` : ''}</dd>
      </div>`).join('');

  el.panels.hoy.innerHTML = `
    <section class="card advice">
      <h3>Resumen del día</h3>
      <ul class="summary-list">${buildAdvice(f).map(([icon, text]) => li(icon, text)).join('')}</ul>
    </section>
    ${renderHourly(f)}
    <section class="tiles">${tiles}</section>
    ${renderSun(f)}
    ${renderAir()}
    ${renderNightSky(f)}
    <details class="card more"${state.moreOpen ? ' open' : ''}>
      <summary><h3>Más detalles</h3></summary>
      <dl class="facts">${facts}</dl>
    </details>
    ${renderNotifCard()}
    ${widgetHint()}`;
  const more = el.panels.hoy.querySelector('.more');
  more.addEventListener('toggle', () => { state.moreOpen = more.open; });
  checkBackground();
}

/* ---------- Sol: amanecer y atardecer ---------- */

// Hora local del lugar (no la del móvil) en formato ISO «AAAA-MM-DDTHH:MM».
const placeNow = (f) => new Date(Date.now() + (f.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 16);
const minutesBetween = (a, b) => Math.round((Date.parse(`${b}Z`) - Date.parse(`${a}Z`)) / 60000);
const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

// Arco pixel del sol: la parte ya recorrida se ilumina y el sol marca por dónde va.
function sunArc(frac) {
  const W = 60;
  const H = 22;
  // Media elipse recorrida por ángulo, para que los puntos queden repartidos por igual.
  const at = (t) => [2 + (W - 4) * (1 - Math.cos(Math.PI * t)) / 2, H - 2 - (H - 4) * Math.sin(Math.PI * t)];
  let dots = '';
  const N = 24;
  for (let k = 0; k <= N; k++) {
    const [x, y] = at(k / N).map(Math.round);
    dots += `<rect x="${x}" y="${y}" width="1" height="1" fill="${k / N <= frac ? '#ffd35c' : 'rgba(215, 196, 255, 0.35)'}"/>`;
  }
  const on = frac >= 0 && frac <= 1;
  const [sx, sy] = on ? at(frac) : [0, 0];
  return `
    <div class="sun-arc">
      <svg viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" aria-hidden="true">
        ${dots}<rect x="0" y="${H - 1}" width="${W}" height="1" fill="rgba(215, 196, 255, 0.5)"/>
      </svg>
      ${on ? `<img class="px px-md sun-dot" src="icons/clear-day.svg" alt="" style="left:${(sx / W) * 100}%;top:${(sy / H) * 100}%">` : ''}
    </div>`;
}

function renderSun(f) {
  const d = f.daily;
  const rise = d.sunrise[0];
  const set = d.sunset[0];
  if (!rise || !set) return '';
  const now = placeNow(f);
  const frac = (Date.parse(`${now}Z`) - Date.parse(`${rise}Z`)) / (Date.parse(`${set}Z`) - Date.parse(`${rise}Z`));
  let status;
  if (now < rise) status = `Amanece en ${hm(minutesBetween(now, rise))}`;
  else if (now < set) status = `Quedan ${hm(minutesBetween(now, set))} de luz`;
  else if (d.sunrise[1]) status = `Mañana amanece a las ${hhmm(d.sunrise[1])}`;
  else status = 'Ya es de noche';
  const change = d.daylight_duration[1] != null ? Math.round((d.daylight_duration[1] - d.daylight_duration[0]) / 60) : null;
  const trend = change == null ? '' : change === 0 ? ' · mañana, igual' : ` · mañana ${Math.abs(change)} min ${change > 0 ? 'más' : 'menos'}`;
  return `
    <section class="card sun">
      <h3>Sol</h3>
      <div class="screen sun-screen">
        ${sunArc(frac)}
        <div class="sun-times">
          <span>${px('sunrise', 'px-xs')} ${hhmm(rise)}</span>
          <span>${hhmm(set)} ${px('sunset', 'px-xs')}</span>
        </div>
        <p class="sun-status">${status}</p>
      </div>
      <p class="sun-note">${duration(d.daylight_duration[0])} de luz hoy${trend}</p>
    </section>`;
}

/* ---------- Cielo nocturno ---------- */

// Fase lunar calculada a partir de una luna nueva conocida (6 ene 2000,
// 18:14 UTC) y del mes sinódico medio. Error típico: menos de un día.
const SYNODIC = 29.530588853;
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
function moonAge(date) {
  const days = (date.getTime() - REF_NEW_MOON) / 86400000;
  return ((days % SYNODIC) + SYNODIC) % SYNODIC;
}
const moonLight = (age) => (1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2;
function moonPhaseName(age) {
  const names = ['Luna nueva', 'Luna creciente', 'Cuarto creciente', 'Gibosa creciente', 'Luna llena', 'Gibosa menguante', 'Cuarto menguante', 'Luna menguante'];
  return names[Math.round((age / SYNODIC) * 8) % 8];
}

// Dibujo pixel de la luna con la parte iluminada según la fase
// (hemisferio norte: crece por la derecha).
function moonSvg(age, size = 56) {
  const n = 16;
  const r = 6.5;
  const k = Math.cos((2 * Math.PI * age) / SYNODIC);
  const waxing = age < SYNODIC / 2;
  let rects = '';
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const dx = (x + 0.5 - n / 2) / r;
      const dy = (y + 0.5 - n / 2) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const w = Math.sqrt(1 - dy * dy);
      const lit = waxing ? dx > k * w : dx < -k * w;
      const edge = d2 > 0.78;
      const fill = lit ? (edge ? '#e3c46a' : '#fff0b3') : (edge ? '#2b1b47' : '#3a2860');
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
    }
  }
  return `<svg class="moon" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

// Lluvias de estrellas principales (fecha habitual del máximo y tasa
// horaria cenital aproximada, según el calendario de la IMO).
const METEOR_SHOWERS = [
  { name: 'Cuadrántidas', month: 1, day: 3, zhr: 110 },
  { name: 'Líridas', month: 4, day: 22, zhr: 18 },
  { name: 'Eta Acuáridas', month: 5, day: 6, zhr: 50 },
  { name: 'Delta Acuáridas', month: 7, day: 30, zhr: 25 },
  { name: 'Perseidas', month: 8, day: 12, zhr: 100 },
  { name: 'Dracónidas', month: 10, day: 8, zhr: 10 },
  { name: 'Oriónidas', month: 10, day: 21, zhr: 20 },
  { name: 'Leónidas', month: 11, day: 17, zhr: 15 },
  { name: 'Gemínidas', month: 12, day: 14, zhr: 150 },
  { name: 'Úrsidas', month: 12, day: 22, zhr: 10 }
];

function upcomingShowers(todayIso, count = 3) {
  const today = isoToDate(todayIso);
  const year = today.getUTCFullYear();
  const list = [];
  for (const y of [year, year + 1]) {
    for (const m of METEOR_SHOWERS) {
      const peak = new Date(Date.UTC(y, m.month - 1, m.day));
      const days = Math.round((peak - today) / 86400000);
      if (days >= -1) list.push({ ...m, peak, days, moon: moonLight(moonAge(new Date(peak.getTime() + 2 * 3600000))) });
    }
  }
  return list.sort((a, b) => a.days - b.days).slice(0, count);
}

// ¿Se verán las estrellas? Nubosidad media entre las 21:00 y las 05:00.
function starsTonight(f) {
  const h = f.hourly;
  if (!h.cloud_cover) return null;
  const now = f.current.time;
  const today = now.slice(0, 10);
  const lateNight = Number(now.slice(11, 13)) < 5;
  const from = lateNight ? now.slice(0, 13) : `${today}T21`;
  const to = lateNight ? `${today}T05` : `${addDays(today, 1)}T05`;
  const hours = [];
  for (let i = 0; i < h.time.length; i += 1) {
    const t = h.time[i].slice(0, 13);
    if (t >= from && t <= to && h.cloud_cover[i] != null) hours.push({ t: h.time[i], c: h.cloud_cover[i] });
  }
  if (!hours.length) return null;
  const avg = mean(hours.map((x) => x.c));
  const best = hours.reduce((a, b) => (b.c < a.c ? b : a));
  if (avg < 25) return { icon: 'clear-night', good: true, text: 'Despejado · se verán las estrellas' };
  if (avg < 60) return { icon: 'partly-night', good: true, text: `Nubes a ratos · mejor hacia las ${hhmm(best.t)}` };
  return { icon: 'cloudy', good: false, text: 'Cubierto · no se verán las estrellas' };
}

function renderNightSky(f) {
  const now = new Date();
  const age = moonAge(now);
  const light = Math.round(moonLight(age) * 100);
  const daysToFull = ((SYNODIC / 2 - age) + SYNODIC) % SYNODIC;
  const nextFull = new Date(now.getTime() + daysToFull * 86400000);
  const fullText = daysToFull < 1 ? 'hoy' : nextFull.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');
  const stars = starsTonight(f);
  const [next, ...later] = upcomingShowers(f.daily.time[0]);
  const when = (sh) => (sh.days <= 0 ? '¡esta noche!' : sh.days === 1 ? 'mañana' : `en ${sh.days} días`);
  const moonNote = (sh) => (sh.moon > 0.6 ? 'la luna molestará' : sh.moon > 0.3 ? 'algo de luna' : 'sin luna, ideal');
  const date = (sh) => sh.peak.toLocaleDateString('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short' }).replace('.', '');
  return `
    <section class="card night">
      <h3>Cielo nocturno</h3>
      <div class="screen night-moon">
        ${moonSvg(age)}
        <div>
          <p class="night-phase">${moonPhaseName(age)}</p>
          <p class="night-sub">${light} % iluminada</p>
          <p class="night-sub">Luna llena: ${fullText}</p>
        </div>
      </div>
      <ul class="summary-list">
        ${stars ? li(stars.icon, `Esta noche: ${stars.text}${stars.good && light > 70 ? ' (mucha luna)' : ''}`) : ''}
        <li><img class="px px-sm" src="icon.svg" alt="" aria-hidden="true"><span><strong>${next.name}</strong> ${when(next)} (${date(next)}) · hasta ${next.zhr}/h · ${moonNote(next)}</span></li>
      </ul>
      <p class="night-later">Después: ${later.map((sh) => `${sh.name} ${date(sh)}`).join(' · ')}</p>
    </section>`;
}

/* ---------- Aire y polen ---------- */

// Índice europeo de calidad del aire (escala de la Agencia Europea de Medio Ambiente).
const AQI_LEVELS = [[20, 'Buena'], [40, 'Razonable'], [60, 'Moderada'], [80, 'Mala'], [100, 'Muy mala'], [Infinity, 'Extremadamente mala']];
// Polen en granos/m³ con umbrales aproximados de nivel bajo / moderado / alto por especie.
const POLLEN = [
  ['grass_pollen', 'Gramíneas', 20, 50],
  ['olive_pollen', 'Olivo', 50, 200],
  ['birch_pollen', 'Abedul', 10, 100],
  ['alder_pollen', 'Aliso', 10, 100],
  ['mugwort_pollen', 'Artemisa', 10, 50],
  ['ragweed_pollen', 'Ambrosía', 5, 20]
];

async function loadAir(place) {
  const params = new URLSearchParams({
    latitude: place.lat,
    longitude: place.lon,
    timezone: 'auto',
    forecast_days: 1,
    hourly: ['european_aqi', 'pm2_5', 'ozone', ...POLLEN.map(([k]) => k)].join(',')
  });
  return fetchJSON(`${API.air}?${params}`, 12000);
}

function renderAir() {
  const a = state.air;
  if (!a || !a.hourly || !a.hourly.european_aqi) return '';
  const h = a.hourly;
  const now = state.forecast.current.time.slice(0, 13);
  let i = h.time.findIndex((t) => t.slice(0, 13) === now);
  if (i === -1) i = 0;
  const aqi = h.european_aqi[i];
  if (aqi == null) return '';
  const level = AQI_LEVELS.find(([max]) => aqi < max)[1];
  const pos = Math.min(aqi, 100);
  // Máximo de hoy para cada tipo de polen con datos
  const pollen = POLLEN.map(([key, name, mid, high]) => {
    const vals = (h[key] || []).filter((v) => v != null);
    if (!vals.length) return null;
    const max = Math.max(...vals);
    return { name, max, level: max >= high ? 'alto' : max >= mid ? 'moderado' : max >= 1 ? 'bajo' : null };
  }).filter(Boolean);
  const present = pollen.filter((p) => p.level).sort((x, y) => y.max - x.max);
  let pollenHtml = '';
  if (pollen.length) {
    pollenHtml = present.length
      ? `<ul class="pollen">${present.map((p) => `<li class="lvl-${p.level}">${p.name}: ${p.level}</li>`).join('')}</ul>`
      : '<p class="pollen-none">Polen: casi nada hoy</p>';
  }
  return `
    <section class="card air">
      <h3>Aire y polen</h3>
      <div class="aqi">
        <span class="aqi-value">${Math.round(aqi)}</span>
        <div class="aqi-info">
          <span class="aqi-level">Calidad ${level.toLowerCase()}</span>
          <span class="aqi-bar" aria-hidden="true"><i style="left:${pos}%"></i></span>
          <span class="aqi-sub">PM2,5 ${num(h.pm2_5[i])} · ozono ${num(h.ozone[i])} µg/m³</span>
        </div>
      </div>
      ${pollenHtml}
    </section>`;
}

/* ---------- Avisos (solo en la app de Android) ---------- */

const notifSupported = () => Boolean(widgetBridge() && typeof widgetBridge().setNotifications === 'function');
const notifSettings = () => ({ morning: false, morningTime: '08:00', rain: false, ...(store.get(NOTIF_KEY) || {}) });

function renderNotifCard() {
  if (!notifSupported()) return '';
  const n = notifSettings();
  const toggle = (key, on) => `<button type="button" class="toggle${on ? ' is-on' : ''}" data-notif="${key}" aria-pressed="${on}">${on ? 'SÍ' : 'NO'}</button>`;
  return `
    <section class="card notif">
      <h3>Avisos</h3>
      <div class="notif-row">
        <span>${px('clear-day', 'px-sm')} Resumen de la mañana</span>
        ${toggle('morning', n.morning)}
      </div>
      <label class="notif-time"${n.morning ? '' : ' hidden'}>a las <input type="time" value="${escapeHtml(n.morningTime)}" data-notif-time></label>
      <div class="notif-row">
        <span>${px('umbrella', 'px-sm')} Si va a llover en 1 hora</span>
        ${toggle('rain', n.rain)}
      </div>
      <p class="notif-msg" id="notifMsg">Para ${escapeHtml((state.places[0] || {}).name || 'tu lugar principal')}. Android puede retrasarlos unos minutos.</p>
      <div class="bg-row" id="bgRow" hidden>
        <p>Android está ahorrando batería con la app, así que el widget y los avisos pueden no actualizarse.</p>
        <button type="button" class="toggle" data-allow-bg>Permitir</button>
      </div>
    </section>`;
}

// Muestra «Permitir» si Android limita la app en segundo plano (ahorro de batería).
async function checkBackground() {
  const bridge = widgetBridge();
  const row = document.getElementById('bgRow');
  if (!row || !bridge || typeof bridge.batteryStatus !== 'function') return;
  try {
    const res = await bridge.batteryStatus();
    row.hidden = Boolean(res && res.unrestricted);
  } catch { row.hidden = true; }
}

// Envía los ajustes a Android. Con ask = true pide permiso de notificaciones.
async function applyNotifications(ask) {
  if (!notifSupported()) return;
  const n = notifSettings();
  try {
    const res = await widgetBridge().setNotifications({ ...n, ask });
    const msg = document.getElementById('notifMsg');
    if (msg && (n.morning || n.rain) && res && res.granted === false) {
      msg.textContent = 'Permiso de notificaciones denegado. Actívalo en Ajustes › Apps › Meteor Shower.';
      msg.classList.add('is-error');
    }
  } catch { /* versión de la app sin avisos */ }
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
  const main = state.places[0];
  if (!bridge || !main) return;
  const { lat, lon, name } = main;
  Promise.resolve(bridge.setPlace({ lat, lon, name, unit: state.unit })).catch(() => {});
}

// Fondo animado según el tiempo que hace ahora: burbujas con cielo seco,
// gotas si llueve, copos si nieva, rayos si hay tormenta y estrellas (con
// alguna estrella fugaz) en las noches despejadas.
function skyMode(c) {
  const code = c.weather_code;
  if (code >= 95 || code === 82) return 'storm';
  if (SNOW_CODES.includes(code)) return 'snow';
  if (code >= 51) return 'rain';
  if (!c.is_day && code <= 2) return 'night';
  return 'bubbles';
}

const rand = (min, max) => min + Math.random() * (max - min);

function particle(cls, styles) {
  const i = document.createElement('i');
  if (cls) i.className = cls;
  Object.assign(i.style, styles);
  return i;
}

function setSky(mode) {
  const box = document.getElementById('bubbles');
  if (!box || box.dataset.mode === mode) return;
  box.dataset.mode = mode;
  document.body.dataset.sky = mode;
  box.textContent = '';
  const small = window.innerWidth < 600;
  const pick = (list) => list[Math.floor(rand(0, list.length))];
  const frag = document.createDocumentFragment();
  const fall = (cls, n, durMin, durMax, extra) => {
    for (let k = 0; k < n; k += 1) {
      const dur = rand(durMin, durMax);
      // Retraso negativo: desde el primer momento hay partículas por toda la pantalla.
      frag.appendChild(particle(cls, { left: `${rand(0, 100).toFixed(1)}%`, animationDuration: `${dur.toFixed(2)}s`, animationDelay: `${(-rand(0, dur)).toFixed(2)}s`, ...extra() }));
    }
  };
  // Todos los tamaños son múltiplos del dibujo original para que los píxeles se vean nítidos.
  if (mode === 'rain' || mode === 'storm') {
    const heavy = mode === 'storm';
    fall('drop', small ? (heavy ? 75 : 55) : (heavy ? 110 : 80), heavy ? 0.5 : 0.7, heavy ? 0.9 : 1.3,
      () => ({ height: `${pick([8, 12, 12, 16])}px`, opacity: rand(0.55, 0.95).toFixed(2) }));
    if (heavy) {
      // Dos rayos con ritmos distintos; cada uno ilumina la pantalla al caer.
      [[7, -2.5], [11.3, -8]].forEach(([dur, delay]) => {
        const style = { animationDuration: `${dur}s`, animationDelay: `${delay}s` };
        const bolt = particle('bolt', { ...style });
        placeBolt(bolt);
        bolt.addEventListener('animationiteration', () => placeBolt(bolt));
        frag.appendChild(bolt);
        frag.appendChild(particle('flash', { ...style }));
      });
    }
  } else if (mode === 'snow') {
    fall('flake', small ? 45 : 70, 7, 14, () => {
      const size = `${pick([5, 5, 10, 10, 15])}px`;
      return { width: size, height: size, '--sway': `${Math.round(rand(-40, 40))}px` };
    });
  } else if (mode === 'night') {
    for (let k = 0; k < (small ? 45 : 70); k += 1) {
      const cross = Math.random() < 0.25;
      const size = `${cross ? pick([6, 9]) : pick([2, 2, 3, 4])}px`;
      frag.appendChild(particle(cross ? 'star cross' : 'star', { left: `${rand(0, 100).toFixed(1)}%`, top: `${rand(0, 100).toFixed(1)}%`, width: size, height: size, animationDuration: `${rand(1.5, 4).toFixed(2)}s`, animationDelay: `${(-rand(0, 4)).toFixed(2)}s` }));
    }
    frag.appendChild(particle('shooting', {}));
  } else {
    fall('', small ? 44 : 64, 14, 38, () => {
      const size = `${pick([12, 12, 12, 24, 24, 36])}px`;
      return { width: size, height: size, '--drift': `${Math.round(rand(-35, 35))}px` };
    });
  }
  box.appendChild(frag);
}

// Cada vez que un rayo vuelve a caer, lo hace en otro sitio y con otro tamaño.
function placeBolt(bolt) {
  const scale = [4, 5, 6][Math.floor(rand(0, 3))];
  bolt.style.width = `${10 * scale}px`;
  bolt.style.height = `${20 * scale}px`;
  bolt.style.left = `${rand(5, 85).toFixed(1)}%`;
  bolt.style.top = `${rand(2, 40).toFixed(1)}%`;
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

// Última previsión descargada de cada lugar, para abrir al instante y para
// seguir mostrando algo útil cuando no hay conexión.
const cacheKey = (place, unit) => `${place.lat.toFixed(3)},${place.lon.toFixed(3)}|${unit}`;
function readCachedForecast(place, unit) {
  const all = store.get(FORECAST_KEY);
  const c = all && all.entries && all.entries[cacheKey(place, unit)];
  if (!c || Date.now() - c.savedAt > CACHE_MAX_AGE) return null;
  return c;
}
function writeCachedForecast(place, unit, savedAt, data) {
  const all = store.get(FORECAST_KEY);
  const entries = (all && all.entries) || {};
  entries[cacheKey(place, unit)] = { savedAt, data };
  // Solo se conservan los lugares guardados
  const keep = new Set(state.places.flatMap((p) => [cacheKey(p, 'celsius'), cacheKey(p, 'fahrenheit')]));
  for (const k of Object.keys(entries)) if (!keep.has(k)) delete entries[k];
  store.set(FORECAST_KEY, { entries });
}

function renderOffline() {
  const off = state.offlineSince;
  el.offline.hidden = !off;
  if (!off) return;
  const d = new Date(off);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const when = today ? `las ${time}` : `${d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })}, ${time}`;
  el.offlineText.textContent = `Sin conexión · datos de ${when}`;
}

async function loadWeather({ quiet = false } = {}) {
  const id = ++state.requestId;
  const { place, unit } = state;
  const cached = readCachedForecast(place, unit);
  if (!quiet && cached && !state.forecast) {
    // Enseñar ya lo último guardado mientras llegan los datos nuevos.
    state.forecast = cached.data;
    state.loadedAt = cached.savedAt;
    renderAll();
    showView('weather');
    quiet = true;
  }
  if (quiet) el.refreshBtn.classList.add('is-spinning');
  else showView('loading');

  try {
    const data = await fetchJSON(forecastUrl(place, unit));
    if (id !== state.requestId) return;
    state.forecast = data;
    state.climate = null;
    state.loadedAt = Date.now();
    state.offlineSince = null;
    writeCachedForecast(place, unit, state.loadedAt, data);
    renderAll();
    renderOffline();
    showView('weather');
    syncWidget();

    state.air = null;
    loadAir(place)
      .then((air) => { if (id === state.requestId) { state.air = air; renderToday(); } })
      .catch(() => {});

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
    // Sin red: si hay datos guardados de este lugar, se siguen mostrando con aviso.
    const fallback = state.forecast ? { data: state.forecast, savedAt: state.loadedAt } : cached;
    if (fallback) {
      state.forecast = fallback.data;
      state.loadedAt = fallback.savedAt;
      state.offlineSince = fallback.savedAt;
      if (!state.climate) state.climate = 'error';
      renderAll();
      renderOffline();
      showView('weather');
      return;
    }
    let msg = 'No se pudo obtener el tiempo. Comprueba tu conexión e inténtalo de nuevo.';
    if (!navigator.onLine) msg = 'Parece que no tienes conexión a internet.';
    else if (err.name === 'AbortError') msg = 'El servicio meteorológico está tardando demasiado en responder. Inténtalo de nuevo.';
    showError(msg);
  } finally {
    if (id === state.requestId) el.refreshBtn.classList.remove('is-spinning');
  }
}

function savePlaces() {
  store.set(PLACES_KEY, state.places);
  if (state.place) store.set(PLACE_KEY, state.place);
}

// Añade (o actualiza) un lugar y lo muestra.
function selectPlace(place) {
  let idx = state.places.findIndex((p) => samePlace(p, place));
  if (idx === -1) {
    if (state.places.length >= MAX_PLACES) state.places.pop();
    state.places.push(place);
    idx = state.places.length - 1;
  } else {
    state.places[idx] = place;
  }
  switchPlace(idx);
}

function switchPlace(idx) {
  const place = state.places[idx];
  if (!place) return;
  state.place = place;
  state.forecast = null;
  state.climate = null;
  state.offlineSince = null;
  savePlaces();
  renderPlaceChips();
  renderHeaderFromPlace();
  loadWeather();
}

function removePlace(idx) {
  const [gone] = state.places.splice(idx, 1);
  savePlaces();
  if (idx === 0) syncWidget(); // ha cambiado el lugar principal
  renderSavedPlaces();
  renderPlaceChips();
  if (!state.places.length) {
    // No queda ninguno: vuelta a empezar
    state.place = null;
    state.forecast = null;
    store.set(PLACE_KEY, null);
    el.cancelBtn.hidden = true;
  } else if (gone === state.place) {
    switchPlace(0);
  }
}

function makePrimary(idx) {
  const [p] = state.places.splice(idx, 1);
  state.places.unshift(p);
  savePlaces();
  syncWidget();
  renderSavedPlaces();
  renderPlaceChips();
}

// Fila de pestañas con los lugares guardados (solo si hay más de uno).
function renderPlaceChips() {
  const box = el.placeChips;
  box.hidden = state.places.length < 2 || !el.welcome.hidden;
  box.innerHTML = state.places.map((p, i) => `
    <button type="button" class="chip${p === state.place ? ' is-active' : ''}" data-place="${i}"${p === state.place ? ' aria-current="true"' : ''}>
      ${i === 0 ? '<span class="chip-star" aria-label="Principal">★</span>' : ''}${escapeHtml(p.name)}
    </button>`).join('');
  const active = box.querySelector('.is-active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
}

// Lista "Tus lugares" en la pantalla de cambiar ubicación.
function renderSavedPlaces() {
  el.savedPlaces.hidden = !state.places.length;
  el.savedList.innerHTML = state.places.map((p, i) => `
    <li>
      <button type="button" class="saved-name" data-go="${i}">
        <strong>${escapeHtml(p.name)}</strong>
        <span>${i === 0 ? '★ Principal · en el widget' : escapeHtml(p.detail || '')}</span>
      </button>
      ${i === 0 ? '' : `<button type="button" class="saved-btn" data-primary="${i}" aria-label="Hacer principal ${escapeHtml(p.name)}">★</button>`}
      <button type="button" class="saved-btn" data-remove="${i}" aria-label="Borrar ${escapeHtml(p.name)}">✕</button>
    </li>`).join('');
}

function renderHeaderFromPlace() {
  el.placeName.textContent = state.place.name;
  el.placeDetail.textContent = state.place.detail || '';
  if (state.forecast) renderHero();
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
    const place = { lat, lon, gps: true, name: 'Mi ubicación', detail: `${lat.toFixed(2)}, ${lon.toFixed(2)}` };
    selectPlace(place);
    try {
      const named = await reverseName(lat, lon);
      if (named && state.place === place) {
        Object.assign(place, named);
        savePlaces();
        renderHeaderFromPlace();
        renderPlaceChips();
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
  el.placeChips.addEventListener('click', (e) => {
    const b = e.target.closest('[data-place]');
    if (b && state.places[b.dataset.place] !== state.place) switchPlace(Number(b.dataset.place));
  });
  el.savedList.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    const primary = e.target.closest('[data-primary]');
    const remove = e.target.closest('[data-remove]');
    if (remove) removePlace(Number(remove.dataset.remove));
    else if (primary) makePrimary(Number(primary.dataset.primary));
    else if (go) switchPlace(Number(go.dataset.go));
  });
  el.panels.hoy.addEventListener('change', (e) => {
    if (!e.target.matches('[data-notif-time]') || !e.target.value) return;
    store.set(NOTIF_KEY, { ...notifSettings(), morningTime: e.target.value });
    applyNotifications(false);
  });
  // Deslizar sobre la pantalla principal cambia de lugar.
  let touch = null;
  el.hero.addEventListener('touchstart', (e) => { touch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
  el.hero.addEventListener('touchend', (e) => {
    if (!touch || state.places.length < 2) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) < 50 || Math.abs(dy) > 40) return;
    const i = state.places.indexOf(state.place);
    const n = state.places.length;
    switchPlace((i + (dx < 0 ? 1 : -1) + n) % n);
  });
  el.errorChangeBtn.addEventListener('click', () => {
    state.forecast = null;
    showWelcome();
  });
  el.retryBtn.addEventListener('click', () => loadWeather());
  el.refreshBtn.addEventListener('click', () => loadWeather({ quiet: true }));
  el.offlineRetry.addEventListener('click', () => loadWeather({ quiet: true }));
  // Al recuperar la conexión se actualiza solo.
  window.addEventListener('online', () => { if (state.offlineSince) loadWeather({ quiet: true }); });
  el.unitBtn.addEventListener('click', () => {
    state.unit = isF() ? 'celsius' : 'fahrenheit';
    store.set(UNIT_KEY, state.unit);
    loadWeather({ quiet: true });
  });
  el.tabs.forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
  el.panels.hoy.addEventListener('click', (e) => {
    const t = e.target.closest('[data-notif]');
    if (t) {
      const n = notifSettings();
      n[t.dataset.notif] = !n[t.dataset.notif];
      store.set(NOTIF_KEY, n);
      renderToday();
      applyNotifications(true);
      checkBackground();
      return;
    }
    if (e.target.closest('[data-allow-bg]')) {
      widgetBridge().allowBackground().catch(() => {});
      return;
    }
    if (!e.target.closest('[data-dismiss-widget-hint]')) return;
    store.set(WIDGET_HINT_KEY, true);
    const card = e.target.closest('.widget-hint');
    if (card) card.remove();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkBackground(); // al volver de los ajustes
    if (document.visibilityState === 'visible' && state.forecast && !el.weather.hidden && Date.now() - state.loadedAt > STALE_MS) {
      loadWeather({ quiet: true });
    }
  });
}

setSky('bubbles');
bindEvents();
applyNotifications(false); // vuelve a programar los avisos guardados
if (state.place) {
  if (!store.get(PLACES_KEY)) savePlaces(); // migra el lugar único de versiones anteriores
  renderPlaceChips();
  renderHeaderFromPlace();
  loadWeather();
} else {
  showWelcome();
}
