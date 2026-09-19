import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FILE_SUFFIXES = ["", "-wal", "-shm"];

function metadata(fileSystem, file) {
  try {
    const stat = fileSystem.statSync(file, { bigint: true });
    return {
      exists: true,
      size: stat.size.toString(),
      mtimeNs: stat.mtimeNs.toString(),
      ctimeNs: stat.ctimeNs.toString(),
      ino: stat.ino.toString(),
    };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false };
    throw error;
  }
}

function metadataSet(fileSystem, source) {
  return Object.fromEntries(FILE_SUFFIXES.map(suffix => [
    suffix,
    metadata(fileSystem, source + suffix),
  ]));
}

function sameMetadata(left, right) {
  return FILE_SUFFIXES.every(suffix => JSON.stringify(left?.[suffix]) === JSON.stringify(right?.[suffix]));
}

export class SnapshotDatabase {
  constructor({ sourcePath, snapshotBaseDir, fileSystem = fs, databaseFactory = file => new DatabaseSync(file), onBeforeCopyAttempt } = {}) {
    if (!sourcePath) throw new Error("A source database path is required.");
    this.sourcePath = sourcePath;
    this.fileSystem = fileSystem;
    this.databaseFactory = databaseFactory;
    this.onBeforeCopyAttempt = onBeforeCopyAttempt;
    const baseDir = snapshotBaseDir || os.tmpdir();
    this.fileSystem.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    this.snapshotDir = this.fileSystem.mkdtempSync(path.join(baseDir, "upnote-mcp-"));
    try { this.fileSystem.chmodSync(this.snapshotDir, 0o700); } catch { /* Windows may not support POSIX modes. */ }
    this.snapshotPath = path.join(this.snapshotDir, "upnote.sqlite3");
    this.database = null;
    this.lastMetadata = null;
    this.closed = false;
  }

  all(sql, ...params) {
    return this.getDatabase().prepare(sql).all(...params);
  }

  get(sql, ...params) {
    return this.getDatabase().prepare(sql).get(...params);
  }

  getDatabase() {
    if (this.closed) throw new Error("The UpNote snapshot has been closed.");
    const current = metadataSet(this.fileSystem, this.sourcePath);
    if (!current[""].exists) {
      throw new Error(`UpNote database not found at ${this.sourcePath}. Set UPNOTE_DB to the full path of upnote.sqlite3.`);
    }
    if (!this.database || !sameMetadata(current, this.lastMetadata)) {
      this.refresh(current);
    }
    return this.database;
  }

  refresh(initialMetadata) {
    if (this.database) {
      try { this.database.close(); } catch { /* already closed */ }
      this.database = null;
    }

    let copiedMetadata;
    let lastStart;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const start = metadataSet(this.fileSystem, this.sourcePath);
      lastStart = start;
      this.onBeforeCopyAttempt?.(attempt, start);
      const temporary = FILE_SUFFIXES.map(suffix => path.join(
        this.snapshotDir,
        `upnote.sqlite3.copy-${process.pid}-${attempt}${suffix}`
      ));
      try {
        for (let index = 0; index < FILE_SUFFIXES.length; index += 1) {
          const suffix = FILE_SUFFIXES[index];
          const from = this.sourcePath + suffix;
          const to = temporary[index];
          removeIfPresent(this.fileSystem, to);
          if (start[suffix].exists) this.fileSystem.copyFileSync(from, to);
        }
        const end = metadataSet(this.fileSystem, this.sourcePath);
        if (sameMetadata(start, end)) {
          copiedMetadata = end;
          replaceSnapshot(this.fileSystem, temporary, FILE_SUFFIXES, this.snapshotDir);
          break;
        }
      } finally {
        for (const file of temporary) removeIfPresent(this.fileSystem, file);
      }
      if (attempt === 3) {
        throw new Error(
          `Could not copy a stable UpNote database snapshot after 3 attempts. ` +
          `UpNote is changing ${this.sourcePath} while it is being copied; close or pause UpNote and try again.`
        );
      }
    }

    if (!copiedMetadata || !sameMetadata(copiedMetadata, initialMetadata) && !sameMetadata(copiedMetadata, lastStart)) {
      // The metadata captured for the successful copy is authoritative. The
      // next query will refresh again if UpNote changed after that point.
      copiedMetadata = copiedMetadata || lastStart;
    }
    try {
      const opened = this.databaseFactory(this.snapshotPath);
      validateSnapshot(opened);
      this.database = opened;
      this.lastMetadata = copiedMetadata;
    } catch (error) {
      try { this.database?.close(); } catch { /* already closed */ }
      this.database = null;
      throw new Error(`The copied UpNote snapshot could not be opened or validated: ${error.message}`);
    }
  }

  close({ cleanup = true } = {}) {
    if (this.closed) return;
    try { this.database?.close(); } catch { /* already closed */ }
    this.database = null;
    if (cleanup) removeIfPresent(this.fileSystem, this.snapshotDir, true);
    this.closed = true;
  }
}

function replaceSnapshot(fileSystem, temporary, suffixes, snapshotDir) {
  for (let index = 0; index < suffixes.length; index += 1) {
    const destination = path.join(snapshotDir, `upnote.sqlite3${suffixes[index]}`);
    removeIfPresent(fileSystem, destination);
    if (fileSystem.existsSync(temporary[index])) fileSystem.renameSync(temporary[index], destination);
  }
}

function removeIfPresent(fileSystem, target, recursive = false) {
  try { fileSystem.rmSync(target, { force: true, recursive }); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function validateSnapshot(database) {
  const integrity = database.prepare("PRAGMA integrity_check").get();
  if (!integrity || Object.values(integrity)[0] !== "ok") {
    throw new Error("SQLite integrity_check failed.");
  }
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  const names = new Set(tables.map(row => row.name));
  for (const required of ["notes", "notebooks", "lists"]) {
    if (!names.has(required)) throw new Error(`required table ${required} is missing`);
  }
}

export { FILE_SUFFIXES, metadataSet, sameMetadata, validateSnapshot };
