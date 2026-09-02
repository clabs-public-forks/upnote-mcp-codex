# upnote-mcp

A local MCP server that lets Claude read and write your [UpNote](https://getupnote.com/) library.

Reads come from a snapshot copy of UpNote's local SQLite file. Writes go through UpNote's
public `upnote://` x-callback-url scheme.

> **Unofficial.** Not affiliated with, endorsed by, or supported by UpNote or Thomas Dao.
> UpNote is their trademark, used here only to say what this connects to. It reads an
> undocumented local database schema, which can change in any UpNote update. Back up your notes.

## Tools

| Tool | What it does |
| --- | --- |
| `upnote_create_note` | New note from title + Markdown body, into a named notebook. |
| `upnote_create_notebook` | New notebook. |
| `upnote_list_notebooks` | Every notebook with its live note count. |
| `upnote_list_notes` | Notes in one notebook, newest first. |
| `upnote_search_notes` | Full text search over titles and bodies, optionally scoped to a notebook. |
| `upnote_get_note` | Full text of one note by id. |
| `upnote_recent_notes` | Most recently updated notes across the library. |
| `upnote_list_tags` | All tags. |
| `upnote_open_note` | Open a note in the UpNote app. |
| `upnote_open_notebook` | Open a notebook in the UpNote app. |

## Install

Requires **Node 22.13 or later**, where `node:sqlite` stopped needing the
`--experimental-sqlite` flag. There is no other dependency beyond the MCP SDK.

```bash
git clone <this repo>
cd upnote-mcp
npm install
```

Then add it to your MCP client. For Claude Desktop, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "upnote": {
      "command": "node",
      "args": ["C:/path/to/upnote-mcp/server.mjs"],
      "env": { "UPNOTE_DEFAULT_NOTEBOOK": "Claude Notes" }
    }
  }
}
```

Claude Code reads a different file (`~/.claude.json`), so register it in both if you use both.

### Environment variables

| Variable | Default |
| --- | --- |
| `UPNOTE_DB` | Auto-detected. Set it only if detection fails. |
| `UPNOTE_DEFAULT_NOTEBOOK` | `Claude Notes`. Where notes go when none is named. |
| `UPNOTE_SNAPSHOT_DIR` | System temp folder. See "What it touches". |
| `UPNOTE_URL_LIMIT` | `100000`. Refuse to create a note whose encoded URL is longer. |

Auto-detected database locations:

- Windows Store build: `%LOCALAPPDATA%\Packages\24862ThomasDao.UpNote_kq65c2wy2rx02\LocalCache\Roaming\UpNote\upnote.sqlite3`
- Windows installer build: `%APPDATA%\UpNote\upnote.sqlite3`
- macOS: `~/Library/Containers/com.getupnote.mac/Data/Library/Application Support/UpNote/upnote.sqlite3`

## What it touches

Worth knowing before you run it:

- **It leaves a full copy of your notes in a temp folder.** Every refresh copies the database
  to `UPNOTE_SNAPSHOT_DIR`, defaulting to the system temp folder, and nothing deletes it.
  Anything that can read your temp folder can read your entire note library. On a shared or
  managed machine, point `UPNOTE_SNAPSHOT_DIR` somewhere only you can read.
- **Note text passes through a process command line.** Creating a note puts the URL-encoded
  body in the argv of the launcher process. On Windows other local processes can read that.
- It never writes to UpNote's own database file.

## Things that bit us

**WAL.** UpNote runs SQLite in WAL mode. Recent notes live in `upnote.sqlite3-wal`, not in the
main file. Copying the main file alone returns stale data, in testing it was months out of date,
with no error to tell you. The snapshot copies `.sqlite3`, `-wal` and `-shm` together, and opens
the copy read-write so SQLite can replay the WAL. A read-only handle cannot replay a WAL and
would silently serve the old data, so the "safer" option is the one that gives wrong answers.

**Notebook membership is not where you expect.** The `organizers` table is empty and
`notebooks.notes` is `[]` for every row. Membership actually lives in the `lists` table under
rows keyed `notebooks_<notebookId>`, each holding a JSON array of note ids. Anything that does
not know this reports every notebook as empty.

**Trashed notes.** The `notes` table holds trashed notes too, around 60 percent of rows in one
real library. Every query here filters `COALESCE(trashed,0) = 0`.

**Opening the URL.** Callback URLs contain `&` separators. On Windows the server spawns
`rundll32 url.dll,FileProtocolHandler <url>` with the URL as a single argv entry, so no shell
parser sees it and the 8191 character command line limit does not apply. 32,000 characters of
note content were verified intact end to end. macOS uses `open`, Linux `xdg-open`.

## Limits of UpNote, not of this server

- **No append and no edit.** UpNote's only write endpoints are `note/new` and `notebook/new`,
  so an existing note cannot be changed.
- **No tags on create.** The URL scheme has no tag parameter.
- Each write brings UpNote to the foreground and opens the new note.
- Reads see the local cache on that machine only. Notes written on a phone appear after that
  machine syncs.
- Local stdio server, so it works with a desktop MCP client on the same machine. Not with a
  web client, not on mobile.

## Platform support

Developed and tested on Windows 11 with the Microsoft Store build of UpNote.

macOS and Linux have code paths for both the database location and the URL opener, but they are
**untested**. Reports welcome.

## Test

```bash
node test-client.mjs read
node test-client.mjs write
```

`read` is side effect free. `write` creates real notes in your UpNote, and UpNote gives no way
to delete them programmatically, so you will need to trash them by hand. Override the notebook
and search terms it uses with `TEST_NOTEBOOK` and `TEST_QUERY`.

## License

MIT.
