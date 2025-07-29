const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("db.sqlite");

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS user (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      password TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS category (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      position INTEGER DEFAULT 0
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS pdf (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      isPublic INTEGER DEFAULT 0,
      isPrintable INTEGER DEFAULT 0,
      isDownloadable INTEGER DEFAULT 0,
      category_id INTEGER,
      uploadDate DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(category_id) REFERENCES category(id)
    )`);

    // Insert default user
    const stmt = db.prepare(
        "INSERT INTO user (username, password) VALUES (?, ?)"
    );
    stmt.run("admin", "password");
    stmt.finalize();
});

module.exports = db;
