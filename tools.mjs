import { callbackUrl } from "./launcher.mjs";

const noteSummary = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    updatedAt: { type: ["string", "null"] },
    snippet: { type: "string" },
  },
  required: ["id", "title", "updatedAt"],
};

const notebookSummary = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    noteCount: { type: "integer", minimum: 0 },
  },
  required: ["id", "title", "noteCount"],
};

const errorProperties = {
  error: { type: "string" },
  status: { type: "string" },
  candidates: { type: "array", items: notebookSummary },
};

const noteListOutput = {
  type: "object",
  additionalProperties: false,
  properties: {
    notes: { type: "array", items: noteSummary },
    count: { type: "integer", minimum: 0 },
    truncated: { type: "boolean" },
    ...errorProperties,
  },
  required: ["notes", "count", "truncated"],
};

const limit = { type: "integer", minimum: 1, maximum: 200 };
const string = { type: "string" };
const noArgs = { type: "object", properties: {}, additionalProperties: false };

export const TOOL_DEFINITIONS = [
  {
    name: "upnote_create_note",
    title: "Create UpNote note",
    description: "Request creation of a new Markdown note. If notebook is omitted, the configured default (Codex Notes by default) is used. UpNote handles the write through its URL scheme; existing notes cannot be edited.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { title: string, content: string, notebook: string },
      required: ["title", "content"],
    },
    outputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        dispatched: { type: "boolean" }, confirmed: { type: "boolean" },
        operation: { type: "string" }, title: string, notebook: string, urlLength: { type: "integer" },
        ...errorProperties,
      },
      required: ["dispatched", "confirmed", "operation"],
    },
  },
  {
    name: "upnote_create_notebook",
    title: "Create UpNote notebook",
    description: "Request creation of a new UpNote notebook through the app URL scheme.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: { type: "object", additionalProperties: false, properties: { title: string }, required: ["title"] },
    outputSchema: {
      type: "object", additionalProperties: false,
      properties: { dispatched: { type: "boolean" }, confirmed: { type: "boolean" }, operation: { type: "string" }, title: string, urlLength: { type: "integer" }, ...errorProperties },
      required: ["dispatched", "confirmed", "operation"],
    },
  },
  {
    name: "upnote_list_notebooks",
    title: "List UpNote notebooks",
    description: "List non-trashed UpNote notebooks and counts of their non-trashed notes.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: noArgs,
    outputSchema: { type: "object", additionalProperties: false, properties: { notebooks: { type: "array", items: notebookSummary }, count: { type: "integer" }, ...errorProperties }, required: ["notebooks", "count"] },
  },
  {
    name: "upnote_list_notes",
    title: "List notes in UpNote notebook",
    description: "List non-trashed notes in a notebook by stable ID or title, newest first.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, properties: { notebook: string, limit }, required: ["notebook"] },
    outputSchema: noteListOutput,
  },
  {
    name: "upnote_search_notes",
    title: "Search UpNote notes",
    description: "Search non-trashed note titles and bodies, optionally within one notebook selected by stable ID or title.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, properties: { query: string, notebook: string, limit }, required: ["query"] },
    outputSchema: noteListOutput,
  },
  {
    name: "upnote_get_note",
    title: "Read an UpNote note",
    description: "Read the full body of one non-trashed note by stable note ID.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, properties: { id: string, max_chars: { type: "integer", minimum: 1, maximum: 100000 } }, required: ["id"] },
    outputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        found: { type: "boolean" }, note: { type: ["object", "null"] }, totalChars: { type: "integer", minimum: 0 }, returnedChars: { type: "integer", minimum: 0 }, truncated: { type: "boolean" }, ...errorProperties,
      },
      required: ["found", "totalChars", "returnedChars", "truncated"],
    },
  },
  {
    name: "upnote_recent_notes",
    title: "List recent UpNote notes",
    description: "List the most recently updated non-trashed notes across the library.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, properties: { limit } },
    outputSchema: noteListOutput,
  },
  {
    name: "upnote_list_tags",
    title: "List UpNote tags",
    description: "List non-trashed UpNote tags.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: noArgs,
    outputSchema: { type: "object", additionalProperties: false, properties: { tags: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: string, title: string }, required: ["id", "title"] } }, count: { type: "integer" }, ...errorProperties }, required: ["tags", "count"] },
  },
  {
    name: "upnote_open_note",
    title: "Open an UpNote note",
    description: "Dispatch a request to open a note in UpNote. The app does not confirm the request to this server.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { type: "object", additionalProperties: false, properties: { id: string }, required: ["id"] },
    outputSchema: dispatchOutput("open_note"),
  },
  {
    name: "upnote_open_notebook",
    title: "Open an UpNote notebook",
    description: "Dispatch a request to open a notebook in UpNote by stable ID or title. The app does not confirm the request to this server.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { type: "object", additionalProperties: false, properties: { notebook: string }, required: ["notebook"] },
    outputSchema: dispatchOutput("open_notebook"),
  },
];

