import { createHash, randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastTime = -1;
let lastRandom: number[] = [];

/**
 * ULID: 10 chars of millisecond timestamp + 16 chars of randomness, Crockford
 * base32. Lexicographic sort equals chronological sort, which is what makes
 * `ls inbox/` and `ls feedback/` readable without parsing anything.
 *
 * **Monotonic within a millisecond.** Two ids minted in the same millisecond
 * increment the random component instead of re-rolling it, so ordering by id is
 * still ordering by creation. Without this, two feedback records submitted in
 * the same millisecond have no defined order, and "the reviewer's most recent
 * verdict" becomes a coin flip.
 */
export function ulid(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }

  if (now === lastTime && lastRandom.length) {
    lastRandom = incrementBase32(lastRandom);
  } else {
    lastTime = now;
    lastRandom = [...randomBytes(16)].map((b) => b % 32);
  }

  return time + lastRandom.map((i) => CROCKFORD[i]).join('');
}

/** Add one to a big-endian base-32 digit array, carrying leftwards. */
function incrementBase32(digits: number[]): number[] {
  const next = [...digits];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i]! < 31) {
      next[i]!++;
      return next;
    }
    next[i] = 0;
  }
  // Overflowed all 16 digits inside one millisecond — not reachable in
  // practice, but re-rolling beats returning a duplicate.
  return [...randomBytes(16)].map((b) => b % 32);
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Hash used for version identity and lock identity.
 *
 * Normalization trims trailing whitespace per line and normalizes line endings —
 * and nothing else. Locked means locked; the escape hatch is the unlock
 * handshake, not a fuzzy comparison.
 */
export function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');
}

export function contentHash(text: string): string {
  return sha256(normalize(text));
}

const SLUG_MAX_WORDS = 6;
const SLUG_MAX_LEN = 48;

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[`*_~[\]()#>]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, SLUG_MAX_WORDS)
    .join('-')
    .slice(0, SLUG_MAX_LEN)
    .replace(/-+$/, '');
  return slug || 'plan';
}

/**
 * Plan id = kebab slug of the title + a 4-char content hash.
 *
 * Greppable and tab-completable, which a ULID would not be, while the hash
 * suffix keeps two plans named "refactor the poller" apart.
 */
export function planId(title: string, content: string): string {
  return `${slugify(title)}-${contentHash(content).slice(0, 4)}`;
}
