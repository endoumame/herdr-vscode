/**
 * The `contextValue` this extension puts on every comment thread it owns.
 *
 * VS Code exposes it to `when` clauses as the `commentThread` context key,
 * which is how the thread title menu tells the two shapes apart.
 *
 * It deliberately drives no keybinding. A contributed keybinding is registered
 * at `ExternalExtension` weight and outranks everything VS Code binds inside a
 * comment widget, so gating one on a herdr thread does not make it work — it
 * only decides whose widget loses its built-in shortcut. See `closeEditors`.
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