function dispatchOutput(operation) {
  return {
    type: "object", additionalProperties: false,
    properties: { dispatched: { type: "boolean" }, confirmed: { type: "boolean" }, operation: { const: operation }, id: string, notebook: string, title: string, urlLength: { type: "integer" }, ...errorProperties },
    required: ["dispatched", "confirmed", "operation"],
  };
}

const definitionsByName = new Map(TOOL_DEFINITIONS.map(tool => [tool.name, tool]));

export function createToolService({ database, launcher, config }) {
  return { definitions: TOOL_DEFINITIONS, call: (name, args) => callTool(name, args, { database, launcher, config }) };
}

async function callTool(name, args, dependencies) {
  try {
    const definition = definitionsByName.get(name);
    if (!definition) throw new Error(`Unknown tool: ${name}`);
    const a = validateArguments(name, args);
    return await execute(name, a, dependencies);
  } catch (error) {
    return result(`Error: ${error.message}`, { error: error.message }, true);
  }
}

function validateArguments(name, args) {
  const input = args ?? {};
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Tool arguments must be an object.");
  const allowed = {
    upnote_create_note: ["title", "content", "notebook"],
    upnote_create_notebook: ["title"],
    upnote_list_notebooks: [],
    upnote_list_notes: ["notebook", "limit"],
    upnote_search_notes: ["query", "notebook", "limit"],
    upnote_get_note: ["id", "max_chars"],
    upnote_recent_notes: ["limit"],
    upnote_list_tags: [],
    upnote_open_note: ["id"],
    upnote_open_notebook: ["notebook"],
  }[name];
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new Error(`Unknown argument "${key}".`);

  const required = {
    upnote_create_note: ["title", "content"], upnote_create_notebook: ["title"], upnote_list_notes: ["notebook"],
    upnote_search_notes: ["query"], upnote_get_note: ["id"], upnote_open_note: ["id"], upnote_open_notebook: ["notebook"],
  }[name] || [];
  for (const key of required) if (typeof input[key] !== "string") throw new Error(`"${key}" must be a string.`);
  for (const key of ["notebook", "title", "content", "query", "id"]) {
    if (input[key] !== undefined && typeof input[key] !== "string") throw new Error(`"${key}" must be a string.`);
  }
  for (const key of ["limit", "max_chars"]) {
    if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || input[key] < 1)) {
      throw new Error(`"${key}" must be a positive integer.`);
    }
  }
  return input;
}

