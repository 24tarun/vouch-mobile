/**
 * Mobile task title parser with web-parity task DSL support.
 *
 * Supported tokens:
 * - Deadlines: @20:45, @2045, @8, tomorrow/tmrw, monday, 28th, 05/03, 05/03/2026, timer 25
 * - Events: -event with -start/-end (also -s/.s and -e/.e)
 * - Event colors: -color helper and aliases like -pink, -blue
 * - Task metadata: -proof, pomo N, remind@..., repeat daily|weekly|monthly|yearly, vouch/.v USER, -strict
 * - Subtasks: / delimiter
 */

export interface ParsedClockToken {
  hours: number;
  minutes: number;
}

export interface WeekdayTokenMatch {
  token: string;
  weekday: number;
  index: number;
}

export type ParsedDateToken =
  | { kind: 'ordinal'; day: number; index: number }
  | { kind: 'slash'; day: number; month: number; year: number | null; index: number };

export type RepeatToken = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

const MAX_POMO_DURATION_MINUTES = 120;

const WEEKDAY_TOKEN_PATTERN =
  '\\b@?(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\\b';

const WEEKDAY_TOKEN_REGEX = new RegExp(WEEKDAY_TOKEN_PATTERN, 'gi');
const TOMORROW_KEYWORD_REGEX = /\b@?(?:tmrw|tomorrow)\b/i;
const ORDINAL_DATE_TOKEN_REGEX = /\b([12]?\d|3[01])(st|nd|rd|th)\b/gi;
const SLASH_DATE_TOKEN_REGEX = /\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])(?:\/(\d{4}))?\b/g;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function mapWeekdayTokenToIndex(token: string): number {
  const normalized = token.toLowerCase();
  if (normalized.includes('mon')) return 1;
  if (normalized.includes('tue')) return 2;
  if (normalized.includes('wed')) return 3;
  if (normalized.includes('thu')) return 4;
  if (normalized.includes('fri')) return 5;
  if (normalized.includes('sat')) return 6;
  return 0;
}

function extractWeekdayDateTokens(text: string): WeekdayTokenMatch[] {
  const matches: WeekdayTokenMatch[] = [];
  const regex = new RegExp(WEEKDAY_TOKEN_PATTERN, 'gi');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    matches.push({
      token: match[1],
      weekday: mapWeekdayTokenToIndex(match[1]),
      index: match.index,
    });
  }

  return matches.sort((a, b) => a.index - b.index);
}

function resolveUpcomingWeekdayDate(targetWeekday: number, now: Date): Date {
  const offset = (targetWeekday - now.getDay() + 7) % 7;
  const resolved = new Date(now);
  resolved.setDate(resolved.getDate() + offset);
  return resolved;
}

function parseTaskInputTimeToken(token: string, allowHourOnly = true): ParsedClockToken | null {
  const normalized = token.trim().toLowerCase();

  const amPmMatch = normalized.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)$/i);
  if (amPmMatch) {
    let hours = Number.parseInt(amPmMatch[1], 10);
    const minutes = amPmMatch[2] ? Number.parseInt(amPmMatch[2], 10) : 0;
    const meridiem = amPmMatch[3].toLowerCase();

    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    return { hours, minutes };
  }

  let hours = Number.NaN;
  let minutes = Number.NaN;

  const colonMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (colonMatch) {
    hours = Number.parseInt(colonMatch[1], 10);
    minutes = Number.parseInt(colonMatch[2], 10);
  } else {
    const compactFourMatch = normalized.match(/^(\d{4})$/);
    if (compactFourMatch) {
      hours = Number.parseInt(compactFourMatch[1].slice(0, 2), 10);
      minutes = Number.parseInt(compactFourMatch[1].slice(2, 4), 10);
    } else {
      const compactThreeMatch = normalized.match(/^(\d{3})$/);
      if (compactThreeMatch) {
        hours = Number.parseInt(compactThreeMatch[1].slice(0, 1), 10);
        minutes = Number.parseInt(compactThreeMatch[1].slice(1, 3), 10);
      } else if (allowHourOnly) {
        const hourOnlyMatch = normalized.match(/^(\d{1,2})$/);
        if (hourOnlyMatch) {
          hours = Number.parseInt(hourOnlyMatch[1], 10);
          minutes = 0;
        }
      }
    }
  }

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return { hours, minutes };
}

