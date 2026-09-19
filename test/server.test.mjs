import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, after } from "node:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadConfig, findDatabase } from "../config.mjs";
import { SnapshotDatabase } from "../database.mjs";
import { callbackUrl, openUrl, openerForPlatform } from "../launcher.mjs";
import { createToolService, TOOL_DEFINITIONS } from "../tools.mjs";

const tempRoots = [];

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "upnote-mcp-test-"));
  tempRoots.push(root);
  const sourcePath = path.join(root, "upnote.sqlite3");
  const live = new DatabaseSync(sourcePath);
  live.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=1000000;");
  live.exec(`
    CREATE TABLE notebooks (id TEXT PRIMARY KEY, title TEXT, deleted INTEGER DEFAULT 0);
    CREATE TABLE lists (id TEXT PRIMARY KEY, content TEXT);
    CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, text TEXT, updatedAt INTEGER, createdAt INTEGER, trashed INTEGER DEFAULT 0);
    CREATE TABLE tags (id TEXT PRIMARY KEY, title TEXT, deleted INTEGER DEFAULT 0);
  `);
  const addNotebook = live.prepare("INSERT INTO notebooks (id,title,deleted) VALUES (?,?,?)");
  const addNote = live.prepare("INSERT INTO notes (id,title,text,updatedAt,createdAt,trashed) VALUES (?,?,?,?,?,?)");
  const addList = live.prepare("INSERT INTO lists (id,content) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content");
  const addTag = live.prepare("INSERT INTO tags (id,title,deleted) VALUES (?,?,?)");
  addNotebook.run("nb-alpha", "Alpha", 0);
  addNotebook.run("nb-archive", "Alpha Archive", 0);
  addNotebook.run("nb-recipes", "Recipes", 0);
  addNotebook.run("nb-trash", "Deleted Notebook", 1);
  addNote.run("n1", "Sourdough", "starter and bread", 100, 90, 0);
  addNote.run("n2", "Trashed", "starter", 110, 100, 1);
  addNote.run("n3", "Recipes note", "pasta", 120, 115, 0);
  addNote.run("n4", "Long note", "x".repeat(120), 130, 125, 0);
  addList.run("notebooks_nb-alpha", JSON.stringify(["n1", "n2"]));
  addList.run("notebooks_nb-recipes", JSON.stringify(["n3", "n4"]));
  addList.run("notebooks_nb-archive", JSON.stringify([]));
  for (let index = 0; index < 205; index += 1) {
    const id = `bulk-${index}`;
    addNote.run(id, `Bulk ${index}`, `needle ${index}`, 200 + index, 200 + index, 0);
  }
  addList.run("notebooks_nb-recipes", JSON.stringify(["n3", "n4", ...Array.from({ length: 205 }, (_, index) => `bulk-${index}`)]));
  addTag.run("tag-1", "bread", 0);
  addTag.run("tag-2", "hidden", 1);
  return { root, sourcePath, live, addNote };
}

function testConfig(defaults = {}) {
  return {
    defaultNotebook: "Codex Notes", urlLimit: 100000, listLimit: 50, searchLimit: 20, recentLimit: 20,
    noteChars: 20000, maxResults: 200, maxNoteChars: 100000, ...defaults,
  };
}

function serviceFor(fixture, config = testConfig(), launches = []) {
  const database = new SnapshotDatabase({ sourcePath: fixture.sourcePath, snapshotBaseDir: fixture.root });
  const launcher = { open: async url => { launches.push(url); } };
  return { database, service: createToolService({ database, launcher, config }), launches };
}

function textOf(response) { return response.content.map(block => block.text).join("\n"); }

