// Privacy layer: every string that reaches data.js passes through `redact`,
// and `findLeak` is the last check before anything is written.
import { escapeRegExp } from './text.mjs';

/**
 * @param {string} userName  OS account name (the last segment of the home folder)
 * @param {string[]} extra   additional literal strings to scrub (student IDs, handles…)
 */
export function createRedactor(userName, extra = []) {
  const user = escapeRegExp(userName);
  // Whole words only, so a short name like "ada" leaves "adapter" alone.
  const words = [userName, ...extra].filter((w) => typeof w === 'string' && w.trim()).map(escapeRegExp);
  const literals = words.length ? `(?<![A-Za-z0-9])(?:${words.join('|')})(?![A-Za-z0-9])` : '(?!)'; // (?!) never matches
  // Order matters: emails first (so a username inside an address goes with it), then home paths, then leftovers.
  const rules = [
    [/[\w.+-]+@[\w-]+(\.[\w-]+)*\.[A-Za-z]{2,}\b/g, '‹redacted›'], // alphabetic TLD, so `react@18.2.0` survives
    [new RegExp(`/[a-z]/Users/${user}`, 'gi'), '~'], // Git Bash form, before the general rule eats its tail
    [new RegExp(`(?:[A-Za-z]:)?(?:\\\\{1,2}|/)(?:Users|home)(?:\\\\{1,2}|/)${user}`, 'gi'), '~'],
    [new RegExp(`[A-Za-z]--Users-${user}(-|$)`, 'gi'), ''], // Claude's encoded project folder names
    [new RegExp(literals, 'gi'), '‹user›'],
  ];
  const leak = new RegExp(`${literals}|${rules[0][0].source}`, 'i');

  return {
    redact: (s) => (typeof s === 'string' ? rules.reduce((acc, [re, to]) => acc.replace(re, to), s) : ''),
    /** Returns the first personal string still present in `text`, or null. */
    findLeak: (text) => text.match(leak)?.[0] ?? null,
  };
}