function parseClockToken(raw: string): ParsedClockToken | null {
  return parseTaskInputTimeToken(raw, true);
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const candidate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  return (
    candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() + 1 === month
    && candidate.getUTCDate() === day
  );
}

function getDefaultDeadline(now: Date = new Date()): Date {
  const deadline = new Date(now);
  deadline.setHours(23, 0, 0, 0);
  if (deadline.getTime() <= now.getTime()) {
    deadline.setDate(deadline.getDate() + 1);
  }
  return deadline;
}

function parseDateTokens(text: string): ParsedDateToken[] {
  const tokens: ParsedDateToken[] = [];

  const ordinalRegex = new RegExp(ORDINAL_DATE_TOKEN_REGEX.source, 'gi');
  let ordinalMatch: RegExpExecArray | null;
  while ((ordinalMatch = ordinalRegex.exec(text)) !== null) {
    const parsedDay = Number.parseInt(ordinalMatch[1], 10);
    if (parsedDay >= 1 && parsedDay <= 31) {
      tokens.push({ kind: 'ordinal', day: parsedDay, index: ordinalMatch.index });
    }
  }

  const slashRegex = new RegExp(SLASH_DATE_TOKEN_REGEX.source, 'g');
  let slashMatch: RegExpExecArray | null;
  while ((slashMatch = slashRegex.exec(text)) !== null) {
    const parsedDay = Number.parseInt(slashMatch[1], 10);
    const parsedMonth = Number.parseInt(slashMatch[2], 10);
    const parsedYear = slashMatch[3] ? Number.parseInt(slashMatch[3], 10) : null;
    tokens.push({
      kind: 'slash',
      day: parsedDay,
      month: parsedMonth,
      year: parsedYear,
      index: slashMatch.index,
    });
  }

  return tokens.sort((a, b) => a.index - b.index);
}

const REPEAT_TOKEN_REGEX = /\brepeat\s+(daily|weekly|monthly|yearly)\b/i;
const REPEAT_TOKEN_GLOBAL_REGEX = /\brepeat\s+(?:daily|weekly|monthly|yearly)\b/gi;

export function parseRepeatTokenFromTitle(text: string): RepeatToken | null {
  const match = text.match(REPEAT_TOKEN_REGEX);
  if (!match) return null;
  return match[1].toUpperCase() as RepeatToken;
}

function stripRepeatTokens(text: string): string {
  return normalizeWhitespace(text.replace(REPEAT_TOKEN_GLOBAL_REGEX, ' '));
}

function parseTimerMinutesToken(text: string): number | null {
  const match = text.match(/\btimer\s+(\d+)\b/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) return null;
  return parsed;
}

const PROOF_REQUIRED_TOKEN_REGEX = /(^|\s)-proof(?=\s|$)/i;

export function parseProofRequiredFromTitle(text: string): boolean {
  return PROOF_REQUIRED_TOKEN_REGEX.test(text);
}

export function parseReminderTimesFromTitle(text: string): { hours: number; minutes: number }[] {
  const regex = /(?:^|\s)remind@(\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?)\b/gi;
  const results: { hours: number; minutes: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const parsed = parseTaskInputTimeToken(match[1], true);
    if (!parsed) continue;
    results.push(parsed);
  }

  return results;
}

export function parseRequiredPomoFromTitle(text: string): {
  requiredPomoMinutes: number | null;
  error?: string;
} {
  const match = text.match(/\bpomo\s+(\d+)\b/i);
  if (!match) return { requiredPomoMinutes: null };

  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_POMO_DURATION_MINUTES) {
    return {
      requiredPomoMinutes: null,
      error: `Required Pomodoro minutes must be an integer between 1 and ${MAX_POMO_DURATION_MINUTES}.`,
    };
  }

  return { requiredPomoMinutes: parsed };
}

