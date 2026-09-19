# upnote-mcp-codex

An unofficial, Codex CLI focused [Model Context Protocol](https://modelcontextprotocol.io/) server for local [UpNote](https://getupnote.com/) data. It reads the notes that UpNote has synced to this computer and dispatches create or open requests through UpNote's `upnote://` URL scheme. It does not use an account, cloud API, HTTP service, authentication layer, or plugin packaging.

> **Unofficial.** This project is not affiliated with, endorsed by, or supported by UpNote or Thomas Dao. It reads an undocumented local database that may change in a future UpNote release. Back up your notes.

## Setup with Codex CLI

You need UpNote, Node 22.13 or later, and Codex CLI. From a checkout:

```bash
git clone https://github.com/ahmedco88/upnote-mcp.git
cd upnote-mcp
npm ci
```

Register the server with an absolute path to `server.mjs`:

```bash
codex mcp add upnote -- node /absolute/path/to/upnote-mcp/server.mjs
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

## What it can do

| Tool | Function |
| --- | --- |
| `upnote_create_note` | Dispatch creation of a Markdown note. |
| `upnote_create_notebook` | Dispatch creation of a notebook. |
| `upnote_list_notebooks` | List non-trashed notebooks and note counts. |
| `upnote_list_notes` | List non-trashed notes in a notebook. |
| `upnote_search_notes` | Search non-trashed note titles and bodies. |
| `upnote_get_note` | Read one non-trashed note by ID. |
| `upnote_recent_notes` | List recently updated non-trashed notes. |
| `upnote_list_tags` | List non-trashed tags. |
| `upnote_open_note` | Dispatch a request to open a note in UpNote. |
| `upnote_open_notebook` | Dispatch a request to open a notebook in UpNote. |

The six list/search/read tools are read-only. Creation is create-only: existing notes cannot be edited, appended to, or deleted. App-opening tools have a local side effect. Successful URL launches are reported as **request dispatched**; the server cannot confirm that UpNote processed the URL or created the requested record.

New notes go to `Codex Notes` when `notebook` is omitted. To retain the previous default, set `UPNOTE_DEFAULT_NOTEBOOK=Claude Notes` in the server environment.

## Environment settings

Set these in the `env` table of the server configuration or in the environment that launches Codex:

```toml
[mcp_servers.upnote.env]
UPNOTE_DEFAULT_NOTEBOOK = "Codex Notes"
UPNOTE_DB = "/absolute/path/to/upnote.sqlite3"
UPNOTE_SNAPSHOT_DIR = "/absolute/path/to/private/snapshot-parent"
UPNOTE_URL_LIMIT = "100000"
```

| Setting | Default | Function |
| --- | --- | --- |
| `UPNOTE_DEFAULT_NOTEBOOK` | `Codex Notes` | Notebook name sent for notes without an explicit notebook. |
| `UPNOTE_DB` | Platform detection | Full path to `upnote.sqlite3`. Required on Linux and other unsupported platforms. |
| `UPNOTE_SNAPSHOT_DIR` | System temporary directory | Private parent directory for a unique per-process snapshot directory. |
| `UPNOTE_URL_LIMIT` | `100000` | Maximum encoded URL length for every create/open operation. Must be a positive integer. |

Database detection is limited to the current platform. Windows checks the Microsoft Store and installer locations; macOS checks the documented application container path. Linux does not guess an undocumented storage location and requires `UPNOTE_DB`.

The server copies `upnote.sqlite3`, `upnote.sqlite3-wal`, and `upnote.sqlite3-shm` into a unique process-owned directory, opens the completed copy, validates it, and never writes to UpNote's source files. It compares metadata for each source file and retries an unstable copy up to three times. Normal disconnect or termination removes only that process-owned directory. Abrupt termination can leave temporary files.

File-copy snapshots cannot guarantee transactional consistency while UpNote is writing concurrently. The snapshot code detects source changes during copying, but a stable set of file metadata is not a SQLite transaction boundary. For the most consistent view, pause UpNote writes while a snapshot is being refreshed.

The URL launcher passes the URL as an argument without a shell: `rundll32` on Windows, `open` on macOS, and `xdg-open` on Linux and other Unix-like platforms. Note text is present in the URL process command line during creation, so other local processes may be able to observe it.

## Platform and validation notes

The automated test suite exercises the Windows, macOS, and Linux detection and launcher branches with mocks, along with WAL-backed fixtures, snapshot refresh, copy retries, isolation, cleanup, input/output schemas, and MCP stdio behavior. Real UpNote integration has been validated on Windows with the Microsoft Store build; macOS and Linux paths remain automated coverage rather than a claim of real UpNote validation.

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

The manual MCP smoke client is kept under explicit commands. `read` is side-effect free; `write` creates real notes and notebooks that UpNote will require you to remove manually:

```bash
node test-client.mjs read
node test-client.mjs write
```

Use `TEST_NOTEBOOK` and `TEST_QUERY` to select the manual smoke inputs. The automated tests use synthetic SQLite fixtures and mocked launchers, so they never create real notes or expose a user's library.

## License

MIT. See [LICENSE](LICENSE).
