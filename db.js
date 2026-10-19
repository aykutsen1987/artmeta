/**
 * SQLite kalıcılık katmanı (better-sqlite3).
 * Dosya yolu DB_PATH ile değiştirilebilir. Render'da kalıcı olması için Disk eklenmelidir.
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'artmeta.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artwork_name TEXT, artist TEXT, year TEXT, movement TEXT,
    history TEXT, historical_context TEXT,
    confidence_score REAL, provider TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

const insert = db.prepare(`
  INSERT INTO scans (artwork_name, artist, year, movement, history, historical_context, confidence_score, provider)
  VALUES (@artwork_name, @artist, @year, @movement, @history, @historical_context, @confidence_score, @provider)
`);

module.exports = {
  saveScan: (r) => insert.run(r),
  recentScans: (limit) => db.prepare('SELECT * FROM scans ORDER BY id DESC LIMIT ?').all(limit),
};