export function resolveEventAnchorDate(
  text: string,
  now: Date = new Date(),
): { anchorDate: Date; error: string | null } {
  const parsedDateTokens = parseDateTokens(text);
  const parsedWeekdayTokens = extractWeekdayDateTokens(text);

  if (parsedDateTokens.length > 1 || parsedWeekdayTokens.length > 1) {
    return {
      anchorDate: getDefaultDeadline(now),
      error: 'Use only one date token (for example: monday, 28th or 05/03).',
    };
  }

  const hasTomorrowKeyword = TOMORROW_KEYWORD_REGEX.test(text);

  if (parsedDateTokens.length === 1) {
    const dateToken = parsedDateTokens[0];
    const year = dateToken.kind === 'slash' ? (dateToken.year ?? now.getFullYear()) : now.getFullYear();
    const month = dateToken.kind === 'slash' ? dateToken.month : now.getMonth() + 1;
    const day = dateToken.day;

    if (!isValidCalendarDate(year, month, day)) {
      return {
        anchorDate: getDefaultDeadline(now),
        error: 'Date is invalid. Use 28th, 05/03, or 05/03/2026.',
      };
    }

    return {
      anchorDate: new Date(year, month - 1, day, 12, 0, 0, 0),
      error: null,
    };
  }

  if (parsedWeekdayTokens.length === 1) {
    const anchorDate = resolveUpcomingWeekdayDate(parsedWeekdayTokens[0].weekday, now);
    anchorDate.setHours(12, 0, 0, 0);
    return { anchorDate, error: null };
  }

  if (hasTomorrowKeyword) {
    const anchorDate = new Date(now);
    anchorDate.setDate(anchorDate.getDate() + 1);
    anchorDate.setHours(12, 0, 0, 0);
    return { anchorDate, error: null };
  }

  return { anchorDate: getDefaultDeadline(now), error: null };
}

export const EVENT_TOKEN_REGEX = /(^|\s)-event(?=\s|$)/i;
const EVENT_START_TOKEN_REGEX = /(^|\s)(?:-start|-s|\.s)\s*(\d{1,2}:\d{2}|\d{1,4})\b/gi;
const EVENT_END_TOKEN_REGEX = /(^|\s)(?:-end|-e|\.e)\s*(\d{1,2}:\d{2}|\d{1,4})\b/gi;
const EVENT_AT_TIME_TOKEN_REGEX = /@(\d{1,2}:\d{2}|\d{3,4}|\d{1,2})\b/i;

const EVENT_DUPLICATE_START_ERROR = 'Use only one -start token.';
const EVENT_DUPLICATE_END_ERROR = 'Use only one -end token.';
const EVENT_MISSING_TIME_ERROR = 'Event tasks require both -startHHMM and -endHHMM.';
const EVENT_MIXED_TIME_ERROR = 'Event tasks cannot use @time. Use -start/-end only.';
const EVENT_START_INVALID_ERROR = 'Event start time is invalid. Use -start930 or -start09:30.';
const EVENT_END_INVALID_ERROR = 'Event end time is invalid. Use -end930 or -end15:00.';
const EVENT_END_BEFORE_START_ERROR = 'Event end time must be after start time.';

export interface ExtractedEventTokens {
  hasEvent: boolean;
  startToken?: string;
  endToken?: string;
  errors: string[];
}

export interface ResolveEventScheduleOptions {
  rawTitle: string;
  anchorDate: Date;
  defaultDurationMinutes: number;
  now?: Date;
}

export interface ResolveEventScheduleResult {
  hasEvent: boolean;
  startDate: Date | null;
  endDate: Date | null;
  error?: string;
}

function extractEventTokens(rawTitle: string): ExtractedEventTokens {
  const hasEvent = EVENT_TOKEN_REGEX.test(rawTitle);
  const errors: string[] = [];
  let startToken: string | undefined;
  let endToken: string | undefined;

  const startMatches = Array.from(rawTitle.matchAll(new RegExp(EVENT_START_TOKEN_REGEX.source, 'gi')));
  const endMatches = Array.from(rawTitle.matchAll(new RegExp(EVENT_END_TOKEN_REGEX.source, 'gi')));

  if (startMatches.length > 1) {
    errors.push(EVENT_DUPLICATE_START_ERROR);
  } else if (startMatches.length === 1) {
    startToken = startMatches[0][2];
  }

  if (endMatches.length > 1) {
    errors.push(EVENT_DUPLICATE_END_ERROR);
  } else if (endMatches.length === 1) {
    endToken = endMatches[0][2];
  }

  return { hasEvent, startToken, endToken, errors };
}

