# Repository Guidelines

## Project Structure & Module Organization

This repository is a small Node.js ESM MCP server for UpNote. Runtime entry points are at the repository root:

- `server.mjs` starts the MCP server; `launcher.mjs` opens UpNote URLs.
- `config.mjs` loads environment and platform configuration.
- `database.mjs` manages read-only snapshots of the UpNote SQLite database.
- `tools.mjs` defines MCP tools and their validation/dispatch behavior.
- `test/server.test.mjs` contains integration-style tests using synthetic SQLite fixtures.
- `README.md` documents setup, supported tools, URL endpoints, and configuration.

Keep new tests under `test/` and avoid committing private notes, databases, or generated artifacts.

## Build, Test, and Development Commands

Install dependencies with `npm install`. Run the server locally with `npm start` (`node server.mjs`). Run the full test suite with `npm test`; it uses Node’s built-in test runner and requires Node `>=22.13.0`. There is no separate build or formatter configured, so keep edits consistent with the existing source style.

## Coding Style & Naming Conventions

Use modern JavaScript modules (`.mjs`), four-space indentation, semicolons, and single quotes. Prefer `const`, descriptive camelCase names, early validation, and small focused helpers. Use `UPPER_SNAKE_CASE` for exported constant definitions such as tool metadata. MCP tool names use the `upnote_` prefix and snake_case (for example, `upnote_get_note`).

## Testing Guidelines

Add or update tests in `test/server.test.mjs` for behavior changes, especially tool schemas, URL encoding, limits, database filtering, and launcher failures. Tests should use isolated temporary fixtures rather than a developer’s real UpNote database. Run `npm test` before submitting changes.

## Commit & Pull Request Guidelines

Use concise imperative commit subjects, optionally with a conventional prefix such as `feat:`, `fix:`, or `docs:` (for example, `docs: clarify setup`). Keep commits focused. Pull requests should explain the user-visible behavior, identify configuration or compatibility impacts, include tests run, and update `README.md` when setup or supported tool behavior changes. Include relevant reproduction details for bug fixes; screenshots are generally unnecessary for this server.

## Security & Configuration Tips

Never commit credentials, private working notes, UpNote database files, or machine-specific paths. Treat database access as read-only and preserve URL encoding and configured size limits when changing tool behavior. Document new environment settings in `README.md`.
