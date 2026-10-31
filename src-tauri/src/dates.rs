//! The crate's single date/time helper. Every timestamp parse and every calendar-day
//! computation goes through here so that timezone handling stays in one place.
//!
//! All calendar days are UTC days. Timestamps without a zone designator are read as UTC,
//! never as process-local time.

use std::time::{SystemTime, UNIX_EPOCH};

const MS_PER_DAY: i64 = 86_400_000;

/// Milliseconds since the Unix epoch, now. Returns 0 if the system clock is before 1970.
pub fn now_ms() -> i64 {
    system_time_ms(SystemTime::now())
}

/// Milliseconds since the Unix epoch at `time`, such as a file's mtime. Returns 0 for a time
/// before 1970.
pub fn system_time_ms(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm).
pub fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let m = month as i64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Inverse of [`days_from_civil`]: (year, month, day) for a day number.
pub fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let year = yoe + era * 400 + (if month <= 2 { 1 } else { 0 });
    (year, month, day)
}

/// UTC day number (days since 1970-01-01) containing `ms`.
pub fn utc_day(ms: i64) -> i64 {
    ms.div_euclid(MS_PER_DAY)
}

/// `YYYY-MM-DD` for a UTC day number.
pub fn day_to_string(day: i64) -> String {
    let (y, m, d) = civil_from_days(day);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// Parses a `YYYY-MM-DD` date into a UTC day number. Rejects out-of-range fields.
pub fn parse_day(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let year: i64 = s.get(0..4)?.parse().ok()?;
    let month: u32 = s.get(5..7)?.parse().ok()?;
    let day: u32 = s.get(8..10)?.parse().ok()?;
    if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
        return None;
    }
    Some(days_from_civil(year, month, day))
}

fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => {
            let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
            if leap { 29 } else { 28 }
        }
    }
}

/// Parses an ISO-8601-style timestamp into epoch milliseconds.
///
/// Accepts `YYYY-MM-DDTHH:MM:SS`, a space instead of `T` (the SQLite form), optional
/// fractional seconds, and an optional `Z` or `±HH:MM` / `±HHMM` offset. A timestamp with
/// no zone designator is read as UTC. A bare `YYYY-MM-DD` is midnight UTC.
pub fn parse_timestamp_ms(s: &str) -> Option<i64> {
    let s = s.trim();
    let day = parse_day(s.get(0..10)?)?;
    let rest = &s[10..];
    if rest.is_empty() {
        return Some(day * MS_PER_DAY);
    }
    let rest = rest.strip_prefix('T').or_else(|| rest.strip_prefix(' '))?;
    let b = rest.as_bytes();
    if b.len() < 8 || b[2] != b':' || b[5] != b':' {
        return None;
    }
    let hh: i64 = rest.get(0..2)?.parse().ok()?;
    let mm: i64 = rest.get(3..5)?.parse().ok()?;
    let ss: i64 = rest.get(6..8)?.parse().ok()?;
    if hh > 23 || mm > 59 || ss > 60 {
        return None;
    }
    let mut tail = &rest[8..];
    let mut frac_ms: i64 = 0;
    if let Some(after_dot) = tail.strip_prefix('.') {
        let digits = after_dot.bytes().take_while(|c| c.is_ascii_digit()).count();
        if digits == 0 {
            return None;
        }
        let frac = &after_dot[..digits];
        // Keep millisecond precision: pad or truncate to three digits.
        let padded = format!("{:0<3}", &frac[..frac.len().min(3)]);
        frac_ms = padded.parse().ok()?;
        tail = &after_dot[digits..];
    }
    let offset_min: i64 = match tail {
        "" | "Z" | "z" => 0,
        _ => {
            let sign = match tail.as_bytes()[0] {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            let digits: String = tail[1..].chars().filter(|c| *c != ':').collect();
            if digits.len() != 4 || !digits.bytes().all(|c| c.is_ascii_digit()) {
                return None;
            }
            let oh: i64 = digits[0..2].parse().ok()?;
            let om: i64 = digits[2..4].parse().ok()?;
            if oh > 14 || om > 59 {
                return None;
            }
            sign * (oh * 60 + om)
        }
    };
    let secs = day * 86_400 + hh * 3600 + mm * 60 + ss - offset_min * 60;
    Some(secs * 1000 + frac_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_round_trip() {
        for day in [-719_468_i64, -1, 0, 1, 19_000, 20_744, 2_932_896] {
            let (y, m, d) = civil_from_days(day);
            assert_eq!(days_from_civil(y, m, d), day);
        }
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(day_to_string(days_from_civil(2026, 10, 18)), "2026-10-18");
    }

    #[test]
    fn parses_utc_offsets_and_sqlite_form() {
        let z = parse_timestamp_ms("2026-10-18T14:06:11.829Z").unwrap();
        assert_eq!(z % 1000, 829);
        assert_eq!(day_to_string(utc_day(z)), "2026-10-18");
        // Zone-less timestamps are UTC, not local time.
        let sqlite = parse_timestamp_ms("2026-10-18 03:11:27").unwrap();
        assert_eq!(sqlite, parse_timestamp_ms("2026-10-18T03:11:27Z").unwrap());
        // -04:00 is four hours behind UTC.
        let edt = parse_timestamp_ms("2026-10-17T23:30:00-04:00").unwrap();
        assert_eq!(day_to_string(utc_day(edt)), "2026-10-18");
        assert_eq!(parse_timestamp_ms("2026-10-18").unwrap() % MS_PER_DAY, 0);
    }

    #[test]
    fn rejects_malformed_input() {
        for bad in [
            "",
            "2026-13-01",
            "2026-02-30",
            "2026-10-18T25:00:00Z",
            "2026-10-18T10:00",
            "not a date",
            "2026-10-18T10:00:00+5",
        ] {
            assert!(parse_timestamp_ms(bad).is_none(), "accepted {bad:?}");
        }
        assert!(parse_day("2024-02-29").is_some());
        assert!(parse_day("2026-02-29").is_none());
    }
}