function applyClockToken(baseDate: Date, token: ParsedClockToken): Date {
  const next = new Date(baseDate);
  next.setHours(token.hours, token.minutes, 0, 0);
  return next;
}

export function resolveEventSchedule(options: ResolveEventScheduleOptions): ResolveEventScheduleResult {
  const { rawTitle, anchorDate, defaultDurationMinutes } = options;

  if (
    !(anchorDate instanceof Date)
    || Number.isNaN(anchorDate.getTime())
    || !Number.isInteger(defaultDurationMinutes)
    || defaultDurationMinutes < 0
    || defaultDurationMinutes > 1000
  ) {
    return { hasEvent: false, startDate: null, endDate: null, error: EVENT_START_INVALID_ERROR };
  }

  const extracted = extractEventTokens(rawTitle);
  if (!extracted.hasEvent) {
    return { hasEvent: false, startDate: null, endDate: null };
  }

  if (extracted.errors.length > 0) {
    return { hasEvent: true, startDate: null, endDate: null, error: extracted.errors[0] };
  }

  if (EVENT_AT_TIME_TOKEN_REGEX.test(rawTitle)) {
    return { hasEvent: true, startDate: null, endDate: null, error: EVENT_MIXED_TIME_ERROR };
  }

  if (!extracted.startToken || !extracted.endToken) {
    return { hasEvent: true, startDate: null, endDate: null, error: EVENT_MISSING_TIME_ERROR };
  }

  const parsedStart = extracted.startToken ? parseClockToken(extracted.startToken) : null;
  const parsedEnd = extracted.endToken ? parseClockToken(extracted.endToken) : null;

  if (extracted.startToken && !parsedStart) {
    return { hasEvent: true, startDate: null, endDate: null, error: EVENT_START_INVALID_ERROR };
  }

  if (extracted.endToken && !parsedEnd) {
    return { hasEvent: true, startDate: null, endDate: null, error: EVENT_END_INVALID_ERROR };
  }

  if (!parsedStart || !parsedEnd) {
    return { hasEvent: true, startDate: null, endDate: null, error: EVENT_MISSING_TIME_ERROR };
  }

  const startDate = applyClockToken(anchorDate, parsedStart);
  const endDate = applyClockToken(anchorDate, parsedEnd);

  if (endDate.getTime() <= startDate.getTime()) {
    return { hasEvent: true, startDate: null, endDate: null, error: EVENT_END_BEFORE_START_ERROR };
  }

  return { hasEvent: true, startDate, endDate };
}

export interface ResolveTaskDeadlineResult {
  deadline: Date;
  error: string | null;
}

