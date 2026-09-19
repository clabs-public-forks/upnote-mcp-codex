# upnote-mcp-codex

`upnote-mcp-codex` is an unofficial Codex CLI-specific MCP server for the [UpNote](https://getupnote.com/) notetaking app.

This repo is a forked refactor of [ahmedco88's UpNote MCP server for Claude Code](https://github.com/ahmedco88/upnote-mcp).

This MCP server reads the notes that UpNote has synced to your computer and dispatches create, open, and navigation requests through UpNote's `upnote://` URL scheme. It does not use an account, cloud API, HTTP service, authentication layer, or plugin packaging.

> **Unofficial.** This project is not affiliated with, endorsed by, or supported by UpNote or Thomas Dao. It reads an undocumented local database that may change in a future UpNote release. Back up your notes.

URL support follows UpNote's [official x-callback-url endpoint reference](https://help.getupnote.com/resources/x-callback-url-endpoints). The server covers all seven documented endpoints: create a note, open a note, open a notebook, create a notebook, open a tag, open a filter, and dynamic view.

## Setup with Codex CLI

You need UpNote, Node 22.13 or later, and Codex CLI. From a checkout:

```bash
git clone https://github.com/clabs-public-forks/upnote-mcp-codex.git
cd upnote-mcp
npm ci
```

Register the server with an absolute path to `server.mjs`:

```bash
codex mcp add upnote -- node ${PWD}/server.mjs
```

This command writes the server entry to Codex's MCP configuration. The equivalent manual configuration is:

```toml
[mcp_servers.upnote]
command = "node"
args = ["/absolute/path/to/upnote-mcp/server.mjs"]
startup_timeout_sec = 10
tool_timeout_sec = 60
```

The normal user configuration is `~/.codex/config.toml`. A project-scoped `.codex/config.toml` is also supported for a trusted project. Do not put a library path or other private value in a repository that others can read. This project does not edit either configuration file or register itself automatically.

On Windows, quote the absolute path in the command and use a path that your `node` installation can read, for example:

```powershell
codex mcp add upnote -- node "C:\Users\you\src\upnote-mcp\server.mjs"
```

If Codex cannot find the same Node installation as your shell, use the absolute path to `node.exe`. In TOML, use forward slashes or escape each backslash:

```toml
args = ["C:/Users/you/src/upnote-mcp/server.mjs"]
```

Check the registration with `codex mcp list` or `codex mcp get upnote`. In a running Codex TUI, use `/mcp` to inspect the active connection. The server returns its instructions during MCP initialization, and Codex uses those instructions alongside the tools.

The optional `enabled_tools` and `disabled_tools` settings can filter the tools Codex exposes. `disabled_tools` is applied after `enabled_tools`:

```toml
[mcp_servers.upnote]
command = "node"
args = ["/absolute/path/to/upnote-mcp/server.mjs"]
enabled_tools = ["upnote_list_notebooks", "upnote_list_notes", "upnote_search_notes", "upnote_get_note", "upnote_recent_notes", "upnote_list_tags"]
```

## Usage examples

After registering the server, use it from Codex with ordinary requests such as:

```text
List my UpNote notebooks.
```

```text
Search my UpNote notes for "release checklist" and show the five most relevant results.
```

```text
Read the note with ID "<note-id>".
```

```text
List the notes in the "Work" notebook, then open the most recently updated one.
```

```text
Create an UpNote note titled "Meeting ideas" in the "Work" notebook with this content:

- Follow up with the design team
- Review the launch timeline
```

```text
Open the UpNote tag "School".
```

Codex maps these requests to the available MCP tools. If you need to be explicit, the corresponding tool calls look like this:

```json
{"name":"upnote_search_notes","arguments":{"query":"release checklist","limit":5}}
```

```json
{"name":"upnote_get_note","arguments":{"id":"<note-id>"}}
```

```json
{"name":"upnote_create_note","arguments":{"title":"Meeting ideas","content":"- Follow up with the design team\n- Review the launch timeline","notebook":"Work"}}
```

```json
{"name":"upnote_view","arguments":{"mode":"all_notes"}}
```

Use IDs returned by the list and search tools when opening a specific note, notebook, tag, or filter. The read/search tools are read-only. Creation and navigation dispatch requests to UpNote; they do not confirm that UpNote processed the request.

## What it can do

| Tool | Function |
| --- | --- |
| `upnote_create_note` | Dispatch creation of a note, with Markdown formatting enabled by default. |
| `upnote_create_notebook` | Dispatch creation of a notebook. |
| `upnote_list_notebooks` | List non-trashed notebooks and note counts. |
| `upnote_list_notes` | List non-trashed notes in a notebook. |
| `upnote_search_notes` | Search non-trashed note titles and bodies. |
| `upnote_get_note` | Read one non-trashed note by ID. |
| `upnote_recent_notes` | List recently updated non-trashed notes. |
| `upnote_list_tags` | List non-trashed tags. |
| `upnote_open_note` | Dispatch a request to open a note in UpNote. |
| `upnote_open_notebook` | Dispatch a request to open a notebook in UpNote. |
| `upnote_open_tag` | Dispatch a request to view notes for a tag title. |
| `upnote_open_filter` | Dispatch a request to open a filter by explicit filter ID. |
| `upnote_view` | Dispatch dynamic navigation, note opening, search, and space selection. |

The six list/search/read tools are read-only. Creation is create-only: existing notes cannot be edited, appended to, or deleted. App-opening and navigation tools have a local side effect. Successful URL launches are reported as **request dispatched**; the server cannot confirm that UpNote processed the URL or created the requested record.

When `notebook` is omitted, UpNote chooses the user's current default notebook. `markdown` defaults to `true`; pass `false` for plain note text. `new_window` is optional on note creation and note opening and is omitted from the URL when unspecified.

## URL endpoint coverage

| UpNote endpoint | Tool | Parameters |
| --- | --- | --- |
| `note/new` | `upnote_create_note` | `title`, `text` from `content`, `notebook`, optional `new_window`, optional `markdown` (defaults to `true`) |
| `openNote` | `upnote_open_note` | `noteId` from `id`, optional `new_window` |
| `openNotebook` | `upnote_open_notebook` | `notebookId` resolved from `notebook` by existing local database behavior |
| `notebook/new` | `upnote_create_notebook` | `title` |
| `tag/view` | `upnote_open_tag` | `tag` title |
| `openFilter` | `upnote_open_filter` | `filterId` from explicit `filter_id` |
| `view` | `upnote_view` | `mode`, `noteId`, `notebookId`, `tagId`, `filterId`, `spaceId`, `action`, `query` |

`upnote_view` supports `all_notes`, `quick_access`, `templates`, `trash`, `notebooks`, `tags`, `filters`, `all_notebooks`, and `all_tags`. Notebook, tag, and filter modes require `notebook_id`, `tag_id`, and `filter_id` respectively. `note_id` opens a note without a mode; `action: "search"` with `query` searches without a mode; and `space_id: "default"` selects the default space. Navigation returns dispatch status rather than note results.

Explicit IDs can be copied from the `id` fields returned by `upnote_list_notebooks`, `upnote_list_tags`, note list/read results, or another trusted UpNote integration. The URL-only tools accept those values directly and do not query undocumented database tables to discover filters or spaces. `upnote_open_notebook` retains its existing title-or-ID resolution behavior for compatibility.

## Environment settings

Set these in the `env` table of the server configuration or in the environment that launches Codex:

```toml
[mcp_servers.upnote.env]
UPNOTE_DB = "/absolute/path/to/upnote.sqlite3"
UPNOTE_SNAPSHOT_DIR = "/absolute/path/to/private/snapshot-parent"
UPNOTE_URL_LIMIT = "100000"
```

| Setting | Default | Function |
| --- | --- | --- |
| `UPNOTE_DB` | Platform detection | Full path to `upnote.sqlite3`. Required on Linux and other unsupported platforms. |
| `UPNOTE_SNAPSHOT_DIR` | System temporary directory | Private parent directory for a unique per-process snapshot directory. |
| `UPNOTE_URL_LIMIT` | `100000` | Maximum encoded URL length for every URL dispatch, including navigation. Must be a positive integer. |

Database detection is limited to the current platform. Windows checks the Microsoft Store and installer locations; macOS checks the documented application container path. Linux does not guess an undocumented storage location and requires `UPNOTE_DB`.

The server copies `upnote.sqlite3`, `upnote.sqlite3-wal`, and `upnote.sqlite3-shm` into a unique process-owned directory, opens the completed copy, validates it, and never writes to UpNote's source files. It compares metadata for each source file and retries an unstable copy up to three times. Normal disconnect or termination removes only that process-owned directory. Abrupt termination can leave temporary files.

File-copy snapshots cannot guarantee transactional consistency while UpNote is writing concurrently. The snapshot code detects source changes during copying, but a stable set of file metadata is not a SQLite transaction boundary. For the most consistent view, pause UpNote writes while a snapshot is being refreshed.

The URL launcher passes the URL as an argument without a shell: `rundll32` on Windows, `open` on macOS, and `xdg-open` on Linux and other Unix-like platforms. Note text is present in the URL process command line during creation, so other local processes may be able to observe it.

## Platform and validation notes

The automated test suite exercises the Windows, macOS, and Linux detection and launcher branches with mocks, along with WAL-backed fixtures, snapshot refresh, copy retries, isolation, cleanup, input/output schemas, URL endpoint coverage, and MCP stdio behavior. Automated tests do not claim that a local UpNote build processed a URL. Use the opt-in navigation smoke mode below for platform verification and record those observations separately.

## Tests

The normal test command is isolated and does not access or modify a real UpNote library:

```bash
npm ci
npm test
```

Syntax checks can be run with:

```bash
node --check server.mjs
node --check config.mjs
node --check database.mjs
node --check launcher.mjs
node --check tools.mjs
```

The manual MCP smoke client is kept under explicit commands. `read` is side-effect free; `write` creates real notes and notebooks that UpNote will require you to remove manually. `navigation` is also opt-in: it launches view, search, space, tag, filter, note, window, and note-formatting checks, and its formatting checks create two real notes for manual cleanup. It requires the environment values described in the script comments and can change the visible UpNote window:

```bash
node test-client.mjs read
node test-client.mjs write
TEST_NOTE_ID="..." TEST_NOTEBOOK_ID="..." TEST_TAG_ID="..." TEST_FILTER_ID="..." node test-client.mjs navigation
```

Use `TEST_NOTEBOOK`, `TEST_QUERY`, `TEST_NOTE_ID`, `TEST_NOTEBOOK_ID`, `TEST_TAG`, `TEST_TAG_ID`, `TEST_FILTER_ID`, and `TEST_SPACE_ID` to select the manual smoke inputs. The navigation mode always checks `space_id: "default"`; set `TEST_SPACE_ID` to check another explicit space. It uses `new_window` and both markdown boolean values only when the relevant checks are enabled. The automated tests use synthetic SQLite fixtures and mocked launchers, so they never create real notes or expose a user's library.

## License

MIT. See [LICENSE](LICENSE).
