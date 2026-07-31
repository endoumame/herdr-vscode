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
