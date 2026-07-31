/**
 * The AmigaDOS calendar: `DateStamp` and the arithmetic around it.
 *
 * This is the one piece every dated thing in the system shares. It existed
 * four times before this file did — in the host clock, in JD, in LDos and in
 * locale.library's formatter — each with its own copy of the epoch and its
 * own day-to-date conversion. Four copies of calendar arithmetic is where a
 * leap-year rule goes wrong in one of them and stays wrong for years.
 *
 * ## Mechanism only
 *
 * Everything here is physics: the epoch, the conversion, leap years, the day
 * of the year, the weekday. Nothing here decides how a date is PRESENTED or
 * what happens at the edges, because those are not shared facts — they belong
 * to whichever library is answering:
 *
 *  - LDos's `Ldate` clamps below the epoch, because its manual says "if the
 *    date is before 1 Jan 1978, 780101 will be returned". That clamp is
 *    LDos's and lives at LDos's call site.
 *  - JD prints English day names because its 5.3 source hardcodes them, and
 *    it must go on doing so even when a locale is loaded.
 *  - locale.library formats through a Locale, and its month names come from a
 *    `.language`.
 *
 * Pulling any of that in here would make the port less faithful while looking
 * like a cleanup. See ./README.md.
 */

/**
 * An AmigaDOS DateStamp. This is the shape AmigaDOS itself uses and the
 * currency every dated thing in the system speaks: `Lsys Stamp`, `Lsys Time`,
 * `Lset File Date` and the datestamp on every file all want exactly this.
 */
export interface DateStamp {
  /** days since 1 January 1978 */
  days: number
  /** minutes since midnight */
  mins: number
  /** ticks elapsed in the current minute, at 1/50 s — a vertical blank */
  ticks: number
}

/** 1 January 1978, as a UTC epoch millisecond count */
export const STAMP_EPOCH = Date.UTC(1978, 0, 1)
export const DAY_MS = 86_400_000
/** a tick is a vertical blank: 1/50 s */
export const TICKS_PER_SECOND = 50

/** civil fields, the shape a formatter wants */
export interface Civil {
  year: number
  month: number // 1-12
  day: number // 1-31
  hour: number
  min: number
  sec: number
  /** 0 = Sunday. 1 January 1978 was a Sunday, so this is a plain remainder */
  weekday: number
}

export const isLeap = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)

/** days elapsed before the given month (1-12) in a non-leap year */
const DAYS_BEFORE = [0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

/** day of the year, 1-366 */
export const yearDay = (t: Pick<Civil, 'year' | 'month' | 'day'>): number =>
  t.day + DAYS_BEFORE[t.month]! + (isLeap(t.year) && t.month > 2 ? 1 : 0)

/**
 * A whole DateStamp as a JS Date. NOT clamped — a negative day count gives a
 * date before the epoch, which is what the arithmetic says. Callers that must
 * clamp do it themselves, because whether to clamp is their library's rule.
 */
export const stampToDate = (st: DateStamp): Date =>
  new Date(
    STAMP_EPOCH + st.days * DAY_MS + st.mins * 60_000 + Math.floor(st.ticks / TICKS_PER_SECOND) * 1000,
  )

/** just the date part: [year, month 1-12, day] */
export function stampToYmd(days: number): [number, number, number] {
  const d = new Date(STAMP_EPOCH + days * DAY_MS)
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]
}

/** the full civil breakdown a date formatter needs */
export function civilFromStamp(days: number, mins: number, ticks: number): Civil {
  const d = new Date(STAMP_EPOCH + days * DAY_MS)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: Math.floor(mins / 60),
    min: mins % 60,
    sec: Math.floor(ticks / TICKS_PER_SECOND),
    weekday: ((days % 7) + 7) % 7,
  }
}

/** a wall-clock Date as a DateStamp, in the host's local time */
export function dateToStamp(d: Date): DateStamp {
  const utcMidnight = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return {
    days: Math.floor((utcMidnight - STAMP_EPOCH) / DAY_MS),
    mins: d.getHours() * 60 + d.getMinutes(),
    ticks: Math.floor((d.getSeconds() * 1000 + d.getMilliseconds()) / (1000 / TICKS_PER_SECOND)),
  }
}
