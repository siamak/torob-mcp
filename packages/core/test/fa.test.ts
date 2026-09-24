import { toGregorian } from 'jalaali-js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  jalaliToIso,
  normalizeQuery,
  parseJalaliLabel,
  parsePersianInt,
  toAsciiDigits,
  toPersianLetters,
} from '../src/lib/fa.ts';

describe('digit conversion', () => {
  it('converts Persian and Arabic-Indic digits to ASCII', () => {
    expect(toAsciiDigits('۱۲۳')).toBe('123');
    expect(toAsciiDigits('١٢٣')).toBe('123');
  });

  it('leaves letters and ASCII digits alone', () => {
    expect(toAsciiDigits('iPhone 13')).toBe('iPhone 13');
  });
});

describe('letter normalization', () => {
  it('maps Arabic yeh and kaf to their Persian forms', () => {
    expect(toPersianLetters('يك')).toBe('یک');
  });
});

describe('normalizeQuery', () => {
  it('unifies the two spellings of the same Persian query', () => {
    // Arabic yeh vs Persian yeh - the single most common source of duplicate cache entries.
    expect(normalizeQuery('ايفون')).toBe(
      normalizeQuery('ایفون'),
    );
  });

  it('folds ZWNJ to a space for matching', () => {
    expect(normalizeQuery('می‌دان')).toBe(
      'می دان',
    );
  });

  it('property: is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), (s) => normalizeQuery(normalizeQuery(s)) === normalizeQuery(s)),
      { numRuns: 500 },
    );
  });

  it('property: never returns leading or trailing whitespace', () => {
    fc.assert(
      fc.property(fc.string(), (s) => normalizeQuery(s) === normalizeQuery(s).trim()),
      { numRuns: 300 },
    );
  });
});

describe('parsePersianInt', () => {
  it('reads a seller count out of Persian prose', () => {
    expect(parsePersianInt('در ۱۱ فروشگاه')).toBe(11);
  });

  it('reads a price with Persian thousands separators', () => {
    expect(
      parsePersianInt('۱۱۳٫۰۰۰٫۰۰۰ تومان'),
    ).toBe(113_000_000);
  });

  it('returns undefined rather than guessing', () => {
    expect(parsePersianInt(undefined)).toBeUndefined();
    expect(parsePersianInt(null)).toBeUndefined();
    expect(parsePersianInt('no digits here')).toBeUndefined();
  });
});

describe('Jalali conversion', () => {
  /**
   * Fixed points, including leap-year edges. 1403 is a leap year in the Solar Hijri calendar
   * (Esfand has 30 days); 1402 and 1404 are not.
   */
  const fixtures: [number, number, number, string, string][] = [
    [1400, 8, 4, '2021-10-26', 'the shop join date seen in the fixtures'],
    [1404, 1, 1, '2025-03-21', 'Nowruz'],
    [1403, 12, 30, '2025-03-20', 'leap year: Esfand 30 exists in 1403'],
    [1402, 12, 29, '2024-03-19', 'common year: Esfand ends at 29'],
    [1399, 12, 30, '2021-03-20', 'leap year 1399'],
    [1403, 6, 31, '2024-09-21', 'Shahrivar has 31 days'],
    [1403, 7, 1, '2024-09-22', 'the first 30-day month begins'],
    [1300, 1, 1, '1921-03-21', 'far past'],
    [1450, 1, 1, '2071-03-21', 'far future'],
  ];

  it.each(fixtures)('%i/%i/%i -> %s (%s)', (jy, jm, jd, iso) => {
    expect(jalaliToIso(jy, jm, jd)).toBe(iso);
  });

  it('rejects impossible dates instead of guessing', () => {
    expect(jalaliToIso(1403, 13, 1)).toBeUndefined();
    expect(jalaliToIso(1403, 0, 1)).toBeUndefined();
    expect(jalaliToIso(1403, 1, 0)).toBeUndefined();
    expect(jalaliToIso(1403, 1, 1.5)).toBeUndefined();
  });

  it('property: agrees with jalaali-js across the calendar', () => {
    // jalaali-js is the oracle here, and a devDependency only - shipping it would add a runtime
    // dependency to a package that has two.
    fc.assert(
      fc.property(
        fc.integer({ min: 1200, max: 1500 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 29 }),
        (jy, jm, jd) => {
          const expected = toGregorian(jy, jm, jd);
          const pad = (n: number) => String(n).padStart(2, '0');
          return (
            jalaliToIso(jy, jm, jd) === `${expected.gy}-${pad(expected.gm)}-${pad(expected.gd)}`
          );
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('property: agrees with jalaali-js on month-end days too', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1300, max: 1450 }),
        fc.integer({ min: 1, max: 6 }),
        fc.constantFrom(30, 31),
        (jy, jm, jd) => {
          const expected = toGregorian(jy, jm, jd);
          const pad = (n: number) => String(n).padStart(2, '0');
          return (
            jalaliToIso(jy, jm, jd) === `${expected.gy}-${pad(expected.gm)}-${pad(expected.gd)}`
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('parseJalaliLabel', () => {
  it('parses a price-chart label', () => {
    expect(parseJalaliLabel('۴ آبان ۱۴۰۰')).toBe(
      '2021-10-26',
    );
  });

  it('returns undefined for an unrecognised label rather than a wrong date', () => {
    expect(parseJalaliLabel('not a date')).toBeUndefined();
    expect(parseJalaliLabel('۴ ناماه ۱۴۰۰')).toBeUndefined();
    expect(parseJalaliLabel('')).toBeUndefined();
  });
});
