const init = require('sql.js');
const fs = require('fs');
const path = require('path');

let db = null;

async function connect(dbPath) {
  const SQL = await init();

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA journal_mode = WAL');

  const saveDb = () => {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  };

  const originalRun = db.run.bind(db);
  db._save = saveDb;

  db.runSafe = function(sql, params) {
    if (params && params.length > 0) {
      db.run(sql, params);
    } else {
      db.run(sql);
    }
    saveDb();
  };

  return db;
}

module.exports = { connect };