export function resolveTaskDeadline(
  text: string,
  now: Date,
  defaultDurationMinutes: number,
): ResolveTaskDeadlineResult {
  const defaultDeadline = getDefaultDeadline(now);
  const isEventTask = EVENT_TOKEN_REGEX.test(text);

  if (isEventTask) {
    const anchorResolution = resolveEventAnchorDate(text, now);
    if (anchorResolution.error) {
      return { deadline: defaultDeadline, error: anchorResolution.error };
    }

    const eventResolution = resolveEventSchedule({
      rawTitle: text,
      anchorDate: anchorResolution.anchorDate,
      defaultDurationMinutes,
      now,
    });

    if (eventResolution.error || !eventResolution.endDate) {
      return { deadline: defaultDeadline, error: eventResolution.error || 'Event end time is invalid.' };
    }

    return { deadline: eventResolution.endDate, error: null };
  }

  const timerMinutes = parseTimerMinutesToken(text);
  if (timerMinutes !== null) {
    const timerDeadline = new Date(now);
    timerDeadline.setTime(now.getTime() + timerMinutes * 60000);
    return { deadline: timerDeadline, error: null };
  }

  const parsedDateTokens = parseDateTokens(text);
  const parsedWeekdayTokens = extractWeekdayDateTokens(text);

  if (parsedDateTokens.length > 1 || parsedWeekdayTokens.length > 1) {
    return { deadline: defaultDeadline, error: 'Use only one date token (for example: monday, 28th or 05/03).' };
  }

  const hasTomorrowKeyword = TOMORROW_KEYWORD_REGEX.test(text);
  const timeMatch = text.match(/(?:^|\s)@(\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?)\b/i);
  const parsedTime = timeMatch ? parseTaskInputTimeToken(timeMatch[1], true) : null;

  if (timeMatch && !parsedTime) {
    return { deadline: defaultDeadline, error: 'Deadline is invalid.' };
  }

  if (parsedDateTokens.length === 1) {
    const dateToken = parsedDateTokens[0];
    const year = dateToken.kind === 'slash' ? (dateToken.year ?? now.getFullYear()) : now.getFullYear();
    const month = dateToken.kind === 'slash' ? dateToken.month : now.getMonth() + 1;
    const day = dateToken.day;

    if (!isValidCalendarDate(year, month, day)) {
      return { deadline: defaultDeadline, error: 'Date is invalid. Use 28th, 05/03, or 05/03/2026.' };
    }

    const deadline = new Date(year, month - 1, day, parsedTime?.hours ?? 23, parsedTime?.minutes ?? 0, 0, 0);
    if (deadline.getTime() <= now.getTime()) {
      return { deadline, error: 'Deadline must be in the future.' };
    }

    return { deadline, error: null };
  }

  if (parsedWeekdayTokens.length === 1) {
    const deadline = resolveUpcomingWeekdayDate(parsedWeekdayTokens[0].weekday, now);
    deadline.setHours(parsedTime?.hours ?? 23, parsedTime?.minutes ?? 0, 0, 0);

    if (deadline.getTime() <= now.getTime()) {
      return { deadline, error: 'Deadline must be in the future.' };
    }

    return { deadline, error: null };
  }

  if (hasTomorrowKeyword) {
    const deadline = new Date(now);
    deadline.setDate(deadline.getDate() + 1);
    deadline.setHours(parsedTime?.hours ?? 23, parsedTime?.minutes ?? 0, 0, 0);
    return { deadline, error: null };
  }

  if (parsedTime) {
    const deadline = new Date(now);
    deadline.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
    if (deadline.getTime() <= now.getTime()) {
      return { deadline, error: 'Deadline must be in the future.' };
    }
    return { deadline, error: null };
  }

  return { deadline: defaultDeadline, error: null };
}

export type GoogleEventColorId = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11';

export interface GoogleEventColorOption {
  aliasToken: string;
  nativeToken: string;
  colorId: GoogleEventColorId;
  swatchHex: string;
}

export interface EventColorMatch {
  start: number;
  end: number;
  token: string;
  colorId: GoogleEventColorId;
  aliasToken: string;
  nativeToken: string;
}

export interface ResolvedEventColorSelection {
  colorId: GoogleEventColorId | null;
  aliasToken: string | null;
  nativeToken: string | null;
  matches: EventColorMatch[];
}

export const GOOGLE_EVENT_COLOR_OPTIONS: GoogleEventColorOption[] = [
  { aliasToken: '-lavender', nativeToken: '-lavender', colorId: '1', swatchHex: '#7986CB' },
  { aliasToken: '-lgreen', nativeToken: '-sage', colorId: '2', swatchHex: '#33B679' },
  { aliasToken: '-grape', nativeToken: '-grape', colorId: '3', swatchHex: '#8E24AA' },
  { aliasToken: '-pink', nativeToken: '-flamingo', colorId: '4', swatchHex: '#E67C73' },
  { aliasToken: '-yellow', nativeToken: '-banana', colorId: '5', swatchHex: '#F6BF26' },
  { aliasToken: '-orange', nativeToken: '-tangerine', colorId: '6', swatchHex: '#F4511E' },
  { aliasToken: '-lblue', nativeToken: '-peacock', colorId: '7', swatchHex: '#039BE5' },
  { aliasToken: '-graphite', nativeToken: '-graphite', colorId: '8', swatchHex: '#616161' },
  { aliasToken: '-blue', nativeToken: '-blueberry', colorId: '9', swatchHex: '#3F51B5' },
  { aliasToken: '-green', nativeToken: '-basil', colorId: '10', swatchHex: '#0B8043' },
  { aliasToken: '-red', nativeToken: '-tomato', colorId: '11', swatchHex: '#D50000' },
];

