const els = {
  search: document.getElementById('search'),
  results: document.getElementById('results'),
  geo: document.getElementById('geo'),
  unit: document.getElementById('unit'),
  status: document.getElementById('status'),
  now: document.getElementById('now'),
  hourlyCard: document.getElementById('hourly-card'),
  hourly: document.getElementById('hourly'),
  dailyCard: document.getElementById('daily-card'),
  daily: document.getElementById('daily'),
};

const state = {
  unit: localStorage.getItem('unit') === 'f' ? 'f' : 'c',
  place: null,
  data: null,
};

// --- utils -------------------------------------------------------------------
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

const toF = (c) => c * 9 / 5 + 32;

function fmtTemp(c) {
  if (c == null || Number.isNaN(c)) return '–';
  return `${Math.round(state.unit === 'f' ? toF(c) : c)}°`;
}

function fmtWind(kmh) {
  if (kmh == null) return '–';
  return state.unit === 'f' ? `${Math.round(kmh * 0.621371)} mph` : `${Math.round(kmh)} km/h`;
}

function iconFor(code, isDay = true) {
  if (code === 0) return isDay ? '☀️' : '🌙';
  if (code === 1) return isDay ? '🌤️' : '🌙';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '❄️';
  if (code >= 80 && code <= 82) return '🌧️';
  if (code === 85 || code === 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

// ISO strings from Open-Meteo carry no offset; compare/slice them as plain strings
// so we never accidentally reinterpret them in the browser's timezone.
const hourLabel = (iso) => iso.slice(11, 16);

function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

function setStatus(message, isError = false) {
  if (!message) {
    els.status.hidden = true;
    els.status.textContent = '';
    return;
  }
  els.status.hidden = false;
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
}

async function api(path, params, signal) {
  const url = new URL(path, location.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

// --- search ------------------------------------------------------------------
let searchController = null;

const hideResults = () => {
  els.results.hidden = true;
  els.results.innerHTML = '';
};

function renderResults(results, errorMessage) {
  els.results.innerHTML = '';
  if (errorMessage) {
    els.results.innerHTML = `<li class="r-empty">${esc(errorMessage)}</li>`;
    els.results.hidden = false;
    return;
  }
  if (!results.length) {
    els.results.innerHTML = `<li class="r-empty">No matches</li>`;
    els.results.hidden = false;
    return;
  }
  for (const r of results) {
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.innerHTML = `
      <div class="r-name">${esc(r.name)}</div>
      <div class="r-meta">${esc([r.admin1, r.country].filter(Boolean).join(', '))}</div>`;
    const pick = () => {
      els.search.value = r.name;
      hideResults();
      loadWeather(r);
    };
    li.addEventListener('click', pick);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick();
      }
    });
    els.results.appendChild(li);
  }
  els.results.hidden = false;
}

const runSearch = debounce(async (q) => {
  searchController?.abort();
  if (q.trim().length < 2) return hideResults();

  searchController = new AbortController();
  try {
    const { results } = await api('/api/geocode', { q: q.trim() }, searchController.signal);
    renderResults(results);
  } catch (err) {
    if (err.name === 'AbortError') return;
    renderResults([], err.message);
  }
}, 300);

els.search.addEventListener('input', (e) => runSearch(e.target.value));
els.search.addEventListener('focus', () => {
  if (els.results.children.length) els.results.hidden = false;
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) hideResults();
});
els.search.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideResults();
});

// --- weather -----------------------------------------------------------------
let weatherController = null;

async function loadWeather(place) {
  weatherController?.abort();
  weatherController = new AbortController();
  setStatus('Loading weather…');

  try {
    const data = await api(
      '/api/weather',
      { lat: place.latitude, lon: place.longitude },
      weatherController.signal
    );
    state.place = place;
    state.data = data;
    localStorage.setItem('lastPlace', JSON.stringify(place));
    setStatus(null);
    render();
  } catch (err) {
    if (err.name === 'AbortError') return;
    setStatus(err.message, true);
  }
}