async function execute(name, a, { database, launcher, config }) {
  switch (name) {
    case "upnote_list_notebooks": {
      const rows = listNotebooks(database);
      const text = rows.length ? rows.map(row => `- ${row.title} [id: ${row.id}] (${row.noteCount})`).join("\n") : "No notebooks found.";
      return result(text, { notebooks: rows, count: rows.length });
    }
    case "upnote_list_tags": {
      const rows = database.all("SELECT id, title FROM tags WHERE COALESCE(deleted,0)=0 ORDER BY title COLLATE NOCASE");
      const tags = rows.map(row => ({ id: String(row.id), title: row.title || "" }));
      return result(tags.length ? tags.map(row => `- ${row.title} [id: ${row.id}]`).join("\n") : "No tags.", { tags, count: tags.length });
    }
    case "upnote_recent_notes": {
      const rows = noteSummaries(database, "COALESCE(trashed,0)=0 AND length(COALESCE(title,'')) > 0", [], a.limit, config, config.recentLimit);
      return noteListResult(rows, a.limit, "No matching notes.");
    }
    case "upnote_list_notes": {
      const match = resolveNotebook(database, a.notebook);
      if (match.kind !== "matched") return notebookMatchResult(a.notebook, match);
      const ids = noteIdsIn(database, match.notebook.id);
      if (!ids.length) return result(`"${match.notebook.title}" has no notes.`, { notes: [], count: 0, truncated: false });
      const placeholders = ids.map(() => "?").join(",");
      const rows = noteSummaries(database, `id IN (${placeholders}) AND COALESCE(trashed,0)=0`, ids, a.limit, config, config.listLimit);
      return noteListResult(rows, a.limit, `"${match.notebook.title}" has no notes.`, `Notebook: ${match.notebook.title}`);
    }
    case "upnote_search_notes": {
      if (a.query === "") return result("No matching notes.", { notes: [], count: 0, truncated: false });
      let where = "COALESCE(trashed,0)=0";
      let prefix = [];
      if (a.notebook !== undefined) {
        const match = resolveNotebook(database, a.notebook);
        if (match.kind !== "matched") return notebookMatchResult(a.notebook, match);
        const ids = noteIdsIn(database, match.notebook.id);
        if (!ids.length) return result(`"${match.notebook.title}" has no notes.`, { notes: [], count: 0, truncated: false });
        const placeholders = ids.map(() => "?").join(",");
        where += ` AND id IN (${placeholders})`;
        prefix = ids;
      }
      const needle = `%${a.query.toLowerCase()}%`;
      const max = boundedLimit(a.limit, config, config.searchLimit);
      const rows = database.all(`
        SELECT id, title, text, updatedAt,
          CASE WHEN lower(COALESCE(title,'')) LIKE ? THEN 2 ELSE 1 END AS rank
        FROM notes WHERE ${where}
          AND (lower(COALESCE(title,'')) LIKE ? OR lower(COALESCE(text,'')) LIKE ?)
          ORDER BY rank DESC, updatedAt DESC LIMIT ?`, needle, ...prefix, needle, needle, max + 1);
      const truncated = rows.length > max;
      const notes = rows.slice(0, max).map(row => ({ id: String(row.id), title: row.title || "", updatedAt: when(row.updatedAt), snippet: snippet(row.text, a.query) }));
      return result(notes.length ? fmtNotes(notes) : "No matching notes.", { notes, count: notes.length, truncated });
    }
    case "upnote_get_note": {
      const row = database.get("SELECT id, title, text, updatedAt, createdAt FROM notes WHERE id = ? AND COALESCE(trashed,0)=0", a.id);
      if (!row) return result(`No non-trashed note with id ${a.id}.`, { found: false, note: null, totalChars: 0, returnedChars: 0, truncated: false }, true);
      const body = row.text || "";
      const cap = Math.min(a.max_chars ?? config.noteChars, config.maxNoteChars);
      const note = { id: String(row.id), title: row.title || "", body: body.slice(0, cap), createdAt: when(row.createdAt), updatedAt: when(row.updatedAt) };
      const truncated = body.length > cap;
      const text = `# ${note.title || "(untitled)"}\ncreated ${note.createdAt || "?"} | updated ${note.updatedAt || "?"}\n\n${note.body}` +
        (truncated ? `\n\n[truncated, ${body.length} chars total; returned ${cap}]` : "");
      return result(text, { found: true, note, totalChars: body.length, returnedChars: note.body.length, truncated });
    }
    case "upnote_create_note": {
      const notebook = a.notebook ?? config.defaultNotebook;
      const url = callbackUrl("note/new", { title: a.title, text: a.content, notebook, markdown: "true" });
      ensureUrlLimit(url, config.urlLimit);
      await launcher.open(url);
      return result(`UpNote request dispatched to create "${a.title}" in notebook "${notebook}". UpNote has not confirmed creation.`, { dispatched: true, confirmed: false, operation: "create_note", title: a.title, notebook, urlLength: url.length });
    }
    case "upnote_create_notebook": {
      const url = callbackUrl("notebook/new", { title: a.title });
      ensureUrlLimit(url, config.urlLimit);
      await launcher.open(url);
      return result(`UpNote request dispatched to create notebook "${a.title}". UpNote has not confirmed creation.`, { dispatched: true, confirmed: false, operation: "create_notebook", title: a.title, urlLength: url.length });
    }
    case "upnote_open_note": {
      const url = callbackUrl("openNote", { noteId: a.id });
      ensureUrlLimit(url, config.urlLimit);
      await launcher.open(url);
      return result(`UpNote request dispatched to open note ${a.id}. UpNote has not confirmed the request.`, { dispatched: true, confirmed: false, operation: "open_note", id: a.id, urlLength: url.length });
    }
    case "upnote_open_notebook": {
      const match = resolveNotebook(database, a.notebook);
      if (match.kind !== "matched") return notebookMatchResult(a.notebook, match);
      const url = callbackUrl("openNotebook", { notebookId: match.notebook.id });
      ensureUrlLimit(url, config.urlLimit);
      await launcher.open(url);
      return result(`UpNote request dispatched to open notebook "${match.notebook.title}". UpNote has not confirmed the request.`, { dispatched: true, confirmed: false, operation: "open_notebook", id: match.notebook.id, notebook: match.notebook.title, urlLength: url.length });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function listNotebooks(database) {
  return database.all(`
    SELECT nb.id AS id, nb.title AS title,
      (SELECT COUNT(*) FROM lists l, json_each(l.content) j
         JOIN notes n ON n.id = j.value
        WHERE l.id = 'notebooks_' || nb.id AND COALESCE(n.trashed,0) = 0) AS noteCount
    FROM notebooks nb WHERE COALESCE(nb.deleted,0) = 0 ORDER BY nb.title COLLATE NOCASE
  `).map(row => ({ id: String(row.id), title: row.title || "", noteCount: Number(row.noteCount) }));
}

function resolveNotebook(database, requested) {
  const title = requested.trim().toLowerCase();
  const rows = listNotebooks(database);
  const byId = rows.find(row => row.id === requested);
  if (byId) return { kind: "matched", notebook: byId };
  const exact = rows.filter(row => row.title.trim().toLowerCase() === title);
  if (exact.length === 1) return { kind: "matched", notebook: exact[0] };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact };
  const partial = rows.filter(row => row.title.toLowerCase().includes(title));
  if (partial.length === 1) return { kind: "matched", notebook: partial[0] };
  if (partial.length > 1) return { kind: "ambiguous", candidates: partial };
  return { kind: "missing", candidates: [] };
}

function notebookMatchResult(requested, match) {
  if (match.kind === "ambiguous") {
    const candidates = match.candidates;
    return result(`Notebook "${requested}" is ambiguous. Pass a candidate ID as notebook. Candidates:\n${candidates.map(row => `- ${row.title} [id: ${row.id}]`).join("\n")}`, { status: "ambiguous", candidates, error: "Choose one of the candidate notebooks." }, true);
  }
  return result(`No notebook matching "${requested}". Try upnote_list_notebooks.`, { status: "missing", candidates: [], error: `No notebook matching "${requested}".` }, true);
}

function noteIdsIn(database, notebookId) {
  const row = database.get("SELECT content FROM lists WHERE id = ?", `notebooks_${notebookId}`);
  if (!row?.content) return [];
  try {
    const parsed = JSON.parse(row.content);
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function noteSummaries(database, where, params, requestedLimit, config, defaultLimit) {
  const max = boundedLimit(requestedLimit, config, defaultLimit);
  const rows = database.all(`SELECT id, title, updatedAt FROM notes WHERE ${where} ORDER BY updatedAt DESC LIMIT ?`, ...params, max + 1);
  return { rows: rows.slice(0, max).map(row => ({ id: String(row.id), title: row.title || "", updatedAt: when(row.updatedAt) })), truncated: rows.length > max };
}

function noteListResult(data, requestedLimit, emptyText, prefix = "") {
  const text = data.rows.length ? `${prefix ? `${prefix}\n\n` : ""}${fmtNotes(data.rows)}` : emptyText;
  return result(text, { notes: data.rows, count: data.rows.length, truncated: data.truncated });
}

function boundedLimit(requested, config, defaultLimit = config.listLimit) { return Math.min(requested ?? defaultLimit, config.maxResults); }

function fmtNotes(rows) {
  return rows.map(row => `- ${row.title || "(untitled)"} [id: ${row.id}] updated ${row.updatedAt || "?"}${row.snippet ? `\n    ${row.snippet}` : ""}`).join("\n");
}

function snippet(text, query, length = 180) {
  if (!text) return "";
  const lower = text.toLowerCase();
  const index = lower.indexOf(String(query).toLowerCase());
  const start = index > 0 ? Math.max(0, index - 40) : 0;
  const cut = text.slice(start, start + length).replace(/\s+/g, " ").trim();
  return cut + (text.length > start + length ? "..." : "");
}

function when(value) {
  if (!value) return null;
  const number = Number(value);
  const milliseconds = number > 1e12 ? number : number * 1000;
  return new Date(milliseconds).toISOString().slice(0, 16).replace("T", " ");
}

function ensureUrlLimit(url, limit) {
  if (url.length > limit) throw new Error(`Encoded UpNote URL is ${url.length} characters, above the configured limit of ${limit}. Split the content or raise UPNOTE_URL_LIMIT.`);
}

function result(text, structuredContent, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : { structuredContent }) };
}
