//! A small, self-contained standard-cron evaluator (5 fields:
//! `minute hour day-of-month month day-of-week`).
//!
//! Why hand-rolled instead of a crate: the schedule string is the portability
//! artifact (the exact same expression a future external scheduler, trigger.dev,
//! Railway cron or GitHub Actions, consumes), so it MUST be plain standard cron,
//! and we only need two cheap operations on it (does it match *this* minute, and
//! what is the next minute it matches). Both are a few lines; a dependency would
//! buy nothing.
//!
//! Supported syntax per field: `*`, `a`, `a-b`, `*/n`, `a-b/n`, `a/n`, and
//! comma lists of those. Month accepts JAN..DEC and day-of-week accepts SUN..SAT
//! (case-insensitive); day-of-week accepts both 0 and 7 for Sunday. Day-of-month
//! and day-of-week follow Vixie semantics: when BOTH are restricted (not `*`) a
//! day matches if EITHER matches.

use chrono::{DateTime, Datelike, Duration, Local, Timelike};

const MONTHS: &[(&str, u32)] = &[
    ("jan", 1), ("feb", 2), ("mar", 3), ("apr", 4), ("may", 5), ("jun", 6),
    ("jul", 7), ("aug", 8), ("sep", 9), ("oct", 10), ("nov", 11), ("dec", 12),
];
const DOWS: &[(&str, u32)] = &[
    ("sun", 0), ("mon", 1), ("tue", 2), ("wed", 3), ("thu", 4), ("fri", 5), ("sat", 6),
];

/// A parsed cron expression. Each field is a presence bitmap indexed by value.
pub struct CronSchedule {
    minute: Vec<bool>, // 0..=59
    hour: Vec<bool>,   // 0..=23
    dom: Vec<bool>,    // 1..=31
    month: Vec<bool>,  // 1..=12
    dow: Vec<bool>,    // 0..=6 (Sunday = 0)
    dom_star: bool,
    dow_star: bool,
}

/// Parse a 5-field cron expression. Returns a human-readable error on bad input.
pub fn parse(expr: &str) -> Result<CronSchedule, String> {
    let fields: Vec<&str> = expr.split_whitespace().collect();
    if fields.len() != 5 {
        return Err(format!("expected 5 fields, got {}", fields.len()));
    }
    let (minute, _) = parse_field(fields[0], 0, 59, &[])?;
    let (hour, _) = parse_field(fields[1], 0, 23, &[])?;
    let (dom, dom_star) = parse_field(fields[2], 1, 31, &[])?;
    let (month, _) = parse_field(fields[3], 1, 12, MONTHS)?;

    // Day-of-week: parse with 0..=7, then fold Sunday-as-7 into Sunday-as-0.
    let (mut dow7, dow_star) = parse_field(fields[4], 0, 7, DOWS)?;
    if dow7[7] {
        dow7[0] = true;
    }
    dow7.truncate(7);

    Ok(CronSchedule {
        minute,
        hour,
        dom,
        month,
        dow: dow7,
        dom_star,
        dow_star,
    })
}

impl CronSchedule {
    /// Does this schedule fire at the given local wall-clock minute?
    pub fn matches(&self, dt: &DateTime<Local>) -> bool {
        let min = dt.minute() as usize;
        let hour = dt.hour() as usize;
        let dom = dt.day() as usize;
        let mon = dt.month() as usize;
        let dow = dt.weekday().num_days_from_sunday() as usize;

        if !self.minute[min] || !self.hour[hour] || !self.month[mon] {
            return false;
        }
        let dom_ok = self.dom[dom];
        let dow_ok = self.dow[dow];
        match (self.dom_star, self.dow_star) {
            (true, true) => true,
            (false, true) => dom_ok,
            (true, false) => dow_ok,
            (false, false) => dom_ok || dow_ok,
        }
    }

    /// The next local instant strictly after `after` at which this schedule
    /// fires, scanning minute by minute. Bounded at ~4 years so a never-matching
    /// expression (e.g. an impossible day/month combo) returns None instead of
    /// looping forever.
    pub fn next_after(&self, after: &DateTime<Local>) -> Option<DateTime<Local>> {
        let mut t = (*after + Duration::minutes(1))
            .with_second(0)
            .and_then(|t| t.with_nanosecond(0))?;
        for _ in 0..(4 * 366 * 24 * 60) {
            if self.matches(&t) {
                return Some(t);
            }
            t += Duration::minutes(1);
        }
        None
    }
}

/// Resolve a single token to a number, honoring case-insensitive names.
fn resolve(token: &str, names: &[(&str, u32)]) -> Result<u32, String> {
    let lower = token.to_ascii_lowercase();
    if let Some((_, v)) = names.iter().find(|(n, _)| *n == lower) {
        return Ok(*v);
    }
    token
        .parse::<u32>()
        .map_err(|_| format!("invalid value '{token}'"))
}

