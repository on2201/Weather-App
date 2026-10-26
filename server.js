import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geocode, getForecast } from './src/weather.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

// --- naive in-memory rate limiter -------------------------------------------
const hits = new Map();
function rateLimit({ windowMs = 60_000, max = 90 } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    let entry = hits.get(key);
    if (!entry || now > entry.reset) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    res.set('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests, slow down' });
    }
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
}, 60_000).unref();

// --- routes -----------------------------------------------------------------
app.use('/api', rateLimit());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

app.get('/api/geocode', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2 || q.length > 80) {
      return res.status(400).json({ error: 'Query must be 2–80 characters' });
    }
    const { results, cache } = await geocode(q);
    res.set('X-Cache', cache).json({ results });
  } catch (err) {
    next(err);
  }
});

app.get('/api/weather', async (req, res, next) => {
  try {
    const rawLat = req.query.lat;
    const rawLon = req.query.lon;
    if (typeof rawLat !== 'string' || rawLat.trim() === '') {
      return res.status(400).json({ error: 'Missing lat' });
    }
    if (typeof rawLon !== 'string' || rawLon.trim() === '') {
      return res.status(400).json({ error: 'Missing lon' });
    }
    const lat = Number(rawLat);
    const lon = Number(rawLon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return res.status(400).json({ error: 'lat must be between -90 and 90' });
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'lon must be between -180 and 180' });
    }
    const { data, cache } = await getForecast(lat, lon);
    res.set('X-Cache', cache).json(data);
  } catch (err) {
    next(err);
  }
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error('[error]', err.message);
  res.status(status).json({
    error: status >= 500 ? 'Weather service unavailable, try again' : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`Weather app running at http://localhost:${PORT}`);
});