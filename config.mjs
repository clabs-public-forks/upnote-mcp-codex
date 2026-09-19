import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULTS = Object.freeze({
  urlLimit: 100000,
  listLimit: 50,
  searchLimit: 20,
  recentLimit: 20,
  noteChars: 20000,
  maxResults: 200,
  maxNoteChars: 100000,
});

function parsePositiveInteger(value, name, fallback) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function findDatabase({ env = process.env, platform = process.platform, homeDir = os.homedir() } = {}) {
  if (env.UPNOTE_DB) return path.resolve(env.UPNOTE_DB);

  let candidates;
  if (platform === "win32") {
    candidates = [];
    if (env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, "Packages", "24862ThomasDao.UpNote_kq65c2wy2rx02",
      "LocalCache", "Roaming", "UpNote", "upnote.sqlite3"));
    if (env.APPDATA) candidates.push(path.join(env.APPDATA, "UpNote", "upnote.sqlite3"));
  } else if (platform === "darwin") {
    candidates = [path.join(homeDir, "Library", "Containers", "com.getupnote.mac", "Data",
      "Library", "Application Support", "UpNote", "upnote.sqlite3")];
  } else {
    throw new Error("Set UPNOTE_DB to the full path of upnote.sqlite3 on Linux and other platforms.");
  }

  const match = candidates.find(candidate => candidate && fs.existsSync(candidate));
  if (match) return match;
  throw new Error(
    "UpNote database not found. Set UPNOTE_DB to the full path of upnote.sqlite3."
  );
}

export function loadConfig({ env = process.env, platform = process.platform, homeDir = os.homedir(), tempDir = os.tmpdir() } = {}) {
  const urlLimit = parsePositiveInteger(env.UPNOTE_URL_LIMIT, "UPNOTE_URL_LIMIT", DEFAULTS.urlLimit);
  const snapshotBaseDir = path.resolve(env.UPNOTE_SNAPSHOT_DIR || tempDir);
  return Object.freeze({
    ...DEFAULTS,
    urlLimit,
    get databasePath() { return findDatabase({ env, platform, homeDir }); },
    snapshotBaseDir,
  });
}
