# Changelog

All notable changes to the **herdr Review** extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `Esc` closes the comment editor while it has focus. An edit in progress
  reverts, a thread opened but never filled disappears, and a thread holding
  queued comments collapses — nothing leaves the queue.

### Changed

- The payload sent to the agent now ends with a newline, so consecutive sends
  no longer run together on one line of the agent's input. It is inserted
  inside the bracketed-paste markers, so it is still not the Enter that would
  submit the review.
- **Discard Thread** now appears in a thread's header only once that thread
  holds more than one comment. On a single-comment thread it duplicated the
  comment's own delete action, showing two trash cans for one comment.
- The Marketplace badge URLs and the `code --install-extension` line in
  `README.md` now use the `endoumame` publisher, matching `package.json`.

### Performance

No behaviour changes; the payload the agent receives is byte for byte what it
was, and every rewritten routine is pinned to its previous output by tests.

- Commenting on a very large selection no longer reads the whole thing. Only
  the lines the snippet keeps are pulled out of the document, and with
  `herdr.snippetMaxLines` set to `0` the document is not opened at all. A
  20,000-line selection now costs the same as a 40-line one.
- The settings snapshot is read once and held until VS Code reports a `herdr.*`
  change, instead of fourteen `getConfiguration` reads on every request for a
  document's commenting ranges.
- Repository-root discovery memoises its `realpath` calls and the git
  extension's API handle, and resolves roots in parallel, so it no longer costs
  a syscall per root per comment. A failed lookup is still retried.
- Bracketed-paste wrapping is a single pass rather than a rescan per removal. A
  payload carrying embedded terminators — pasted terminal output, typically —
  no longer takes quadratic time.
- The status bar skips its update, and the `herdr.queueNotEmpty` context key
  its round trip to the workbench, when nothing they display has changed.
- Diff-side detection compares URI components instead of serialising every open
  tab's URIs, and the commenting range no longer materialises the last line of
  the document just to measure it.
- Agent-to-workspace matching normalises each root once per scan rather than
  once per agent, and export text normalisation returns the original string
  untouched when there is nothing to rewrite.

### Known issues

- On a line long enough for VS Code to wrap it, the gutter `+` is drawn once
  per wrapped row rather than once per line. It is still a single commenting
  position, and an extension cannot change it: VS Code draws the affordance
  with `linesDecorationsClassName`, which paints on every visual row. Tracked
  upstream as [microsoft/vscode#158837](https://github.com/microsoft/vscode/issues/158837).

## [0.1.0] - 2026-07-31

First public release.

### Added

- Inline review comments on ordinary files and on either side of a pull request
  diff, via `Ctrl+Alt+/` (`Cmd+Alt+/`) or the editor gutter `+`.
- A comment queue delivered to a herdr agent in one message with
  `Ctrl+Alt+Enter` (`Cmd+Alt+Enter`), byte-for-byte compatible with the
  [herdr-reviewr](https://github.com/persiyanov/herdr-reviewr) payload format.
- **herdr Review Queue** view in the Source Control sidebar, grouped by file,
  with per-comment send and delete actions.
- Automatic target agent selection by matching each agent's working directory
  against the workspace and git repository roots, remembered per workspace.
- Status bar item showing the target agent and the queued comment count.
- *Copy Queued Comments to Clipboard*, which produces the same payload without
  requiring herdr to be installed.
- `herdr` binary discovery across `HERDR_BIN_PATH`, `PATH`, the usual install
  directories and a login-shell probe, for GUI launches that do not inherit a
  shell `PATH`.
- 14 settings under the `herdr.*` namespace, including `herdr.snippetPrefix`,
  `herdr.bracketedPaste`, `herdr.agentMatchStrategy` and `herdr.preamble`.

[Unreleased]: https://github.com/endoumame/herdr-vscode/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/endoumame/herdr-vscode/releases/tag/v0.1.0
