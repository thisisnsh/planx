import { createHash, randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * ULID: 10 chars of millisecond timestamp + 16 chars of randomness, Crockford
 * base32. Lexicographic sort equals chronological sort, which is what makes
 * `ls inbox/` and `ls feedback/` readable without parsing anything.
 */
export function ulid(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let rand = '';
  for (let i = 0; i < 16; i++) {
    rand += CROCKFORD[bytes[i]! % 32];
  }
  return time + rand;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Hash used for version identity and lock identity.
 *
 * Normalization trims trailing whitespace per line and normalizes line endings —
 * and nothing else. Locked means locked; the escape hatch is the unlock
 * handshake, not a fuzzy comparison (PLAN §6).
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
