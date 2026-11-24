'use strict';

const fs = require('fs');
const path = require('path');
const { runMigrations } = require('./migrations');

/**
 * Document store persisted as one JSON file.
 * Writes are atomic (temp file + rename). All mutations run inside tx(),
 * which restores the previous snapshot if the callback throws.
 * Single-process by design; see README for the production database upgrade path.
 */
class Store {
  constructor(file) {
    this.file = file;
    this.data = null;
  }

  open() {
    if (fs.existsSync(this.file)) {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } else {
      this.data = { schemaVersion: 0 };
    }
    const applied = runMigrations(this.data);
    if (applied > 0 || !fs.existsSync(this.file)) this.save();
    return this;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  tx(fn) {
    const snapshot = JSON.stringify(this.data);
    try {
      const result = fn(this.data);
      this.save();
      return result;
    } catch (err) {
      this.data = JSON.parse(snapshot);
      throw err;
    }
  }

  read(fn) {
    return fn(this.data);
  }
}

module.exports = { Store };
