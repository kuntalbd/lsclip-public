const express = require('express');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const dotenv = require('dotenv');

dotenv.config();

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './data/lsclip.db';
const UPLOADS_PATH = process.env.UPLOADS_PATH || './uploads';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || '';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';

const PROJECT_ROOT = path.join(__dirname, '..');

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
if (!fs.existsSync(UPLOADS_PATH)) fs.mkdirSync(UPLOADS_PATH, { recursive: true });

const { connect } = require(path.join(PROJECT_ROOT, 'db', 'connection'));
const initSchema = require(path.join(PROJECT_ROOT, 'db', 'schema'));

async function start() {
  const db = await connect(DB_PATH);
  initSchema(db);

  function cleanupExpired() {
    const now = new Date().toISOString();

    const expiredClips = db.exec('SELECT slug FROM clips WHERE expires_at < ?', [now]);
    if (expiredClips[0] && expiredClips[0].values) {
      expiredClips[0].values.forEach(row => {
        const slug = row[0];
        const files = db.exec('SELECT stored_name FROM files WHERE slug = ?', [slug]);
        if (files[0] && files[0].values) {
          files[0].values.forEach(fRow => {
            const filePath = path.join(UPLOADS_PATH, fRow[0]);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          });
        }
      });
    }

    db.run('DELETE FROM clips WHERE expires_at < ?', [now]);
    db.run('DELETE FROM files WHERE file_expires_at < ?', [now]);
    db._save();
    console.log('Cleanup: expired clips and files checked');
  }

  cron.schedule('0 3 * * *', cleanupExpired);

  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(PROJECT_ROOT, 'frontend', 'views'));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(PROJECT_ROOT, 'frontend', 'public')));

  app.use('/api', rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
  }));

  const saveLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    skip: (req) => req.method === 'GET',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many saves. Please wait a few minutes.' }
  });
  app.use('/api/clips', saveLimit);

  app.use((req, res, next) => {
    res.locals.BASE_URL = BASE_URL;
    res.locals.TURNSTILE_SITE_KEY = TURNSTILE_SITE_KEY;
    next();
  });

  const healthRoute = require('./api/health');
  const clipRoutes = require('./api/clips');
  const fileRoutes = require('./api/files');

  app.use('/health', healthRoute());
  app.use('/api', clipRoutes(db));
  app.use('/api', fileRoutes(db));

  app.get('/', (req, res) => {
    res.render('index', { BASE_URL, TURNSTILE_SITE_KEY });
  });

  app.get('/help', (req, res) => {
    res.render('help', { BASE_URL, TURNSTILE_SITE_KEY });
  });

  app.get('/about', (req, res) => {
    res.render('about', { BASE_URL, TURNSTILE_SITE_KEY });
  });

  app.get('/:slug', (req, res) => {
    const slug = req.params.slug.toLowerCase();
    res.render('clip', { slug, BASE_URL, TURNSTILE_SITE_KEY });
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.listen(PORT, () => {
    console.log(`LS Clip running on port ${PORT}`);
    console.log(`  DB:        ${DB_PATH}`);
    console.log(`  Uploads:    ${UPLOADS_PATH}`);
    console.log(`  Base URL:   ${BASE_URL}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});