const ALIAS_VARIANTS: Record<string, string> = {
  '-lightgreen': '-lgreen',
  '-light-green': '-lgreen',
  '-lightblue': '-lblue',
  '-light-blue': '-lblue',
};

const COLOR_HELPER_TOKEN_REGEX = /(^|\s)(-color)(?=\s|$)/gi;
const COLOR_VALUE_LOOKUP = new Map<string, GoogleEventColorOption>();

for (const option of GOOGLE_EVENT_COLOR_OPTIONS) {
  COLOR_VALUE_LOOKUP.set(option.aliasToken, option);
  COLOR_VALUE_LOOKUP.set(option.nativeToken, option);
}

for (const [variantToken, aliasToken] of Object.entries(ALIAS_VARIANTS)) {
  const mapped = COLOR_VALUE_LOOKUP.get(aliasToken);
  if (mapped) COLOR_VALUE_LOOKUP.set(variantToken, mapped);
}

const COLOR_VALUE_TOKEN_NAMES = Array.from(COLOR_VALUE_LOOKUP.keys())
  .map((token) => token.slice(1))
  .sort((a, b) => b.length - a.length)
  .map((tokenName) => tokenName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const COLOR_VALUE_TOKEN_REGEX = new RegExp(`(^|\\s)(-(?:${COLOR_VALUE_TOKEN_NAMES.join('|')}))(?=\\s|$)`, 'gi');
const GOOGLE_EVENT_COLOR_ID_SET = new Set<GoogleEventColorId>(GOOGLE_EVENT_COLOR_OPTIONS.map((option) => option.colorId));

export function isGoogleEventColorId(value: unknown): value is GoogleEventColorId {
  return typeof value === 'string' && GOOGLE_EVENT_COLOR_ID_SET.has(value as GoogleEventColorId);
}

function buildColorOccurrence(match: RegExpExecArray): { start: number; end: number; token: string } {
  const leading = match[1] || '';
  const token = match[2] || '';
  const start = (match.index ?? 0) + leading.length;
  return { start, end: start + token.length, token };
}

function extractColorHelperTokens(rawTitle: string): { start: number; end: number; token: string }[] {
  return Array.from(rawTitle.matchAll(new RegExp(COLOR_HELPER_TOKEN_REGEX.source, 'gi'))).map(buildColorOccurrence);
}

function extractEventColorMatches(rawTitle: string): EventColorMatch[] {
  const matches = Array.from(rawTitle.matchAll(new RegExp(COLOR_VALUE_TOKEN_REGEX.source, 'gi')));
  const parsed: EventColorMatch[] = [];

  for (const match of matches) {
    const occurrence = buildColorOccurrence(match);
    const option = COLOR_VALUE_LOOKUP.get(occurrence.token.toLowerCase());
    if (!option) continue;

    parsed.push({
      ...occurrence,
      colorId: option.colorId,
      aliasToken: option.aliasToken,
      nativeToken: option.nativeToken,
    });
  }

  return parsed;
}

export function resolveEventColorFromTitle(rawTitle: string): ResolvedEventColorSelection {
  const matches = extractEventColorMatches(rawTitle);
  const latest = matches[matches.length - 1];
  return {
    colorId: latest?.colorId ?? null,
    aliasToken: latest?.aliasToken ?? null,
    nativeToken: latest?.nativeToken ?? null,
    matches,
  };
}

function stripEventColorTokens(rawTitle: string): string {
  const withoutHelpers = rawTitle.replace(new RegExp(COLOR_HELPER_TOKEN_REGEX.source, 'gi'), '$1');
  const withoutColors = withoutHelpers.replace(new RegExp(COLOR_VALUE_TOKEN_REGEX.source, 'gi'), '$1');
  return normalizeWhitespace(withoutColors);
}

export function validateEventColorUsage(rawTitle: string, hasEvent: boolean): { error?: string } {
  const helperCount = extractColorHelperTokens(rawTitle).length;
  const matchCount = extractEventColorMatches(rawTitle).length;

  if (!hasEvent && (helperCount > 0 || matchCount > 0)) {
    return {
      error: 'Color tags are supported only for -event tasks. Use -event with -pink, -blue, etc.',
    };
  }

  if (hasEvent && helperCount > 0) {
    return {
      error: 'Choose a color token for -color (for example: -pink).',
    };
  }

  return {};
}

function stripMetadata(text: string): string {
  if (!text) return '';

  const withoutStandardTokens = text
    .replace(/(^|\s)@(?:\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?)\b/gi, '$1')
    .replace(/(?:^|\s)-start\s*(?:\d{1,2}:\d{2}|\d{1,4})\b/gi, ' ')
    .replace(/(?:^|\s)-end\s*(?:\d{1,2}:\d{2}|\d{1,4})\b/gi, ' ')
    .replace(/(?:^|\s)(?:-s|\.s)\s*(?:\d{1,2}:\d{2}|\d{1,4})\b/gi, ' ')
    .replace(/(?:^|\s)(?:-e|\.e)\s*(?:\d{1,2}:\d{2}|\d{1,4})\b/gi, ' ')
    .replace(/\b([12]?\d|3[01])(?:st|nd|rd|th)\b/gi, '')
    .replace(/\b(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])(?:\/\d{4})?\b/g, '')
    .replace(/(^|\s)remind@(?:\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?)\b/gi, '$1')
    .replace(/\b@?(?:tmrw|tomorrow|today)\b/gi, '')
    .replace(new RegExp(WEEKDAY_TOKEN_REGEX.source, 'gi'), '')
    .replace(/(?:\bvouch|\.v)\s+[^\s/]+/gi, '')
    .replace(/(?:^|\s)-proof(?=\s|$)/gi, ' ')
    .replace(/\bpomo\s+\d+\b/gi, '')
    .replace(/\btimer\s+\d+\b/gi, '')
    .replace(/(^|\s)-strict(?=\s|$)/gi, ' ')
    .replace(/(^|\s)-event(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return stripRepeatTokens(stripEventColorTokens(withoutStandardTokens));
}

export function parseTaskTitleAndSubtasks(text: string): { title: string; subtasks: string[] } {
  const cleaned = stripMetadata(text);
  const segments = cleaned.split('/').map((segment) => segment.trim());
  const title = segments[0] || '';
  const subtasks = segments.slice(1).filter(Boolean);
  return { title, subtasks };
}

/**
 * Backward-compatible realtime deadline parser used by the typing UI.
 * Returns null when no recognisable deadline token is present.
 */
export function parseTitleForDeadline(
  text: string,
  _currentDeadline: Date,
): Date | null {
  if (!titleHasDeadlineToken(text) && !EVENT_TOKEN_REGEX.test(text)) {
    return null;
  }

  const resolution = resolveTaskDeadline(text, new Date(), 60);
  if (resolution.error) return null;
  return resolution.deadline;
}

export function titleHasDeadlineToken(text: string): boolean {
  if (!text) return false;
  return (
    TOMORROW_KEYWORD_REGEX.test(text)
    || /\b@today\b/i.test(text)
    || new RegExp(WEEKDAY_TOKEN_REGEX.source, 'i').test(text)
    || new RegExp(ORDINAL_DATE_TOKEN_REGEX.source, 'i').test(text)
    || new RegExp(SLASH_DATE_TOKEN_REGEX.source).test(text)
    || /(?:^|\s)@(\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?)\b/i.test(text)
    || /\btimer\s+\d+\b/i.test(text)
  );
}
