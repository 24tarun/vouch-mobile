/**
 * Real-time NLP deadline parser for the task title input.
 *
 * Supported tokens (case-insensitive):
 *   Weekdays  — @mon @tue @wed @thu @fri @sat @sun  (+ full names)
 *   Relative  — @today  @tomorrow/@tmrw
 *   Time      — @18:00  @1800  @9  @9am  @930pm
 *   Ordinal   — 14th  5th  (sets day within current month, or rolls to next month)
 *   Slash     — 13/04  13/04/2026
 *
 * Date tokens set only the date, preserving the existing time.
 * Time tokens set only the time, preserving the existing date.
 * Multiple tokens are all applied — so "@wed @18:00" → next Wednesday at 18:00.
 */

// ─── Weekday helpers ────────────────────────────────────────────────────────

const WEEKDAY_REGEX =
  /@(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi;

function weekdayTokenToIndex(token: string): number {
  const t = token.toLowerCase();
  if (t.startsWith('mon')) return 1;
  if (t.startsWith('tue')) return 2;
  if (t.startsWith('wed')) return 3;
  if (t.startsWith('thu')) return 4;
  if (t.startsWith('fri')) return 5;
  if (t.startsWith('sat')) return 6;
  return 0; // sunday
}

/** Returns the next occurrence of targetDay (0=Sun … 6=Sat), never today. */
function nextWeekday(targetDay: number, from: Date): Date {
  const offset = ((targetDay - from.getDay() + 7) % 7) || 7;
  const d = new Date(from);
  d.setDate(d.getDate() + offset);
  return d;
}

// ─── Time helpers ────────────────────────────────────────────────────────────

/** @18:00  @1800  @930  @9  @9am  @930pm  @9:30pm */
const TIME_REGEX = /@(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?\b/gi;

interface ParsedTime { hours: number; minutes: number }

function parseTimeToken(raw: string): ParsedTime | null {
  const m = raw.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === 'pm' && h < 12) h += 12;
  if (meridiem === 'am' && h === 12) h = 0;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { hours: h, minutes: min };
}

// ─── Ordinal date  (14th, 5th, 1st …) ───────────────────────────────────────

const ORDINAL_REGEX = /\b([12]?\d|3[01])(st|nd|rd|th)\b/gi;

// ─── Slash date  (13/04  or  13/04/2026) ────────────────────────────────────

const SLASH_DATE_REGEX =
  /\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])(?:\/(\d{4}))?\b/g;

// ─── Relative keywords ───────────────────────────────────────────────────────

const TOMORROW_REGEX = /@(?:tomorrow|tmrw)\b/i;
const TODAY_REGEX = /@today\b/i;

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Scans `text` for deadline tokens and returns an updated Date built on top of
 * `currentDeadline`. Returns `null` if no recognised tokens were found.
 */
export function parseTitleForDeadline(
  text: string,
  currentDeadline: Date,
): Date | null {
  if (!text) return null;

  const now = new Date();
  let result = new Date(currentDeadline);
  let dateChanged = false;
  let timeChanged = false;

  // ── Relative day tokens ──────────────────────────────────────────────────

  if (TODAY_REGEX.test(text)) {
    result.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
    dateChanged = true;
  } else if (TOMORROW_REGEX.test(text)) {
    const tom = new Date(now);
    tom.setDate(now.getDate() + 1);
    result.setFullYear(tom.getFullYear(), tom.getMonth(), tom.getDate());
    dateChanged = true;
  }

  // ── Weekday tokens ───────────────────────────────────────────────────────

  const wdMatches = [...text.matchAll(new RegExp(WEEKDAY_REGEX.source, 'gi'))];
  if (wdMatches.length > 0) {
    // Last weekday token wins
    const last = wdMatches[wdMatches.length - 1];
    const wd = nextWeekday(weekdayTokenToIndex(last[1]), now);
    result.setFullYear(wd.getFullYear(), wd.getMonth(), wd.getDate());
    dateChanged = true;
  }

  // ── Ordinal date tokens  (e.g. 14th) ────────────────────────────────────

  const ordMatches = [...text.matchAll(new RegExp(ORDINAL_REGEX.source, 'gi'))];
  if (ordMatches.length > 0) {
    const last = ordMatches[ordMatches.length - 1];
    const day = parseInt(last[1], 10);
    const candidate = new Date(result);
    candidate.setDate(day);
    // If the resolved date is in the past, roll to next month
    if (candidate <= now) candidate.setMonth(candidate.getMonth() + 1);
    result = new Date(candidate);
    dateChanged = true;
  }

  // ── Slash date tokens  (e.g. 13/04 or 13/04/2026) ───────────────────────

  const slashMatches = [...text.matchAll(new RegExp(SLASH_DATE_REGEX.source, 'g'))];
  if (slashMatches.length > 0) {
    const last = slashMatches[slashMatches.length - 1];
    const day = parseInt(last[1], 10);
    const month = parseInt(last[2], 10) - 1; // 0-indexed
    const year = last[3] ? parseInt(last[3], 10) : now.getFullYear();
    const candidate = new Date(result);
    candidate.setFullYear(year, month, day);
    result = new Date(candidate);
    dateChanged = true;
  }

  // ── Time tokens  (e.g. @18:00, @9am) ────────────────────────────────────

  const timeMatches = [...text.matchAll(new RegExp(TIME_REGEX.source, 'gi'))];
  // Filter out tokens already consumed by weekday/relative regex
  const pureTimeMatches = timeMatches.filter((m) => {
    // Skip if the captured group looks like a pure number that could be a day
    const parsed = parseTimeToken(m[1] + (m[2] ? `:${m[2]}` : '') + (m[3] ?? ''));
    return parsed !== null;
  });

  if (pureTimeMatches.length > 0) {
    const last = pureTimeMatches[pureTimeMatches.length - 1];
    const raw = last[1] + (last[2] ? `:${last[2]}` : '') + (last[3] ?? '');
    const parsed = parseTimeToken(raw);
    if (parsed) {
      result.setHours(parsed.hours, parsed.minutes, 0, 0);
      timeChanged = true;
    }
  }

  return dateChanged || timeChanged ? result : null;
}

/**
 * Returns whether the text contains any recognised deadline token —
 * useful for deciding whether to show a "parsed" indicator in the UI.
 */
export function titleHasDeadlineToken(text: string): boolean {
  if (!text) return false;
  return (
    TODAY_REGEX.test(text) ||
    TOMORROW_REGEX.test(text) ||
    new RegExp(WEEKDAY_REGEX.source, 'i').test(text) ||
    new RegExp(ORDINAL_REGEX.source, 'i').test(text) ||
    new RegExp(SLASH_DATE_REGEX.source).test(text) ||
    new RegExp(TIME_REGEX.source, 'i').test(text)
  );
}
