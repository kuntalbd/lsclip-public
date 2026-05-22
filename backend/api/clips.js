const express = require('express');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const path = require('path');
const fs = require('fs');

const UPLOADS_PATH = process.env.UPLOADS_PATH || './uploads';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';

async function verifyTurnstile(token) {
  if (!TURNSTILE_SECRET_KEY || !token) return true;
  try {
    const formData = new URLSearchParams();
    formData.append('secret', TURNSTILE_SECRET_KEY);
    formData.append('response', token);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData
    });
    const data = await r.json();
    return data.success === true;
  } catch {
    return false;
  }
}

function generateSlug() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let slug = '';
  for (let i = 0; i < 5; i++) {
    slug += chars[Math.floor(Math.random() * chars.length)];
  }
  return slug;
}

function isValidSlug(slug) {
  return /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug) && slug.length >= 3 && slug.length <= 32;
}

function recalcExpiry(expiryMode) {
  const days = { 'single_view': 365 * 10, '15d': 15, '1m': 30, '3m': 90, '6m': 180 };
  const d = days[expiryMode] || 15;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + d);
  return expiresAt.toISOString();
}

function getRemoteIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.connection.remoteAddress || 'unknown';
}

module.exports = function(db) {
  const router = express.Router();

  router.post('/clips', async (req, res) => {
    const { slug: customSlug, content, clip_type, access_mode, password, expiry_mode, syntax_language, turnstile_token } = req.body;

    if (content && content.length > 500 * 1024) {
      return res.status(400).json({ error: 'Content exceeds 500 KB limit.' });
    }

    const tsOk = await verifyTurnstile(turnstile_token);
    if (!tsOk) {
      return res.status(400).json({ error: 'Security verification failed. Please refresh and try again.' });
    }

    let slug = customSlug ? customSlug.toLowerCase().trim() : generateSlug();

    if (!isValidSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug. Use 3-32 lowercase alphanumeric chars and hyphens.' });
    }

    const existing = db.exec('SELECT slug FROM clips WHERE slug = ?', [slug]);
    if (existing[0] && existing[0].values && existing[0].values.length > 0) {
      return res.status(409).json({ error: 'This slug is already taken.' });
    }

    let passwordHash = null;
    if (password && (access_mode === 'readonly_public' || access_mode === 'private')) {
      passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    }

    const clipType = clip_type || 'note';
    const accessMode = access_mode || 'full_public';
    const expiryMode = expiry_mode || '15d';
    const expiresAt = recalcExpiry(expiryMode);
    const syntaxLang = syntax_language || null;

    try {
      db.run('INSERT INTO clips (slug, content, clip_type, access_mode, password_hash, expiry_mode, expires_at, syntax_language) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [slug, content || '', clipType, accessMode, passwordHash, expiryMode, expiresAt, syntaxLang]);

      db.run('INSERT INTO access_logs (slug, action, ip_address, user_agent, referer, accept_language) VALUES (?, ?, ?, ?, ?, ?)',
        [slug, 'edit', getRemoteIp(req), req.headers['user-agent'] || null, req.headers['referer'] || null, req.headers['accept-language'] || null]);

      db._save();

      const result = db.exec('SELECT slug, clip_type, access_mode, expiry_mode, expires_at, created_at, visit_count, syntax_language FROM clips WHERE slug = ?', [slug]);
      const clip = result[0] && result[0].values[0] ? rowToObject(result[0], 0, result[0].columns) : null;
      res.status(201).json({ ok: true, clip });
    } catch (err) {
      console.error('Failed to create clip:', err);
      res.status(500).json({ error: 'Failed to create clip.' });
    }
  });

  router.get('/clips/:slug', (req, res) => {
    const slug = req.params.slug.toLowerCase();
    const password = req.headers['x-clip-password'] || null;

    const result = db.exec('SELECT * FROM clips WHERE slug = ?', [slug]);
    if (!result[0] || !result[0].values || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Clip not found.' });
    }

    const columns = result[0].columns;
    const clip = rowToObject(result[0], 0, columns);

    const now = new Date().toISOString();

    if (clip.expiry_mode === 'single_view' && clip.visit_count > 0) {
      db.run('DELETE FROM clips WHERE slug = ?', [slug]);
      db._save();
      return res.status(410).json({ error: 'This single-view clip has been deleted after access.' });
    }

    if (clip.expires_at < now) {
      db.run('DELETE FROM clips WHERE slug = ?', [slug]);
      db._save();
      return res.status(410).json({ error: 'This clip has expired.' });
    }

    if (clip.access_mode === 'private') {
      if (!password || !bcrypt.compareSync(password, clip.password_hash)) {
        db.run('INSERT INTO access_logs (slug, action, ip_address, user_agent, referer, accept_language) VALUES (?, ?, ?, ?, ?, ?)',
          [slug, 'password_fail', getRemoteIp(req), req.headers['user-agent'] || null, req.headers['referer'] || null, req.headers['accept-language'] || null]);
        db._save();
        return res.json({ exists: true, locked: true, slug: clip.slug, clip_type: clip.clip_type, expiry_mode: clip.expiry_mode });
      }
    }

    const isFullView = clip.access_mode === 'full_public' || (password && bcrypt.compareSync(password, clip.password_hash || ''));

    if (isFullView) {
      const newExpiry = recalcExpiry(clip.expiry_mode);
      db.run('UPDATE clips SET last_visited_at = datetime("now"), visit_count = visit_count + 1, expires_at = ? WHERE slug = ?', [newExpiry, slug]);
      db.run('INSERT INTO access_logs (slug, action, ip_address, user_agent, referer, accept_language) VALUES (?, ?, ?, ?, ?, ?)',
        [slug, 'view', getRemoteIp(req), req.headers['user-agent'] || null, req.headers['referer'] || null, req.headers['accept-language'] || null]);
    } else {
      db.run('UPDATE clips SET last_visited_at = datetime("now") WHERE slug = ?', [slug]);
      db.run('INSERT INTO access_logs (slug, action, ip_address, user_agent, referer, accept_language) VALUES (?, ?, ?, ?, ?, ?)',
        [slug, 'view', getRemoteIp(req), req.headers['user-agent'] || null, req.headers['referer'] || null, req.headers['accept-language'] || null]);
    }

    db._save();

    const updatedResult = db.exec('SELECT * FROM clips WHERE slug = ?', [slug]);
    const updatedClip = rowToObject(updatedResult[0], 0, updatedResult[0].columns);

    const fileResult = db.exec('SELECT id, original_name, file_size, download_count, uploaded_at, file_expires_at FROM files WHERE slug = ?', [slug]);
    const file = fileResult[0] && fileResult[0].values.length > 0 ? rowToFile(fileResult[0], 0) : null;

    res.json({
      exists: true, locked: false, restricted: !isFullView,
      slug: updatedClip.slug, content: updatedClip.content,
      clip_type: updatedClip.clip_type, access_mode: updatedClip.access_mode,
      expiry_mode: updatedClip.expiry_mode, visit_count: updatedClip.visit_count,
      expires_at: updatedClip.expires_at, last_visited_at: updatedClip.last_visited_at,
      syntax_language: updatedClip.syntax_language, file: file,
      created_at: updatedClip.created_at
    });
  });

  router.put('/clips/:slug', async (req, res) => {
    const slug = req.params.slug.toLowerCase();
    const { content, password, new_password, access_mode, expiry_mode, clip_type, syntax_language, turnstile_token } = req.body;

    const result = db.exec('SELECT * FROM clips WHERE slug = ?', [slug]);
    if (!result[0] || !result[0].values || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Clip not found.' });
    }

    const columns = result[0].columns;
    const clip = rowToObject(result[0], 0, columns);

    if (content && content.length > 500 * 1024) {
      return res.status(400).json({ error: 'Content exceeds 500 KB limit.' });
    }

    if (clip.access_mode !== 'full_public') {
      if (!password || !bcrypt.compareSync(password, clip.password_hash || '')) {
        return res.status(403).json({ error: 'Invalid password.', locked: true });
      }
    }

    const tsOk = await verifyTurnstile(turnstile_token);
    if (!tsOk) {
      return res.status(400).json({ error: 'Security verification failed. Please refresh and try again.' });
    }

    let newPasswordHash = clip.password_hash;
    if (new_password !== undefined && clip.access_mode !== 'full_public') {
      newPasswordHash = new_password === '' ? null : bcrypt.hashSync(new_password, BCRYPT_ROUNDS);
    }

    const newExpiry = expiry_mode ? recalcExpiry(expiry_mode) : clip.expires_at;

    try {
      db.run('UPDATE clips SET content = ?, password_hash = ?, access_mode = ?, expiry_mode = ?, expires_at = ?, clip_type = ?, syntax_language = ? WHERE slug = ?',
        [
          content !== undefined ? content : clip.content,
          newPasswordHash,
          access_mode || clip.access_mode,
          expiry_mode || clip.expiry_mode,
          newExpiry,
          clip_type || clip.clip_type,
          syntax_language !== undefined ? syntax_language : clip.syntax_language,
          slug
        ]);

      db.run('INSERT INTO access_logs (slug, action, ip_address, user_agent, referer, accept_language) VALUES (?, ?, ?, ?, ?, ?)',
        [slug, 'edit', getRemoteIp(req), req.headers['user-agent'] || null, req.headers['referer'] || null, req.headers['accept-language'] || null]);

      db._save();
      res.json({ ok: true });
    } catch (err) {
      console.error('Failed to update clip:', err);
      res.status(500).json({ error: 'Failed to update clip.' });
    }
  });

  router.delete('/clips/:slug', (req, res) => {
    const slug = req.params.slug.toLowerCase();
    const { password } = req.body;

    const result = db.exec('SELECT * FROM clips WHERE slug = ?', [slug]);
    if (!result[0] || !result[0].values || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Clip not found.' });
    }

    const columns = result[0].columns;
    const clip = rowToObject(result[0], 0, columns);

    if (clip.access_mode !== 'full_public') {
      if (!password || !bcrypt.compareSync(password, clip.password_hash || '')) {
        return res.status(403).json({ error: 'Invalid password.' });
      }
    }

    const filesResult = db.exec('SELECT stored_name FROM files WHERE slug = ?', [slug]);
    if (filesResult[0] && filesResult[0].values) {
      filesResult[0].values.forEach(row => {
        const filePath = path.join(UPLOADS_PATH, row[0]);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      });
    }

    db.run('DELETE FROM clips WHERE slug = ?', [slug]);
    db._save();
    res.json({ ok: true });
  });

  router.get('/check/:slug', (req, res) => {
    const slug = req.params.slug.toLowerCase();
    if (!isValidSlug(slug)) {
      return res.json({ exists: false, valid: false });
    }
    const result = db.exec('SELECT slug, access_mode, password_hash FROM clips WHERE slug = ?', [slug]);
    if (!result[0] || !result[0].values || result[0].values.length === 0) {
      return res.json({ exists: false, valid: true });
    }
    const columns = result[0].columns;
    const row = rowToObject(result[0], 0, columns);
    return res.json({ exists: true, valid: true, locked: !!row.password_hash });
  });

  return router;
};

function rowToObject(resultSet, index, columns) {
  const obj = {};
  columns.forEach((col, i) => {
    obj[col] = resultSet.values[index][i];
  });
  return obj;
}