/// Parse one cron field into a presence bitmap (size `max + 1`) plus whether it
/// is the unrestricted `*`. `min`/`max` bound the field; `names` maps aliases.
fn parse_field(
    spec: &str,
    min: u32,
    max: u32,
    names: &[(&str, u32)],
) -> Result<(Vec<bool>, bool), String> {
    let spec = spec.trim();
    let is_star = spec == "*";
    let mut allowed = vec![false; (max + 1) as usize];

    for part in spec.split(',') {
        let part = part.trim();
        if part.is_empty() {
            return Err("empty field segment".into());
        }
        // Optional `/step`.
        let (range_part, step) = match part.split_once('/') {
            Some((r, s)) => {
                let st: u32 = s.parse().map_err(|_| format!("invalid step '{s}'"))?;
                if st == 0 {
                    return Err("step cannot be 0".into());
                }
                (r, st)
            }
            None => (part, 1),
        };

        let (lo, hi) = if range_part == "*" {
            (min, max)
        } else if let Some((a, b)) = range_part.split_once('-') {
            (resolve(a, names)?, resolve(b, names)?)
        } else {
            let v = resolve(range_part, names)?;
            // `a/n` (a bare start with a step) means a, a+n, ... up to max.
            if step > 1 { (v, max) } else { (v, v) }
        };

        if lo < min || hi > max || lo > hi {
            return Err(format!(
                "value out of range: {lo}-{hi} (allowed {min}-{max})"
            ));
        }
        let mut v = lo;
        while v <= hi {
            allowed[v as usize] = true;
            v += step;
        }
    }

    Ok((allowed, is_star))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(y, mo, d, h, mi, 0).single().unwrap()
    }

    #[test]
    fn every_minute() {
        let c = parse("* * * * *").unwrap();
        assert!(c.matches(&at(2026, 6, 9, 10, 16)));
    }

    #[test]
    fn daily_at_time() {
        let c = parse("16 10 * * *").unwrap();
        assert!(c.matches(&at(2026, 6, 9, 10, 16)));
        assert!(!c.matches(&at(2026, 6, 9, 10, 17)));
    }

    #[test]
    fn weekdays() {
        // 0 9 * * 1-5 (2026-06-08 is a Monday).
        let c = parse("0 9 * * 1-5").unwrap();
        assert!(c.matches(&at(2026, 6, 8, 9, 0)));
        assert!(!c.matches(&at(2026, 6, 13, 9, 0))); // Saturday
    }

    #[test]
    fn comma_lists() {
        let c = parse("1,15,30 * * * *").unwrap();
        assert!(c.matches(&at(2026, 6, 9, 10, 1)));
        assert!(c.matches(&at(2026, 6, 9, 10, 15)));
        assert!(c.matches(&at(2026, 6, 9, 10, 30)));
        assert!(!c.matches(&at(2026, 6, 9, 10, 16)));
        // Mixed list segments: range, step and a name.
        let m = parse("0 0 * JAN,MAR-APR,*/6 *").unwrap();
        assert!(m.matches(&at(2026, 1, 10, 0, 0)));
        assert!(m.matches(&at(2026, 3, 10, 0, 0)));
        assert!(m.matches(&at(2026, 4, 10, 0, 0)));
        assert!(m.matches(&at(2026, 7, 10, 0, 0))); // */6 from 1: 1,7
        assert!(!m.matches(&at(2026, 5, 10, 0, 0)));
    }

    #[test]
    fn vixie_dom_dow_or_rule() {
        // BOTH restricted: fire when EITHER matches. 2026-06-13 is a Saturday
        // (dom 13 matches), 2026-06-01 is a Monday (dow matches), 2026-06-09 is
        // a Tuesday the 9th (neither).
        let c = parse("0 9 13 * 1").unwrap();
        assert!(c.matches(&at(2026, 6, 13, 9, 0))); // dom matches, dow doesn't
        assert!(c.matches(&at(2026, 6, 1, 9, 0))); // dow matches, dom doesn't
        assert!(!c.matches(&at(2026, 6, 9, 9, 0))); // neither

        // Only dom restricted: dow is ignored.
        let d = parse("0 9 13 * *").unwrap();
        assert!(d.matches(&at(2026, 6, 13, 9, 0)));
        assert!(!d.matches(&at(2026, 6, 1, 9, 0)));

        // A step on dow counts as restricted (not a bare `*`).
        let s = parse("0 9 13 * */2").unwrap();
        // 2026-06-11 is a Thursday (dow 4, in */2) and not the 13th.
        assert!(s.matches(&at(2026, 6, 11, 9, 0)));
        assert!(s.matches(&at(2026, 6, 13, 9, 0)));
    }

    #[test]
    fn step_and_names() {
        let c = parse("*/15 * * * *").unwrap();
        assert!(c.matches(&at(2026, 6, 9, 10, 0)));
        assert!(c.matches(&at(2026, 6, 9, 10, 30)));
        assert!(!c.matches(&at(2026, 6, 9, 10, 7)));

        let n = parse("0 0 1 JAN *").unwrap();
        assert!(n.matches(&at(2026, 1, 1, 0, 0)));
        assert!(!n.matches(&at(2026, 2, 1, 0, 0)));
    }

    #[test]
    fn sunday_seven() {
        let c = parse("0 12 * * 7").unwrap();
        assert!(c.matches(&at(2026, 6, 14, 12, 0))); // Sunday
    }

    #[test]
    fn next_after_advances() {
        let c = parse("16 10 * * *").unwrap();
        let next = c.next_after(&at(2026, 6, 9, 10, 16)).unwrap();
        assert_eq!(next, at(2026, 6, 10, 10, 16));
    }

    #[test]
    fn rejects_bad() {
        assert!(parse("* * *").is_err());
        assert!(parse("99 * * * *").is_err());
        assert!(parse("* * * * 9").is_err());
    }
}