els.geo.addEventListener('click', () => {
  if (!navigator.geolocation) return setStatus('Geolocation is not supported by this browser', true);
  setStatus('Getting your location…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      loadWeather({
        name: 'My location',
        admin1: '',
        country: '',
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
    },
    (err) => setStatus(`Location unavailable: ${err.message}`, true),
    { timeout: 10_000, maximumAge: 60_000 }
  );
});

els.unit.addEventListener('click', () => {
  state.unit = state.unit === 'c' ? 'f' : 'c';
  localStorage.setItem('unit', state.unit);
  els.unit.textContent = state.unit === 'c' ? '°C' : '°F';
  render();
});

// --- rendering ---------------------------------------------------------------
function render() {
  els.unit.textContent = state.unit === 'c' ? '°C' : '°F';

  const { place, data } = state;
  if (!place || !data) return;

  const { current, hourly, daily } = data;

  // Current conditions
  els.now.hidden = false;
  els.now.innerHTML = `
    <div class="now-head">
      <div class="now-icon">${iconFor(current.code, current.isDay)}</div>
      <div>
        <div class="now-temp">${fmtTemp(current.temperature)}</div>
        <div class="now-desc">${esc(current.description)} · feels like ${fmtTemp(current.feelsLike)}</div>
      </div>
    </div>
    <div class="now-place">
      <strong>${esc(place.name)}</strong>
      ${esc([place.admin1, place.country].filter(Boolean).join(', '))}
    </div>
    <div class="now-meta">
      <div><span>Humidity</span><strong>${current.humidity ?? '–'}%</strong></div>
      <div><span>Wind</span><strong>${fmtWind(current.windSpeed)}</strong></div>
      <div><span>Precip.</span><strong>${current.precipitation ?? 0} mm</strong></div>
      <div><span>Pressure</span><strong>${Math.round(current.pressure ?? 0)} hPa</strong></div>
      <div><span>Sunrise</span><strong>${hourLabel(daily[0].sunrise)}</strong></div>
      <div><span>Sunset</span><strong>${hourLabel(daily[0].sunset)}</strong></div>
    </div>`;

  // Next 24 hours, anchored to the API's own "current" timestamp.
  const startIdx = Math.max(0, hourly.findIndex((h) => h.time >= current.time));
  const slice = hourly.slice(startIdx, startIdx + 24);
  els.hourlyCard.hidden = slice.length === 0;
  els.hourly.innerHTML = slice
    .map(
      (h) => `
      <div class="hour">
        <div class="h-time">${hourLabel(h.time)}</div>
        <div class="h-icon">${iconFor(h.code, true)}</div>
        <div class="h-temp">${fmtTemp(h.temperature)}</div>
        <div class="h-pop">${h.precipitationProbability > 0 ? `${h.precipitationProbability}%` : ''}</div>
      </div>`
    )
    .join('');

  // 7-day
  els.dailyCard.hidden = false;
  els.daily.innerHTML = daily
    .map(
      (d) => `
      <div class="day">
        <div class="d-name">${esc(dayLabel(d.date))}</div>
        <div class="d-icon">${iconFor(d.code, true)}</div>
        <div class="d-desc">${esc(d.description)}</div>
        <div class="d-temp">${fmtTemp(d.max)}<span class="min">${fmtTemp(d.min)}</span></div>
      </div>`
    )
    .join('');
}

// --- boot --------------------------------------------------------------------
(function boot() {
  els.unit.textContent = state.unit === 'c' ? '°C' : '°F';
  const saved = localStorage.getItem('lastPlace');
  if (saved) {
    try {
      const place = JSON.parse(saved);
      els.search.value = place.name;
      loadWeather(place);
      return;
    } catch {
      localStorage.removeItem('lastPlace');
    }
  }
  els.search.focus();
})();