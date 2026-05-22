module.exports = function initSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS clips (
      slug TEXT PRIMARY KEY,
      content TEXT DEFAULT '',
      clip_type TEXT DEFAULT 'note' CHECK(clip_type IN ('text','code','note','link')),
      access_mode TEXT DEFAULT 'full_public' CHECK(access_mode IN ('full_public','readonly_public','private')),
      password_hash TEXT,
      expiry_mode TEXT DEFAULT '15d' CHECK(expiry_mode IN ('single_view','15d','1m','3m','6m')),
      expires_at TEXT,
      last_visited_at TEXT,
      visit_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      syntax_language TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL REFERENCES clips(slug) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      download_count INTEGER DEFAULT 0,
      uploaded_at TEXT DEFAULT (datetime('now')),
      file_expires_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('view','edit','file_download','password_fail')),
      ip_address TEXT,
      user_agent TEXT,
      referer TEXT,
      accept_language TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_files_slug ON files(slug)');
  db.run('CREATE INDEX IF NOT EXISTS idx_access_logs_slug ON access_logs(slug)');
  db.run('CREATE INDEX IF NOT EXISTS idx_clips_expires_at ON clips(expires_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_files_file_expires_at ON files(file_expires_at)');

  db._save();
};