test("tool definitions expose all thirteen tools, schemas, titles, and accurate annotations", () => {
  assert.equal(TOOL_DEFINITIONS.length, 13);
  assert.deepEqual(TOOL_DEFINITIONS.map(tool => tool.name), [
    "upnote_create_note", "upnote_create_notebook", "upnote_list_notebooks", "upnote_list_notes",
    "upnote_search_notes", "upnote_get_note", "upnote_recent_notes", "upnote_list_tags", "upnote_open_note", "upnote_open_notebook",
    "upnote_open_tag", "upnote_open_filter", "upnote_view",
  ]);
  for (const tool of TOOL_DEFINITIONS) {
    assert.ok(tool.title);
    assert.ok(tool.inputSchema && tool.outputSchema);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  assert.equal(TOOL_DEFINITIONS.filter(tool => tool.annotations.readOnlyHint).length, 6);
  assert.equal(TOOL_DEFINITIONS.find(tool => tool.name === "upnote_create_note").annotations.readOnlyHint, false);
  assert.equal(TOOL_DEFINITIONS.find(tool => tool.name === "upnote_open_note").annotations.idempotentHint, false);
  assert.deepEqual(TOOL_DEFINITIONS.find(tool => tool.name === "upnote_view").inputSchema.properties.mode.enum, [
    "all_notes", "quick_access", "templates", "trash", "notebooks", "tags", "filters", "all_notebooks", "all_tags",
  ]);
  assert.equal(TOOL_DEFINITIONS.find(tool => tool.name === "upnote_create_note").inputSchema.properties.markdown.default, true);
});

test("synthetic WAL fixture supports reads, trash filtering, ambiguity, empty search, and truncation", async t => {
  const fixture = makeFixture();
  t.after(() => fixture.live.close());
  const { database, service } = serviceFor(fixture);
  t.after(() => database.close());

  const notebooks = await service.call("upnote_list_notebooks");
  assert.equal(notebooks.structuredContent.count, 3);
  assert.match(textOf(notebooks), /Alpha \[id: nb-alpha\]/);

  const exact = await service.call("upnote_list_notes", { notebook: "Alpha", limit: 10 });
  assert.deepEqual(exact.structuredContent.notes.map(note => note.id), ["n1"]);
  const ambiguous = await service.call("upnote_list_notes", { notebook: "Alph" });
  assert.equal(ambiguous.isError, true);
  assert.match(textOf(ambiguous), /Alpha Archive/);

  const trashed = await service.call("upnote_get_note", { id: "n2" });
  assert.equal(trashed.isError, true);
  const empty = await service.call("upnote_search_notes", { query: "" });
  assert.equal(empty.isError, undefined);
  assert.deepEqual(empty.structuredContent.notes, []);

  const note = await service.call("upnote_get_note", { id: "n4", max_chars: 10 });
  assert.equal(note.structuredContent.truncated, true);
  assert.equal(note.structuredContent.returnedChars, 10);
  assert.match(textOf(note), /truncated/);

  const capped = await service.call("upnote_list_notes", { notebook: "Recipes", limit: 999 });
  assert.equal(capped.structuredContent.notes.length, 200);
  assert.equal(capped.structuredContent.truncated, true);
  const searchCapped = await service.call("upnote_search_notes", { query: "needle", limit: 999 });
  assert.equal(searchCapped.structuredContent.notes.length, 200);
  assert.equal(searchCapped.structuredContent.truncated, true);
  const tags = await service.call("upnote_list_tags");
  assert.deepEqual(tags.structuredContent.tags, [{ id: "tag-1", title: "bread" }]);
});

test("validates required strings, unknown fields, and positive integer limits", async t => {
  const fixture = makeFixture();
  t.after(() => fixture.live.close());
  const { database, service } = serviceFor(fixture);
  t.after(() => database.close());
  for (const [name, args, message] of [
    ["upnote_get_note", { id: "n1", extra: true }, "Unknown argument"],
    ["upnote_get_note", { id: "n1", max_chars: 0 }, "positive integer"],
    ["upnote_search_notes", { query: 1 }, "must be a string"],
    ["upnote_list_notes", { notebook: "Recipes", limit: 1.5 }, "positive integer"],
  ]) {
    const response = await service.call(name, args);
    assert.equal(response.isError, true);
    assert.match(textOf(response), new RegExp(message));
  }
});

test("URL encoding, dispatch wording, URL limits, and launcher failures are observable", async t => {
  const fixture = makeFixture();
  t.after(() => fixture.live.close());
  const launches = [];
  const { database, service } = serviceFor(fixture, testConfig(), launches);
  t.after(() => database.close());
  const dispatched = await service.call("upnote_create_note", { title: "A & B", content: "? # % + =", notebook: "Recipes" });
  assert.match(textOf(dispatched), /request dispatched/);
  assert.equal(dispatched.structuredContent.confirmed, false);
  assert.match(launches[0], /title=A%20%26%20B/);
  assert.match(launches[0], /text=%3F%20%23%20%25%20%2B%20%3D/);
  assert.match(launches[0], /&notebook=Recipes/);
  const opened = await service.call("upnote_open_notebook", { notebook: "Recipes" });
  assert.match(textOf(opened), /request dispatched/);

  const limited = serviceFor(fixture, testConfig({ urlLimit: 50 }));
  t.after(() => limited.database.close());
  const tooLong = await limited.service.call("upnote_create_note", { title: "title", content: "x".repeat(100) });
  assert.equal(tooLong.isError, true);
  assert.match(textOf(tooLong), /configured limit/);

  const failing = serviceFor(fixture);
  failing.service = createToolService({ database: failing.database, config: testConfig(), launcher: { open: async () => { throw new Error("launcher unavailable"); } } });
  t.after(() => failing.database.close());
  const failed = await failing.service.call("upnote_open_note", { id: "n1" });
  assert.equal(failed.isError, true);
  assert.match(textOf(failed), /launcher unavailable/);
});

test("documented URL endpoints encode parameters, preserve booleans, and dispatch without database access", async () => {
  const launches = [];
  const service = createToolService({
    database: { all: () => { throw new Error("database should not be used"); }, get: () => { throw new Error("database should not be used"); } },
    launcher: { open: async url => launches.push(url) },
    config: testConfig(),
  });
  const call = async (name, args) => {
    const response = await service.call(name, args);
    assert.equal(response.isError, undefined, textOf(response));
    assert.equal(response.structuredContent.dispatched, true);
    assert.equal(response.structuredContent.confirmed, false);
    return response;
  };

  const defaultMarkdown = await call("upnote_create_note", { title: "A & B", content: "# body", notebook: "Notes" });
  let parsed = new URL(launches.at(-1));
  assert.equal(parsed.pathname, "/note/new");
  assert.equal(parsed.searchParams.get("markdown"), "true");
  assert.equal(parsed.searchParams.get("new_window"), null);
  assert.equal(defaultMarkdown.structuredContent.markdown, true);

  await call("upnote_create_note", { title: "Plain", content: "body", markdown: false, new_window: false });
  parsed = new URL(launches.at(-1));
  assert.equal(parsed.searchParams.get("markdown"), "false");
  assert.equal(parsed.searchParams.get("new_window"), "false");
  await call("upnote_create_note", { title: "Window", content: "body", new_window: true });
  parsed = new URL(launches.at(-1));
  assert.equal(parsed.searchParams.get("markdown"), "true");
  assert.equal(parsed.searchParams.get("new_window"), "true");

  await call("upnote_open_note", { id: "note & one" });
  parsed = new URL(launches.at(-1));
  assert.equal(parsed.pathname, "/openNote");
  assert.equal(parsed.searchParams.get("noteId"), "note & one");
  assert.equal(parsed.searchParams.get("new_window"), null);
  await call("upnote_open_note", { id: "note-2", new_window: false });
  assert.equal(new URL(launches.at(-1)).searchParams.get("new_window"), "false");
  await call("upnote_open_note", { id: "note-3", new_window: true });
  assert.equal(new URL(launches.at(-1)).searchParams.get("new_window"), "true");

  await call("upnote_open_tag", { tag: "bread & butter" });
  parsed = new URL(launches.at(-1));
  assert.equal(parsed.pathname, "/tag/view");
  assert.equal(parsed.searchParams.get("tag"), "bread & butter");
  await call("upnote_open_filter", { filter_id: "filter/#1" });
  parsed = new URL(launches.at(-1));
  assert.equal(parsed.pathname, "/openFilter");
  assert.equal(parsed.searchParams.get("filterId"), "filter/#1");

  const modeCases = [
    ["all_notes", {}], ["quick_access", {}], ["templates", {}], ["trash", {}],
    ["all_notebooks", {}], ["all_tags", {}], ["notebooks", { notebook_id: "nb & one" }],
    ["tags", { tag_id: "tag/one" }], ["filters", { filter_id: "filter one" }],
  ];
  for (const [mode, extra] of modeCases) {
    await call("upnote_view", { mode, ...extra });
    parsed = new URL(launches.at(-1));
    assert.equal(parsed.pathname, "/view");
    assert.equal(parsed.searchParams.get("mode"), mode);
    for (const [key, value] of Object.entries(extra)) assert.equal(parsed.searchParams.get(key.replaceAll("_", "").replace("notebookid", "notebookId").replace("tagid", "tagId").replace("filterid", "filterId")), value);
  }
  await call("upnote_view", { note_id: "note/one" });
  parsed = new URL(launches.at(-1));
  assert.equal(parsed.searchParams.get("noteId"), "note/one");
  assert.equal(parsed.searchParams.get("mode"), null);
  await call("upnote_view", { action: "search", query: "A & B" });
  parsed = new URL(launches.at(-1));
  assert.equal(parsed.searchParams.get("action"), "search");
  assert.equal(parsed.searchParams.get("query"), "A & B");
  await call("upnote_view", { space_id: "default" });
  assert.equal(new URL(launches.at(-1)).searchParams.get("spaceId"), "default");
});

test("URL navigation rejects invalid combinations before launching and enforces URL limits", async () => {
  const launches = [];
  const service = createToolService({
    database: { all: () => { throw new Error("database should not be used"); }, get: () => { throw new Error("database should not be used"); } },
    launcher: { open: async url => launches.push(url) },
    config: testConfig({ urlLimit: 80 }),
  });
  for (const [name, args, message] of [
    ["upnote_view", {}, /Provide/],
    ["upnote_view", { mode: "unknown" }, /must be one of/],
    ["upnote_view", { mode: "notebooks" }, /notebook_id.*required/],
    ["upnote_view", { mode: "tags", tag_id: "" }, /tag_id.*required/],
    ["upnote_view", { mode: "filters", filter_id: "f", mode_extra: true }, /Unknown argument/],
    ["upnote_view", { notebook_id: "n" }, /requires mode/],
    ["upnote_view", { query: "q" }, /requires action/],
    ["upnote_view", { action: "search" }, /query.*required/],
    ["upnote_view", { action: "search", query: "q", note_id: "n" }, /cannot be combined/],
    ["upnote_open_tag", { tag: "" }, /must not be empty/],
    ["upnote_open_filter", { filter_id: "" }, /must not be empty/],
    ["upnote_open_note", { id: "n", new_window: "true" }, /must be a boolean/],
    ["upnote_create_note", { title: "t", content: "c", markdown: "true" }, /must be a boolean/],
  ]) {
    const response = await service.call(name, args);
    assert.equal(response.isError, true, textOf(response));
    assert.match(textOf(response), message);
  }
  assert.equal(launches.length, 0);
  const tooLong = await service.call("upnote_view", { action: "search", query: "x".repeat(100) });
  assert.equal(tooLong.isError, true);
  assert.match(textOf(tooLong), /configured limit/);
  assert.equal(launches.length, 0);
});

test("snapshot refresh retries unstable copies, isolates processes, and cleans up", async t => {
  const fixture = makeFixture();
  t.after(() => fixture.live.close());
  let attempts = 0;
  const retried = new SnapshotDatabase({
    sourcePath: fixture.sourcePath,
    snapshotBaseDir: fixture.root,
    onBeforeCopyAttempt: attempt => {
      attempts = attempt;
      if (attempt === 1) fixture.addNote.run("retry-note", "Retry", "changed", 999, 999, 0);
    },
  });
  const rows = retried.all("SELECT id FROM notes WHERE id = 'retry-note'");
  assert.deepEqual(rows.map(row => row.id), ["retry-note"]);
  assert.equal(attempts, 2);
  const firstDir = retried.snapshotDir;
  const isolated = new SnapshotDatabase({ sourcePath: fixture.sourcePath, snapshotBaseDir: fixture.root });
  assert.notEqual(firstDir, isolated.snapshotDir);
  assert.notEqual(retried.snapshotPath, isolated.snapshotPath);
  retried.close();
  isolated.close();
  assert.equal(fs.existsSync(firstDir), false);
  assert.equal(fs.existsSync(isolated.snapshotDir), false);

  let unstableAttempts = 0;
  const unstable = new SnapshotDatabase({
    sourcePath: fixture.sourcePath,
    snapshotBaseDir: fixture.root,
    onBeforeCopyAttempt: () => {
      unstableAttempts += 1;
      fixture.addNote.run(`unstable-${unstableAttempts}`, "Unstable", "changed", 1000 + unstableAttempts, 1000, 0);
    },
  });
  assert.throws(() => unstable.all("SELECT 1"), /after 3 attempts/);
  assert.equal(unstableAttempts, 3);
  unstable.close();
});

test("database discovery failures preserve URL tools and can be retried", async t => {
  const fixture = makeFixture();
  t.after(() => fixture.live.close());
  for (const platform of ["linux", "darwin", "win32"]) {
    const env = {};
    const config = loadConfig({ env, platform, homeDir: fixture.root, tempDir: fixture.root });
    const database = new SnapshotDatabase({ sourcePath: () => config.databasePath, snapshotBaseDir: config.snapshotBaseDir });
    t.after(() => database.close());
    const launches = [];
    const service = createToolService({ database, config, launcher: { open: async url => launches.push(url) } });
    assert.equal(service.definitions.length, 13);
    for (const [name, args] of [
      ["upnote_create_note", { title: "Test", content: "Test content" }],
      ["upnote_create_notebook", { title: "Test" }],
      ["upnote_open_note", { id: "n1" }],
      ["upnote_open_tag", { tag: "bread" }],
      ["upnote_open_filter", { filter_id: "filter-1" }],
      ["upnote_view", { mode: "all_notes" }],
    ]) {
      const response = await service.call(name, args);
      assert.equal(response.isError, undefined, textOf(response));
    }
    assert.equal(launches.length, 6);
    const failed = await service.call("upnote_list_notebooks");
    assert.equal(failed.isError, true);
    assert.match(textOf(failed), /UPNOTE_DB/);
    env.UPNOTE_DB = fixture.sourcePath;
    const recovered = await service.call("upnote_list_notebooks");
    assert.equal(recovered.structuredContent.count, 3);
  }
});

test("failed snapshot validation closes each opened handle before retry and cleanup", t => {
  const fixture = makeFixture();
  t.after(() => fixture.live.close());
  for (const failure of ["integrity", "tables"]) {
    const handles = [];
    const database = new SnapshotDatabase({
      sourcePath: fixture.sourcePath,
      snapshotBaseDir: fixture.root,
      databaseFactory: file => {
        assert.ok(handles.every(handle => !handle.isOpen));
        const handle = new DatabaseSync(file);
        handles.push(handle);
        if (failure === "tables") handle.exec("DROP TABLE lists");
        return {
          prepare: sql => failure === "integrity" && sql === "PRAGMA integrity_check"
            ? { get: () => ({ integrity_check: "corrupt" }) }
            : handle.prepare(sql),
          close: () => handle.close(),
        };
      },
    });
    t.after(() => {
      for (const handle of handles) if (handle.isOpen) handle.close();
      database.close();
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assert.throws(() => database.all("SELECT 1"), failure === "integrity" ? /integrity_check failed/ : /required table lists is missing/);
      assert.equal(database.database, null);
      assert.ok(handles.every(handle => !handle.isOpen));
    }
    assert.equal(handles.length, 2);
    database.close();
    assert.equal(fs.existsSync(database.snapshotDir), false);
  }
});

test("platform detection and shell-free launcher branches are covered", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "upnote-mcp-platform-"));
  tempRoots.push(root);
  const winPath = path.join(root, "win", "Packages", "24862ThomasDao.UpNote_kq65c2wy2rx02", "LocalCache", "Roaming", "UpNote", "upnote.sqlite3");
  const macPath = path.join(root, "Library", "Containers", "com.getupnote.mac", "Data", "Library", "Application Support", "UpNote", "upnote.sqlite3");
  fs.mkdirSync(path.dirname(winPath), { recursive: true });
  fs.mkdirSync(path.dirname(macPath), { recursive: true });
  fs.writeFileSync(winPath, "");
  fs.writeFileSync(macPath, "");
  assert.equal(findDatabase({ env: { LOCALAPPDATA: path.join(root, "win") }, platform: "win32" }), winPath);
  assert.equal(findDatabase({ env: {}, platform: "darwin", homeDir: root }), macPath);
  assert.throws(() => findDatabase({ env: {}, platform: "linux" }), /UPNOTE_DB/);
  const configured = loadConfig({ env: { UPNOTE_DB: winPath, UPNOTE_URL_LIMIT: "25", UPNOTE_DEFAULT_NOTEBOOK: "Personal" }, platform: "linux", tempDir: root });
  assert.equal(configured.urlLimit, 25);
  assert.equal(configured.defaultNotebook, "Personal");
  assert.throws(() => loadConfig({ env: { UPNOTE_DB: winPath, UPNOTE_URL_LIMIT: "nope" }, platform: "linux", tempDir: root }), /positive integer/);

  assert.deepEqual(openerForPlatform("win32"), ["rundll32", ["url.dll,FileProtocolHandler"]]);
  assert.deepEqual(openerForPlatform("darwin"), ["open", []]);
  assert.deepEqual(openerForPlatform("linux"), ["xdg-open", []]);
  assert.equal(callbackUrl("openNote", { noteId: "a&b" }), "upnote://x-callback-url/openNote?noteId=a%26b");
  const spawned = [];
  await openUrl("upnote://x-callback-url/openNote?noteId=n1", {
    platform: "linux",
    spawnImpl: (command, args, options) => {
      spawned.push({ command, args, options });
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
  });
  assert.equal(spawned[0].options.shell, false);
  assert.deepEqual(spawned[0].args, ["upnote://x-callback-url/openNote?noteId=n1"]);
  await assert.rejects(openUrl("upnote://bad", {
    spawnImpl: () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", new Error("missing opener")));
      return child;
    },
  }), /Could not launch/);
});

