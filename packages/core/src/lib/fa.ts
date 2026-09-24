/**
 * Persian text handling: input normalization, digit parsing, and Jalali date conversion.
 *
 * Every Persian string entering the server passes through `normalizeQuery`; every Persian-digit
 * number coming back from Torob passes through `parsePersianInt`.
 */

const ARABIC_TO_PERSIAN: ReadonlyMap<string, string> = new Map([
  ['ي', 'ی'], // ARABIC YEH -> FARSI YEH
  ['ى', 'ی'], // ALEF MAKSURA -> FARSI YEH
  ['ك', 'ک'], // ARABIC KAF -> KEHEH
  ['ڪ', 'ک'], // SWASH KAF -> KEHEH
  ['ة', 'ه'], // TEH MARBUTA -> HEH
  ['ؤ', 'و'], // WAW WITH HAMZA -> WAW
  ['إ', 'ا'], // ALEF WITH HAMZA BELOW -> ALEF
  ['أ', 'ا'], // ALEF WITH HAMZA ABOVE -> ALEF
  ['آ', 'ا'], // ALEF WITH MADDA -> ALEF
]);

/** Arabic-Indic U+0660.. and Extended Arabic-Indic (Persian) U+06F0.. */
const DIGIT_OFFSETS: readonly [number, number][] = [
  [0x0660, 0x0669],
  [0x06f0, 0x06f9],
];

/**
 * Invisible code points, written as numbers rather than regex literals.
 *
 * A formatter that collapses \\uXXXX escapes would otherwise put real invisible characters into
 * this source, which is unreviewable in a file whose whole job is removing them.
 */
const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

const classOf = (codePoints: readonly number[]): RegExp =>
  new RegExp(`[${codePoints.map((c) => `\\u${c.toString(16).padStart(4, '0')}`).join('')}]`, 'g');

/** Harakat (U+064B-U+0652), tatweel (U+0640), superscript alef (U+0670): noise for matching. */
const DIACRITICS = classOf([...range(0x064b, 0x0652), 0x0640, 0x0670]);

/** Zero-width characters. U+200C (ZWNJ) is deliberately absent - it is meaningful in Persian. */
const ZERO_WIDTH_EXCEPT_ZWNJ = classOf([0x200b, 0x200d, 0x200e, 0x200f, 0xfeff]);

const ZWNJ = /\u200c/g;

/** Converts Persian/Arabic digits in a string to ASCII, leaving everything else alone. */
export function toAsciiDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    let mapped = ch;
    for (const [start, end] of DIGIT_OFFSETS) {
      if (code >= start && code <= end) {
        mapped = String.fromCharCode(0x30 + (code - start));
        break;
      }
    }
    out += mapped;
  }
  return out;
}

/** Unifies Arabic letter forms to their Persian equivalents. */
export function toPersianLetters(input: string): string {
  let out = '';
  for (const ch of input) out += ARABIC_TO_PERSIAN.get(ch) ?? ch;
  return out;
}

/**
 * Normalizes user input for matching and for cache keys.
 *
 * Idempotent by construction: every step is a closed mapping, so `normalizeQuery(normalizeQuery(x))`
 * equals `normalizeQuery(x)` (asserted by a fast-check property).
 *
 * ZWNJ is stripped here because this output is used for *matching*, never for display. Output text
 * that reaches the model keeps its ZWNJ — see `sanitize.ts`.
 */
export function normalizeQuery(input: string): string {
  return toAsciiDigits(toPersianLetters(input.normalize('NFC')))
    .replace(DIACRITICS, '')
    .replace(ZERO_WIDTH_EXCEPT_ZWNJ, '')
    .replace(ZWNJ, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Pulls the first integer out of a mixed Persian/ASCII string.
 *
 * Torob writes counts and prices as Persian digits with thousands separators that vary between
 * U+066C, U+002C and U+066B ("در ۱۱ فروشگاه", "۱۱۳٫۰۰۰٫۰۰۰ تومان").
 */
export function parsePersianInt(input: string | null | undefined): number | undefined {
  if (input === null || input === undefined) return undefined;
  const ascii = toAsciiDigits(input).replace(/[٫٬,.،\s]/g, '');
  const match = /\d+/.exec(ascii);
  if (match === null) return undefined;
  const value = Number.parseInt(match[0], 10);
  return Number.isSafeInteger(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// Jalali -> Gregorian
//
// Kept in-repo rather than taking a dependency: packages/core has exactly two runtime deps and the
// arithmetic below is closed-form. Algorithm follows the standard Birashk/Borkowski breaks table
// used by jalaali-js (MIT).
// ---------------------------------------------------------------------------

const div = (a: number, b: number): number => Math.trunc(a / b);
const mod = (a: number, b: number): number => a - Math.trunc(a / b) * b;

const BREAKS: readonly number[] = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394,
  2456, 3178,
];

interface JalCal {
  readonly gy: number;
  readonly march: number;
}

function jalCal(jy: number): JalCal | undefined {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0] as number;
  let jump = 0;

  if (jy < jp || jy >= (BREAKS[bl - 1] as number)) return undefined;

  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i] as number;
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }

  const n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  return { gy, march: 20 + leapJ - leapG };
}

function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j += div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

/** Converts a Jalali (Solar Hijri) date to an ISO `YYYY-MM-DD` string, or undefined if invalid. */
export function jalaliToIso(jy: number, jm: number, jd: number): string | undefined {
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd)) return undefined;
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return undefined;
  const cal = jalCal(jy);
  if (cal === undefined) return undefined;
  const jdn = g2d(cal.gy, 3, cal.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  const g = d2g(jdn);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
}

const JALALI_MONTHS: readonly string[] = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

/**
 * Parses a Torob price-chart label such as "۴ آبان ۱۴۰۰" into an ISO date.
 *
 * Returns undefined rather than guessing when the label does not match — the chart tool then emits
 * the original label alone, which is honest about what we know.
 */
export function parseJalaliLabel(label: string): string | undefined {
  const text = toAsciiDigits(toPersianLetters(label.normalize('NFC'))).trim();
  const match = /^(\d{1,2})\s+(\S+)\s+(\d{4})$/.exec(text);
  if (match === null) return undefined;

  const day = Number.parseInt(match[1] as string, 10);
  const year = Number.parseInt(match[3] as string, 10);
  const monthName = toPersianLetters((match[2] as string).normalize('NFC'));
  const monthIndex = JALALI_MONTHS.findIndex((m) => toPersianLetters(m) === monthName);
  if (monthIndex < 0) return undefined;

  return jalaliToIso(year, monthIndex + 1, day);
}
