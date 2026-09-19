// Manual smoke test. Usage: node test-client.mjs [read|write|navigation|all]
//
// "write" creates real notes in your UpNote and they cannot be deleted
// programmatically, so you will have to trash them by hand.
//
// "navigation" is opt-in and dispatches real URLs. Set explicit values as needed:
// TEST_NOTEBOOK TEST_QUERY TEST_NOTE_ID TEST_NOTEBOOK_ID TEST_TAG TEST_TAG_ID
// TEST_FILTER_ID TEST_SPACE_ID.
// Endpoint coverage: note/new -> upnote_create_note; openNote -> upnote_open_note;
// openNotebook -> upnote_open_notebook; notebook/new -> upnote_create_notebook;
// tag/view -> upnote_open_tag; openFilter -> upnote_open_filter;
// view -> upnote_view.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";

const mode = process.argv[2] || "read";
const NOTEBOOK = process.env.TEST_NOTEBOOK || "Codex Notes";
const QUERY = process.env.TEST_QUERY || "test";
const NOTE_ID = process.env.TEST_NOTE_ID;
const NOTEBOOK_ID = process.env.TEST_NOTEBOOK_ID;
const TAG = process.env.TEST_TAG;
const TAG_ID = process.env.TEST_TAG_ID;
const FILTER_ID = process.env.TEST_FILTER_ID;
const SPACE_ID = process.env.TEST_SPACE_ID;
const server = path.join(import.meta.dirname, "server.mjs");

const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [server],
  env: { ...process.env },
}));

const call = async (name, args = {}) => {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const body = r.content.map(c => c.text).join("\n");
  console.log(`\n### ${name} ${JSON.stringify(args)}  (${Date.now() - t0}ms)`);
  console.log(body.length > 1200 ? body.slice(0, 1200) + "\n...[cut]" : body);
  return body;
};

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map(t => t.name).join(", "));

if (mode === "read" || mode === "all") {
  await call("upnote_list_notebooks");
  await call("upnote_list_tags");
  await call("upnote_recent_notes", { limit: 5 });
  await call("upnote_list_notes", { notebook: NOTEBOOK });
  await call("upnote_search_notes", { query: QUERY, limit: 5 });
  const first = await call("upnote_recent_notes", { limit: 1 });
  const id = (first.match(/\[id: ([^\]]+)\]/) || [])[1];
  if (id) await call("upnote_get_note", { id, max_chars: 400 });
  // error paths
  await call("upnote_list_notes", { notebook: "does-not-exist" });
  await call("upnote_get_note", { id: "nope" });
}

if (mode === "write" || mode === "all") {
  await call("upnote_create_notebook", { title: NOTEBOOK });
  await new Promise(r => setTimeout(r, 2500));
  await call("upnote_create_note", {
    title: "MCP smoke test " + new Date().toISOString().slice(0, 16),
    notebook: NOTEBOOK,
    content: "# It works\n\nCreated by the UpNote MCP server.\n\n- bullet one\n- bullet two\n\n" +
      "Special chars: & ? # % + = \"quotes\" and 'apostrophes'.\n",
  });
}

if (mode === "navigation" || mode === "all") {
  for (const viewMode of ["all_notes", "quick_access", "templates", "trash", "all_notebooks", "all_tags"]) {
    await call("upnote_view", { mode: viewMode });
  }
  await call("upnote_view", { action: "search", query: QUERY });
  await call("upnote_view", { space_id: "default" });
  if (SPACE_ID) await call("upnote_view", { space_id: SPACE_ID });
  if (NOTE_ID) {
    await call("upnote_view", { note_id: NOTE_ID });
    await call("upnote_open_note", { id: NOTE_ID, new_window: true });
  }
  if (NOTEBOOK_ID) await call("upnote_view", { mode: "notebooks", notebook_id: NOTEBOOK_ID });
  if (TAG_ID) await call("upnote_view", { mode: "tags", tag_id: TAG_ID });
  if (FILTER_ID) {
    await call("upnote_view", { mode: "filters", filter_id: FILTER_ID });
    await call("upnote_open_filter", { filter_id: FILTER_ID });
  }
  if (TAG) await call("upnote_open_tag", { tag: TAG });
  if (NOTEBOOK_ID) await call("upnote_open_notebook", { notebook: NOTEBOOK_ID });
  await call("upnote_create_note", {
    title: "MCP formatting smoke test (markdown)",
    notebook: NOTEBOOK,
    content: "# Markdown check\n\nCreated by the opt-in UpNote MCP smoke client.",
    markdown: true,
  });
  await call("upnote_create_note", {
    title: "MCP formatting smoke test (plain)",
    notebook: NOTEBOOK,
    content: "# Plain text check\n\nCreated by the opt-in UpNote MCP smoke client.",
    markdown: false,
  });
}

await client.close();
