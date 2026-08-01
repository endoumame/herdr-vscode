# herdr Review for VS Code

Review code where you read it. Write inline comments in VS Code — on pull
request diffs or on ordinary files — queue them up, and hand the whole batch to
an AI agent running in [herdr](https://herdr.dev) with one keystroke.

[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/endoumame.herdr-vscode?label=marketplace&color=0098FF)](https://marketplace.visualstudio.com/items?itemName=endoumame.herdr-vscode)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/endoumame.herdr-vscode?label=installs&color=0098FF)](https://marketplace.visualstudio.com/items?itemName=endoumame.herdr-vscode)
[![CI](https://img.shields.io/github/actions/workflow/status/endoumame/herdr-vscode/ci.yml?branch=main&label=CI)](https://github.com/endoumame/herdr-vscode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Reviewing an agent's work means pointing at lines. Doing that in a chat box
costs you a copy, a paste and a line number you have to type by hand. This
extension removes that step: select the lines, say what is wrong, and the
agent receives the file, the range and the code alongside your note.

It is the VS Code counterpart to the
[herdr-reviewr](https://github.com/persiyanov/herdr-reviewr) TUI plugin and
produces the **same payload format**, so the agent sees exactly what it would
have seen from the terminal:

```text
extruct/core/llm_registry.py:38 (removed)
-from .z import w
why was this removed?

extruct/core/llm_registry.py:40-41
+from .x import y
+REGISTRY = {}
this import path looks wrong

src/app.ts:12
export const PORT = 3000;
make this configurable
```

## Features

- **Comment anywhere.** Ordinary files, VS Code's built-in SCM diffs, and
  either side of a GitHub pull request diff — the base side is reported as
  `(removed)` so the agent knows you are talking about deleted code.
- **Batch, then send.** Comments collect in a queue and go out as one message,
  sorted by file and line, so the agent gets the whole review at once instead
  of a stream of interruptions.
- **All-or-nothing delivery.** On success the queue is cleared; on any failure
  every comment is preserved for a retry. A failed send never costs you work.
- **The agent decides, not the extension.** The payload is pasted into the
  agent's input **without pressing Enter**. You read it in the agent pane and
  submit it yourself.
- **Finds the right agent by itself.** Each agent's working directory is
  matched against your workspace and git repository roots; your choice is
  remembered per workspace.
- **Useful without herdr.** *Copy Queued Comments to Clipboard* produces the
  exact same payload, so the extension is a correct reviewr-format exporter
  even where herdr is not installed.

## Requirements

- **[herdr](https://herdr.dev) 0.7.5 or newer**, running on the same machine
  as the VS Code extension host. 0.7.5 is where `herdr agent list` began
  reporting each agent's working directory, which is how the extension picks
  the right agent automatically.
- **Optional:** the
  [GitHub Pull Requests](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github)
  extension, if you want to comment on PR diffs.
- **Windows:** herdr is a Unix terminal multiplexer. Run VS Code in
  [WSL](https://code.visualstudio.com/docs/remote/wsl) so the extension host
  sits next to herdr — this extension declares `extensionKind: workspace`, so
  in a remote or WSL window it runs on the remote side, where herdr is.

This extension does not run in
[untrusted workspaces](https://code.visualstudio.com/api/extension-guides/workspace-trust):
it executes the herdr CLI, and the path to that binary can come from workspace
settings.

## Getting started

1. **Install.** Search for *herdr Review* in the Extensions view
   (`Ctrl+Shift+X`), or run:

   ```bash
   code --install-extension endoumame.herdr-vscode
   ```

2. **Start an agent in herdr** in the repository you are reviewing. The status
   bar shows `herdr: <agent>` once one is found.
3. **Select some lines** in any editor and press `Ctrl+Alt+/`
   (`Cmd+Alt+/` on macOS). Type your note, then `Ctrl+Enter` to queue it.
4. **Send** with `Ctrl+Alt+Enter` (`Cmd+Alt+Enter`). Switch to the agent pane,
   read what arrived, and press Enter to submit it.

## Usage

### Writing a comment

**`Ctrl+Alt+/`** (`Cmd+Alt+/`) on a selection is the primary path. It opens the
comment editor inline at your selection — multi-line, focused, and identical
on an ordinary file and on either side of a PR diff. Press **`Ctrl+Enter`**
(`Cmd+Enter`) to queue it.

You can also click the **`+`** in the editor gutter. On a PR diff both this
extension and the GitHub Pull Requests extension offer a comment provider
there, so VS Code will ask which one you meant — pick **herdr**. The keyboard
shortcut skips that step, which is why it is the recommended route.

Press **`Esc`** to close the comment editor. An edit in progress reverts to
what is queued, a thread you opened but never filled disappears, and a thread
that already holds comments collapses — nothing leaves the queue. In the
widget VS Code opens for the gutter `+`, `Esc` stays VS Code's own: it closes
that editor too, but asks first if you have typed something into it.

Queued comments stay visible in the editor as collapsed threads. Use each
comment's **Edit** and **Delete Comment** actions to revise or drop it. Once a
thread holds more than one comment, a **Discard Thread** action appears in its
header to drop them all at once.

### Sending

**`Ctrl+Alt+Enter`** (`Cmd+Alt+Enter`) sends everything queued; so does
clicking the status bar item. The extension runs `herdr pane send-text`, which
pastes the payload into the agent's input **without pressing Enter**, matching
herdr-reviewr. It then focuses that pane so you can review and submit.

The payload ends with a newline, so a second send starts on its own line
instead of running on from the end of the first. The newline goes inside the
bracketed-paste markers, where a terminal inserts it literally rather than
treating it as the Enter that would submit the review.

If a send fails — no agents running, herdr not found, a timeout — nothing is
lost. The error offers a way out that fits the cause (retry, refresh the agent
list, set the binary path) alongside **Copy to Clipboard** and **Show Log**,
and your comments stay queued until one of them works.

### The queue view

**herdr Review Queue** in the Source Control sidebar lists everything queued,
grouped by file. Click an entry to jump to it; use the inline actions to send
or delete a single comment.

### Choosing the target agent

The extension matches each agent's working directory against your workspace
folders and git repository roots, preferring an exact match, then an agent
started inside the repository, then one started at a parent directory. With
exactly one match it selects that agent and tells you once; otherwise it asks,
and remembers your answer for that workspace.

Run **herdr: Select Target Agent** to change it, or set
`herdr.agentMatchStrategy` to `any` to always be offered every running agent.

## The payload format

The format is a contract with herdr-reviewr, not a presentation choice — the
agent receives this text verbatim. Each comment is a block of:

```text
<repo-relative path>:<line>[-<end line>][ (removed)]
<snippet lines, optionally + / - prefixed>
<your comment>
```

Blocks are sorted by file path then start line and joined by a blank line.
Comment bodies have carriage returns stripped, trailing whitespace trimmed and
blank lines dropped — a blank line inside a body would otherwise read as the
separator between two comments and split one block into two malformed ones.

Snippet prefixes are `auto` by default: `+` / `-` on diffs, nothing on
ordinary files. Prefixing an ordinary file's lines with `+` would tell the
agent they were added when they were not.

Set `herdr.preamble` to prepend framing text — an empty preamble matches
herdr-reviewr byte for byte.

## Commands

All commands are under the **herdr** category in the Command Palette
(`Ctrl+Shift+P`).

| Command | Default keybinding |
|---|---|
| herdr: Comment on Selection | `Ctrl+Alt+/` / `Cmd+Alt+/` |
| herdr: Send Queued Comments to Agent | `Ctrl+Alt+Enter` / `Cmd+Alt+Enter` |
| herdr: Copy Queued Comments to Clipboard | |
| herdr: Select Target Agent | |
| herdr: Refresh Agents | |
| herdr: Focus Agent Pane | |
| herdr: Clear Queued Comments | |
| herdr: Show Log | |

`Ctrl+Enter` (`Cmd+Enter`) queues the comment you are typing and `Esc` closes
the editor. Both are active only while the comment editor has focus. `Enter`
stays a newline, as it is everywhere else in a VS Code comment editor.

`Ctrl+Enter` is VS Code's own shortcut for the comment widget: it runs the
first action the widget offers, which is **Queue Comment** while writing and
**Save** while editing a queued comment. That is why it is not listed as a
herdr keybinding — an extension binding on the same key would win and arrive
without the text you are typing, which is a thing no command can recover.
Rebind it under *Keyboard Shortcuts* as `editor.action.submitComment` if you
want it somewhere else.

## Settings

| Setting | Default | Notes |
|---|---|---|
| `herdr.binPath` | `""` | Path to `herdr`. Empty tries `HERDR_BIN_PATH`, then `PATH`, then the usual install directories, then a login-shell probe. |
| `herdr.session` | `""` | Named session, passed as `HERDR_SESSION`. |
| `herdr.socketPath` | `""` | Passed as `HERDR_SOCKET_PATH`. Supports `~`. |
| `herdr.extraArgs` | `[]` | Extra arguments inserted before every subcommand. |
| `herdr.commandTimeoutMs` | `10000` | Per-invocation timeout, in milliseconds. |
| `herdr.focusAgentAfterSend` | `true` | Run `herdr agent focus` after a send. |
| `herdr.snippetMaxLines` | `40` | Snippet cap per comment; `0` disables snippets. |
| `herdr.snippetPrefix` | `"auto"` | `+` / `-` on diffs, nothing on ordinary files. `diff` always prefixes, `none` never does. |
| `herdr.bracketedPaste` | `"always"` | Wrap the payload in `ESC[200~` / `ESC[201~`. See troubleshooting. |
| `herdr.agentMatchStrategy` | `"cwd"` | `"any"` offers every running agent. |
| `herdr.commentingSchemes` | 9 schemes | URI schemes where the gutter affordance appears. `[]` turns the gutter off entirely; the keyboard shortcut keeps working. |
| `herdr.showStatusBar` | `true` | Show the target agent and queue count in the status bar. |
| `herdr.clearThreadsAfterSend` | `true` | Remove threads from the editor after a successful send. |
| `herdr.preamble` | `""` | Optional framing text. Empty matches herdr-reviewr byte for byte. |

## Troubleshooting

**`herdr: not found` in the status bar.** VS Code launched from the Dock,
Finder or a `.desktop` entry does not inherit your shell's `PATH`, so
`~/.local/bin`, `/opt/homebrew/bin` and `~/.cargo/bin` are missing. The
extension probes those anyway and falls back to asking your login shell, but if
herdr lives somewhere else, set `herdr.binPath`.

**A literal `[200~` shows up in the agent's prompt.** Your herdr version wraps
the text in bracketed paste on its side, so the extension's wrapping is
doubled. Set `herdr.bracketedPaste` to `never`.

**No agents found.** Check `herdr agent list` in a terminal. If it works there
but not here, you are probably on a named session — set `herdr.session`.

**"…may exceed the operating system's argument size limit."** The whole payload
rides as a single argv entry, and Linux caps one entry at 128 KiB regardless of
the total; the warning appears from 100 KB. Send in smaller batches, or lower
`herdr.snippetMaxLines`.

**The gutter `+` repeats down a wrapped line.** A long line that VS Code wraps
gets one `+` per wrapped row, which looks like several separate places to
comment. It is one commenting position: clicking any of them opens a single
thread on that one line. This is not something an extension can change — VS
Code draws the affordance with Monaco's `linesDecorationsClassName`, which
paints on every visual row of a wrapped line, and the option that would limit
it to the first row (`firstLineDecorationClassName`) is not the one the
comments feature uses. See
[microsoft/vscode#158837](https://github.com/microsoft/vscode/issues/158837)
for the upstream request. Use `Ctrl+Alt+/` instead, or set
`herdr.commentingSchemes` to `[]` to remove the gutter affordance and drive the
extension entirely from the keyboard.

**Nothing to send to, but you still want the comments.** *herdr: Copy Queued
Comments to Clipboard* produces the exact payload.

**Anything else.** Run **herdr: Show Log** — the *herdr Review* output channel
records the exact payload handed to herdr, byte count included, along with
every failure.

## Development

```bash
npm install
npm run compile      # type-check + bundle
npm run watch        # rebuild on change
npm test             # unit tests over the pure modules
npm run lint
npm run icon         # regenerate images/icon.png
```

Press `F5` to launch an Extension Development Host.

The format-critical logic (`src/review/export.ts`, `location.ts`,
`snippet.ts`, `src/herdr/paste.ts`, `src/target/agentMatch.ts`) is kept free of
the `vscode` module — enforced by an ESLint rule — so it runs under plain
`node --test`. Changes to the payload format belong there, with a test, because
that format is a contract with herdr-reviewr.

## Releasing

A `v*` tag is what ships a release. `.github/workflows/publish.yml` runs the
checks, publishes to the Marketplace with the `VSCE_PAT` repository secret, and
creates the GitHub release with the VSIX attached and generated notes. The tag
must match `version` in `package.json` — the workflow fails on a mismatch
rather than shipping the wrong version.

1. Bump `version` in `package.json` and `package-lock.json`. Do this by hand or
   with `npm version <ver> --no-git-tag-version`; the latter reformats the whole
   manifest, so revert everything but the version line if you use it.
2. Move the `Unreleased` entries in `CHANGELOG.md` under a dated heading for
   the new version, and add its `compare` link at the bottom.
3. Commit, open a pull request, and merge it to `main`.
4. Tag the merge commit on `main` and push the tag:

   ```bash
   git tag v0.2.2
   git push origin v0.2.2
   ```

Marketplace validation takes a few minutes; `npx vsce show endoumame.herdr-vscode`
reports the published state. Run the workflow from the Actions tab with *dry
run* enabled to rehearse the whole thing without publishing.

To release by hand instead — from a clean tree on `main`, logged in with
`npx vsce login endoumame`:

```bash
npm run package        # -> herdr-vscode-<version>.vsix, runs the pre-publish checks
npm run package:ls     # exactly what the VSIX will contain
npm run publish
gh release create v0.2.2 herdr-vscode-0.2.2.vsix --generate-notes
```

## Contributing

Issues and pull requests are welcome at
[endoumame/herdr-vscode](https://github.com/endoumame/herdr-vscode). Please run
`npm run lint && npm test` before opening one; CI runs the same checks plus a
packaging step.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
