/**
 * The `contextValue` this extension puts on every comment thread it owns, and
 * the pattern that recognises them in a `when` clause.
 *
 * A thread's contextValue is the only thing a keybinding can use to tell a
 * herdr comment editor apart from the one VS Code opens for the gutter `+`.
 * That widget is a *template* thread: VS Code creates it in the workbench and
 * only hands it to the reply command once the user submits, so this extension
 * has no reference to it and cannot close it. Escape must reach VS Code's own
 * handler in that case, which is what `THREAD_CONTEXT_PATTERN` in the keybinding
 * arranges.
 *
 * Kept free of `vscode` imports so the contribution tests can check the
 * `package.json` clauses against the real values.
 */

/** A thread whose comments can each be deleted on their own. */
export const THREAD_SINGLE = 'herdr.thread';

/**
 * A thread holding more than one comment, which additionally earns the
 * "Discard Thread" action in its header.
 */
export const THREAD_MULTI = 'herdr.threadMulti';

/**
 * Source of the regular expression used as `commentThread =~ /…/` in the
 * Escape keybinding. Matches both values above and nothing VS Code or another
 * extension produces.
 */
export const THREAD_CONTEXT_PATTERN = '^herdr\\.';