test("MCP SDK client discovers schemas, instructions, results, errors, and shuts down cleanly", async t => {
  const fixture = makeFixture();
  t.after(() => fixture.live.close());
  const snapshotParent = path.join(fixture.root, "snapshots");
  const client = new Client({ name: "isolated-test-client", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("server.mjs")],
    env: { ...process.env, UPNOTE_DB: fixture.sourcePath, UPNOTE_SNAPSHOT_DIR: snapshotParent },
  });
  await client.connect(transport);
  t.after(async () => { await client.close(); });
  assert.equal(client.getServerVersion().name, "upnote-mcp-codex");
  assert.match(client.getInstructions(), /local data/);
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 13);
  assert.equal(listed.tools.find(tool => tool.name === "upnote_open_note").inputSchema.properties.new_window.type, "boolean");
  assert.equal(listed.tools.find(tool => tool.name === "upnote_open_filter").inputSchema.properties.filter_id.type, "string");
  assert.deepEqual(listed.tools.find(tool => tool.name === "upnote_view").inputSchema.properties.mode.enum, [
    "all_notes", "quick_access", "templates", "trash", "notebooks", "tags", "filters", "all_notebooks", "all_tags",
  ]);
  assert.equal(listed.tools.find(tool => tool.name === "upnote_get_note").outputSchema.properties.truncated.type, "boolean");
  const empty = await client.callTool({ name: "upnote_search_notes", arguments: { query: "" } });
  assert.equal(empty.isError, undefined);
  assert.deepEqual(empty.structuredContent.notes, []);
  const missing = await client.callTool({ name: "upnote_get_note", arguments: { id: "missing" } });
  assert.equal(missing.isError, true);
  assert.match(textOf(missing), /No non-trashed note/);
  await client.close();
  assert.equal(fs.existsSync(snapshotParent) ? fs.readdirSync(snapshotParent).length : 0, 0);
});

