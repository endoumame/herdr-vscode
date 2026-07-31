# herdr Review for VS Code

Write inline review comments in VS Code — on pull request diffs or on ordinary
files — and send them to an agent running in [herdr](https://herdr.dev).

This is a VS Code counterpart to the
[herdr-reviewr](https://github.com/persiyanov/herdr-reviewr) TUI plugin. It
produces the **same payload format**, so the agent sees exactly what it would
have seen from the terminal:

```
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

Comments are collected into a queue and delivered in one message, sorted by
file and line. Sending is all-or-nothing: on success the queue is cleared, on
failure everything is preserved for a retry.

## Requirements

- [herdr](https://herdr.dev) 0.7.5 or newer, running on the same machine as
  the VS Code extension host. (0.7.5 is where `herdr agent list` began
  reporting each agent's working directory, which is how the extension picks
  the right agent automatically.)
- Optional: the
  [GitHub Pull Requests](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github)
  extension, if you want to comment on PR diffs.

## Usage

### Write a comment

**`Ctrl+Alt+/`** (`Cmd+Alt+/` on macOS) on a selection is the primary path. It
opens the comment editor inline at your selection — multi-line, focused, and
it works the same on an ordinary file and on either side of a PR diff. Press
**`Ctrl+Enter`** to queue it.

You can also click the **`+`** in the editor gutter. On a PR diff both this
extension and the GitHub Pull Requests extension offer a comment provider
there, so VS Code will ask which one you meant — pick **herdr**. The keyboard
shortcut skips that step, which is why it is the recommended route.

### Send

**`Ctrl+Alt+Enter`** (`Cmd+Alt+Enter`) sends everything queued, or click the
status bar item. The text is pasted into the agent's input **without pressing
Enter**, matching herdr-reviewr — review it in the agent pane and submit it
yourself. The extension focuses that pane for you.

The **herdr Review Queue** view in the Source Control sidebar shows what is
queued, grouped by file.

### Choose the agent

The extension matches each agent's working directory against your workspace
and git repository roots. With exactly one match it selects that agent and
tells you once; otherwise it asks, and remembers your choice per workspace. Run
**herdr: Select Target Agent** to change it.

## Commands

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

## Settings

| Setting | Default | Notes |
|---|---|---|
| `herdr.binPath` | `""` | Path to `herdr`. Empty tries `HERDR_BIN_PATH`, then `PATH`, then the usual install directories, then a login-shell probe. |
| `herdr.session` | `""` | Named session, passed as `HERDR_SESSION`. |
| `herdr.socketPath` | `""` | Passed as `HERDR_SOCKET_PATH`. |
| `herdr.extraArgs` | `[]` | Extra arguments before every subcommand. |
| `herdr.commandTimeoutMs` | `10000` | Per-invocation timeout. |
| `herdr.focusAgentAfterSend` | `true` | Run `herdr agent focus` after a send. |
| `herdr.snippetMaxLines` | `40` | Snippet cap per comment; `0` disables snippets. |
| `herdr.snippetPrefix` | `"auto"` | `+`/`-` on diffs, nothing on ordinary files. |
| `herdr.bracketedPaste` | `"always"` | See troubleshooting below. |
| `herdr.agentMatchStrategy` | `"cwd"` | `"any"` offers every running agent. |
| `herdr.commentingSchemes` | 9 schemes | Where the gutter affordance appears. |
| `herdr.clearThreadsAfterSend` | `true` | Remove threads from the editor after sending. |
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

**Nothing to send to, but you still want the comments.** *herdr: Copy Queued
Comments to Clipboard* produces the exact payload. The extension is a correct
reviewr-format exporter even with herdr absent.

## Development

```bash
npm install
npm run compile      # type-check + bundle
npm test             # unit tests over the pure modules
npm run lint
```

Press `F5` to launch an Extension Development Host.

The format-critical logic (`src/review/export.ts`, `location.ts`,
`snippet.ts`, `src/herdr/paste.ts`, `src/target/agentMatch.ts`) is kept free of
the `vscode` module — enforced by an ESLint rule — so it runs under plain
`node --test`.

## License

MIT
