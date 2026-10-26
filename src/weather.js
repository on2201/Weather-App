import { get as cacheGet, set as cacheSet } from './cache.js';
import { describe } from './wmo.js';

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

const GEO_TTL = 24 * 60 * 60_000; // 24h — city coordinates don't move
const FORECAST_TTL = 5 * 60_000;  // 5min — weather does
const UPSTREAM_TIMEOUT = 8000;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'weather-app/1.0' },
    });
    if (!res.ok) {
      throw Object.assign(new Error(`Upstream returned ${res.status}`), { status: 502 });
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('Upstream timed out'), { status: 504 });
    }
    if (err.status) throw err;
    throw Object.assign(new Error('Upstream unreachable'), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

export async function geocode(query) {
  const key = `geo:${query.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return { results: cached, cache: 'HIT' };

  const url = new URL(GEO_URL);
  url.searchParams.set('name', query);
  url.searchParams.set('count', '8');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const raw = await fetchJson(url);
  const results = (raw.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    admin1: r.admin1 ?? '',
    country: r.country ?? '',
    countryCode: r.country_code ?? '',
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone ?? '',
    population: r.population ?? 0,
  }));

  cacheSet(key, results, GEO_TTL);
  return { results, cache: 'MISS' };
}

export async function getForecast(lat, lon) {
  const key = `fc:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = cacheGet(key);
  if (cached) return { data: cached, cache: 'HIT' };

  const url = new URL(FORECAST_URL);
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,' +
      'precipitation,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl'
  );
  url.searchParams.set('hourly', 'temperature_2m,weather_code,precipitation_probability');
  url.searchParams.set(
    'daily',
    'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max'
  );
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '7');

  const raw = await fetchJson(url);
  if (!raw.current || !raw.hourly || !raw.daily) {
    throw Object.assign(new Error('Malformed upstream payload'), { status: 502 });
  }

  const data = {
    timezone: raw.timezone,
    utcOffsetSeconds: raw.utc_offset_seconds,
    current: {
      time: raw.current.time,
      temperature: raw.current.temperature_2m,
      feelsLike: raw.current.apparent_temperature,
      humidity: raw.current.relative_humidity_2m,
      precipitation: raw.current.precipitation,
      code: raw.current.weather_code,
      description: describe(raw.current.weather_code),
      isDay: raw.current.is_day === 1,
      windSpeed: raw.current.wind_speed_10m,
      windDirection: raw.current.wind_direction_10m,
      pressure: raw.current.pressure_msl,
    },
    hourly: raw.hourly.time.map((time, i) => ({
      time,
      temperature: raw.hourly.temperature_2m[i],
      code: raw.hourly.weather_code[i],
      description: describe(raw.hourly.weather_code[i]),
      precipitationProbability: raw.hourly.precipitation_probability[i],
    })),
    daily: raw.daily.time.map((date, i) => ({
      date,
      code: raw.daily.weather_code[i],
      description: describe(raw.daily.weather_code[i]),
      max: raw.daily.temperature_2m_max[i],
      min: raw.daily.temperature_2m_min[i],
      sunrise: raw.daily.sunrise[i],
      sunset: raw.daily.sunset[i],
      precipitationProbability: raw.daily.precipitation_probability_max[i],
    })),
  };

  cacheSet(key, data, FORECAST_TTL);
  return { data, cache: 'MISS' };
}