const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const UPLOADS_PATH = process.env.UPLOADS_PATH || './uploads';
const MAX_FILE_SIZE = 20 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(UPLOADS_PATH)) fs.mkdirSync(UPLOADS_PATH, { recursive: true });
    cb(null, UPLOADS_PATH);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  }
});

const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE } });

function rowToObject(resultSet, index) {
  if (!resultSet || !resultSet.values || !resultSet.values[index]) return null;
  const obj = {};
  resultSet.columns.forEach((col, i) => {
    obj[col] = resultSet.values[index][i];
  });
  return obj;
}

module.exports = function(db) {
  const router = express.Router();

  router.post('/clips/:slug/file', upload.single('file'), (req, res) => {
    const slug = req.params.slug.toLowerCase();
    const password = req.headers['x-clip-password'] || req.body.password || null;

    const result = db.exec('SELECT * FROM clips WHERE slug = ?', [slug]);
    if (!result[0] || result[0].values.length === 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Clip not found.' });
    }

    const clip = rowToObject(result[0], 0);

    if (clip.access_mode !== 'full_public') {
      if (!password || !bcrypt.compareSync(password, clip.password_hash || '')) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: 'Invalid password.' });
      }
    }

    const existingFile = db.exec('SELECT id FROM files WHERE slug = ?', [slug]);
    if (existingFile[0] && existingFile[0].values.length > 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(409).json({ error: 'A file already exists for this clip. Delete it first.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const fileExpiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    try {
      db.run('INSERT INTO files (slug, original_name, stored_name, file_size, mime_type, download_count, file_expires_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
        [slug, req.file.originalname, req.file.filename, req.file.size, req.file.mimetype, fileExpiresAt]);
      db._save();

      res.status(201).json({
        ok: true,
        file: {
          original_name: req.file.originalname,
          file_size: req.file.size,
          file_expires_at: fileExpiresAt
        }
      });
    } catch (err) {
      if (req.file) fs.unlinkSync(req.file.path);
      console.error('Failed to save file record:', err);
      res.status(500).json({ error: 'Failed to attach file.' });
    }
  });

  router.get('/clips/:slug/file', (req, res) => {
    const slug = req.params.slug.toLowerCase();
    const password = req.headers['x-clip-password'] || req.query.password || null;

    const clipResult = db.exec('SELECT * FROM clips WHERE slug = ?', [slug]);
    if (!clipResult[0] || clipResult[0].values.length === 0) {
      return res.status(404).json({ error: 'Clip not found.' });
    }

    const clip = rowToObject(clipResult[0], 0);

    if (clip.access_mode === 'private') {
      if (!password || !bcrypt.compareSync(password, clip.password_hash || '')) {
        return res.status(403).json({ error: 'Invalid password.' });
      }
    }

    const fileResult = db.exec('SELECT * FROM files WHERE slug = ?', [slug]);
    if (!fileResult[0] || fileResult[0].values.length === 0) {
      return res.status(404).json({ error: 'No file attached to this clip.' });
    }

    const file = rowToObject(fileResult[0], 0);

    if (new Date(file.file_expires_at) < new Date()) {
      const filePath = path.join(UPLOADS_PATH, file.stored_name);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      db.run('DELETE FROM files WHERE id = ?', [file.id]);
      db._save();
      return res.status(410).json({ error: 'File has expired.' });
    }

    db.run('UPDATE files SET download_count = download_count + 1 WHERE id = ?', [file.id]);
    db._save();

    const filePath = path.join(UPLOADS_PATH, file.stored_name);
    if (!fs.existsSync(filePath)) {
      db.run('DELETE FROM files WHERE id = ?', [file.id]);
      db._save();
      return res.status(404).json({ error: 'File not found on disk.' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
    res.setHeader('Content-Type', file.mime_type);
    res.sendFile(filePath);
  });

  router.delete('/clips/:slug/file', (req, res) => {
    const slug = req.params.slug.toLowerCase();
    const { password } = req.body;

    const clipResult = db.exec('SELECT * FROM clips WHERE slug = ?', [slug]);
    if (!clipResult[0] || clipResult[0].values.length === 0) {
      return res.status(404).json({ error: 'Clip not found.' });
    }

    const clip = rowToObject(clipResult[0], 0);

    if (clip.access_mode !== 'full_public') {
      if (!password || !bcrypt.compareSync(password, clip.password_hash || '')) {
        return res.status(403).json({ error: 'Invalid password.' });
      }
    }

    const fileResult = db.exec('SELECT * FROM files WHERE slug = ?', [slug]);
    if (!fileResult[0] || fileResult[0].values.length === 0) {
      return res.status(404).json({ error: 'No file attached.' });
    }

    const file = rowToObject(fileResult[0], 0);

    const filePath = path.join(UPLOADS_PATH, file.stored_name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    db.run('DELETE FROM files WHERE id = ?', [file.id]);
    db._save();
    res.json({ ok: true });
  });

  return router;
};