after(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});


test("MCP client receives actionable errors and resolves duplicate notebook titles by ID", async t => {
  const fixture = makeFixture();
  t.after(() => fixture.live.close());
  fixture.live.exec("INSERT INTO notebooks VALUES ('nb-duplicate', ' ALPHA ', 0); INSERT INTO notebooks VALUES ('nb-collision', 'nb-alpha', 0);");
  fixture.live.prepare("INSERT INTO lists VALUES (?, ?)").run("notebooks_nb-duplicate", JSON.stringify(["n3"]));
  const { database, launches } = serviceFor(fixture);
  t.after(() => database.close());
  let databaseFails = false;
  let launcherFails = false;
  const service = createToolService({
    config: testConfig(),
    database: {
      all: (...args) => { if (databaseFails) throw new Error("database unavailable"); return database.all(...args); },
      get: (...args) => database.get(...args),
    },
    launcher: { open: async url => { if (launcherFails) throw new Error("launcher unavailable"); launches.push(url); } },
  });
  const server = new Server({ name: "test-server", version: "1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: service.definitions }));
  server.setRequestHandler(CallToolRequestSchema, async request => service.call(request.params.name, request.params.arguments));
  const client = new Client({ name: "test-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  await client.listTools();
  const call = (name, args) => client.callTool({ name, arguments: args });
  const checkError = async (name, args, message) => {
    const response = await call(name, args);
    assert.equal(response.isError, true);
    assert.equal(response.structuredContent, undefined);
    assert.match(textOf(response), message);
    return response;
  };
  await checkError("upnote_get_note", { id: 42 }, /must be a string/);
  databaseFails = true;
  await checkError("upnote_list_notebooks", {}, /database unavailable/);
  databaseFails = false;
  launcherFails = true;
  await checkError("upnote_open_note", { id: "n1" }, /launcher unavailable/);
  launcherFails = false;
  for (const name of ["upnote_list_notes", "upnote_search_notes", "upnote_open_notebook"]) {
    const args = name === "upnote_search_notes" ? { query: "a" } : {};
    const ambiguous = await checkError(name, { ...args, notebook: "alpha" }, /Pass a candidate ID/);
    const ids = [...textOf(ambiguous).matchAll(/\[id: ([^\]]+)\]/g)].map(match => match[1]);
    assert.deepEqual(new Set(ids), new Set(["nb-alpha", "nb-duplicate"]));
    for (const id of ids) {
      const response = await call(name, { ...args, notebook: id });
      assert.equal(response.isError, undefined, textOf(response));
      if (name === "upnote_open_notebook") {
        assert.equal(response.structuredContent.id, id);
        assert.equal(new URL(launches.at(-1)).searchParams.get("notebookId"), id);
      } else {
        assert.deepEqual(response.structuredContent.notes.map(note => note.id), [id === "nb-alpha" ? "n1" : "n3"]);
      }
    }
    await checkError(name, { ...args, notebook: "missing" }, /No notebook matching/);
    await checkError(name, { ...args, notebook: "nb-trash" }, /No notebook matching/);
  }
});
