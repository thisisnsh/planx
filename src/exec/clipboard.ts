import { spawnSync } from 'node:child_process';

/**
 * The clipboard, through whatever this machine has.
 *
 * There is no cross-platform clipboard in node, so this is the list of things
 * that are one on each platform, tried in order. A missing binary is not an
 * error worth reporting — it is the next candidate — so the whole list is
 * walked before giving up.
 */
function candidates(): Array<[string, string[]]> {
  if (process.platform === 'darwin') return [['pbcopy', []]];
  if (process.platform === 'win32') return [['clip', []]];
  return [
    ['wl-copy', []],
    ['xclip', ['-selection', 'clipboard']],
    ['xsel', ['--clipboard', '--input']],
  ];
}

/**
 * OSC 52: the terminal's own copy, asked for over the wire.
 *
 * The one that works through ssh, where there is no local clipboard binary to
 * find and `pbcopy` would be putting the command on the wrong machine's
 * clipboard. It cannot be confirmed — the terminal never answers — and several
 * gate it behind a preference, so it is the fallback rather than the first try.
 */
function osc52(text: string): boolean {
  if (!process.stdout.isTTY) return false;
  process.stdout.write(`\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`);
  return true;
}

/**
 * Put `text` on the clipboard, and say whether anything took it.
 *
 * Called after the review has unmounted, never during it: `pbcopy` and friends
 * want a stdin of their own, and Ink is holding the terminal until then.
 */
export function copyToClipboard(text: string): boolean {
  for (const [command, args] of candidates()) {
    const run = spawnSync(command, args, {
      input: text,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    if (!run.error && run.status === 0) return true;
  }
  return osc52(text);
}
