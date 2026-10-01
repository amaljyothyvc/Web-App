const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

function addColumnIfMissing(db, table, column, declaration) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}

function createDatabase(filename = process.env.DB_PATH || path.join(__dirname, "..", "data", "jobs.db")) {
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      company_email TEXT,
      company_website TEXT,
      location TEXT,
      apiKey TEXT UNIQUE NOT NULL,
      email TEXT,
      password_hash TEXT,
      industry TEXT,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      job_alerts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      job_title TEXT NOT NULL,
      location TEXT,
      experience TEXT,
      salary TEXT,
      skills TEXT,
      description TEXT,
      deadline TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES companies (id)
    );
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      user_id INTEGER,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'Applied',
      FOREIGN KEY (job_id) REFERENCES jobs (id),
      FOREIGN KEY (user_id) REFERENCES users (id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      job_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id),
      FOREIGN KEY (job_id) REFERENCES jobs (id)
    );
  `);

  // Expand the older project's API-key-only schema in place without discarding job posts.
  addColumnIfMissing(db, "companies", "email", "TEXT");
  addColumnIfMissing(db, "companies", "password_hash", "TEXT");
  addColumnIfMissing(db, "companies", "industry", "TEXT");
  addColumnIfMissing(db, "companies", "description", "TEXT");
  addColumnIfMissing(db, "applications", "user_id", "INTEGER");
  addColumnIfMissing(db, "applications", "status", "TEXT NOT NULL DEFAULT 'Applied'");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_email ON companies(lower(email)) WHERE email IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_unique_user_job ON applications(job_id, user_id) WHERE user_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id DESC);
  `);
  return db;
}

module.exports = { createDatabase };
