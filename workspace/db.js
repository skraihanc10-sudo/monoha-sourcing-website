// MONOHA Workspace storage: one SQLite file in DATA_DIR (the persistent
// volume), opened with Node's built-in driver so there is nothing native
// to compile in the image. Schema changes are appended to MIGRATIONS and
// applied once, in order, tracked by PRAGMA user_version.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY,
     emp_id TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE,
     phone TEXT NOT NULL DEFAULT '',
     position TEXT NOT NULL DEFAULT '',
     department TEXT NOT NULL DEFAULT '',
     role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','ADMIN','MANAGER','TEAM_LEAD','EMPLOYEE')),
     password_hash TEXT NOT NULL,
     must_change_pw INTEGER NOT NULL DEFAULT 1,
     active INTEGER NOT NULL DEFAULT 1,
     joined_on TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     last_login_at TEXT
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     csrf TEXT NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE TABLE projects (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PLANNING','ACTIVE','ON_HOLD','COMPLETED')),
     lead_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     start_date TEXT NOT NULL DEFAULT '',
     due_date TEXT NOT NULL DEFAULT '',
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE project_members (
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     PRIMARY KEY (project_id, user_id)
   );
   CREATE TABLE tasks (
     id INTEGER PRIMARY KEY,
     project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
     parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO','IN_PROGRESS','REVIEW','REVISION','DONE')),
     priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT')),
     assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     due_date TEXT NOT NULL DEFAULT '',
     approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     approved_at TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX tasks_assignee ON tasks(assignee_id);
   CREATE INDEX tasks_project ON tasks(project_id);
   CREATE INDEX tasks_parent ON tasks(parent_id);
   CREATE TABLE comments (
     id INTEGER PRIMARY KEY,
     task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     body TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'COMMENT' CHECK (kind IN ('COMMENT','APPROVED','REVISION')),
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE files (
     id INTEGER PRIMARY KEY,
     task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     name TEXT NOT NULL,
     stored TEXT NOT NULL UNIQUE,
     size INTEGER NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE attendance (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     day TEXT NOT NULL,
     check_in TEXT,
     check_out TEXT,
     note TEXT NOT NULL DEFAULT '',
     UNIQUE (user_id, day)
   );
   CREATE TABLE notifications (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     text TEXT NOT NULL,
     link TEXT NOT NULL DEFAULT '',
     read_at TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX notifications_user ON notifications(user_id, read_at);
   CREATE TABLE audit_log (
     id INTEGER PRIMARY KEY,
     user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     action TEXT NOT NULL,
     entity TEXT NOT NULL DEFAULT '',
     entity_id INTEGER,
     detail TEXT NOT NULL DEFAULT '',
     ip TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
];

function open(DATA_DIR) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(path.join(DATA_DIR, 'workspace.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  let v = db.prepare('PRAGMA user_version').get().user_version;
  for (; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return db;
}

module.exports = { open };
