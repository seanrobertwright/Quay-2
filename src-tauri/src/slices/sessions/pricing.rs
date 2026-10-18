//! Anthropic first-party list prices, used to turn Claude Code token usage into an
//! API-equivalent dollar estimate. Prices are USD per million tokens.
//!
//! Cache writes cost 1.25x the input rate for the 5-minute TTL and 2x for the 1-hour TTL.
//! Cache reads use the per-model rate below (0.1x input unless the model's price sheet says
//! otherwise).

/// Per-million-token rates for one model.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rates {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    /// Multiplier on every rate when the request ran in fast mode.
    pub fast_multiplier: f64,
}

impl Rates {
    const fn new(input: f64, output: f64, cache_read: f64) -> Self {
        Rates {
            input,
            output,
            cache_read,
            fast_multiplier: 1.0,
        }
    }

    const fn with_fast(mut self, multiplier: f64) -> Self {
        self.fast_multiplier = multiplier;
        self
    }
}

/// Token counts for one API response.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TokenUsage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write_5m: u64,
    pub cache_write_1h: u64,
    pub fast: bool,
}

impl TokenUsage {
    /// Tokens in the prompt: uncached input plus cache reads and writes.
    pub fn prompt_tokens(&self) -> u64 {
        self.input + self.cache_read + self.cache_write_5m + self.cache_write_1h
    }
}

/// Haiku 5.5 bills prompts above this many tokens at its long-prompt rates.
const HAIKU_5_5_TIER_TOKENS: u64 = 100_000;

/// Strips provider prefixes, the `claude-` prefix, date snapshots and `[1m]`-style
/// suffixes, so `us.anthropic.claude-opus-4-5-20251101[1m]` becomes `opus-4-5`.
fn normalize(model: &str) -> String {
    let mut m = model.trim().to_ascii_lowercase();
    if let Some(i) = m.find('[') {
        m.truncate(i);
    }
    if let Some(i) = m.rfind("claude-") {
        m = m[i + "claude-".len()..].to_string();
    }
    // Vertex snapshots use `@20251101`, first-party ids use `-20251101`.
    if let Some(i) = m.find('@') {
        m.truncate(i);
    }
    let parts: Vec<&str> = m.split('-').collect();
    let has_date_suffix = parts
        .last()
        .is_some_and(|l| l.len() == 8 && l.bytes().all(|c| c.is_ascii_digit()));
    if has_date_suffix {
        return parts[..parts.len() - 1].join("-");
    }
    m
}

/// List rates for `model`, or `None` for models that are not priced (non-Claude models
/// and placeholder entries such as `<synthetic>`). `prompt_tokens` selects the long-prompt
/// tier on models that have one.
pub fn rates_for(model: &str, prompt_tokens: u64) -> Option<Rates> {
    let m = normalize(model);
    // Ordered so that a more specific id ("opus-5-5") is tested before its prefix ("opus-5").
    let rates = if m.starts_with("fable-5-1") || m.starts_with("mythos-5-1") {
        Rates::new(10.0, 50.0, 0.25)
    } else if m.starts_with("fable-5") || m.starts_with("mythos-5") || m.starts_with("mythos") {
        Rates::new(10.0, 50.0, 1.00)
    } else if m.starts_with("opus-5-5") {
        Rates::new(4.0, 20.0, 0.20).with_fast(2.0)
    } else if m.starts_with("opus-5") {
        Rates::new(5.0, 25.0, 0.50).with_fast(2.0)
    } else if m.starts_with("opus-4-8")
        || m.starts_with("opus-4-7")
        || m.starts_with("opus-4-6")
        || m.starts_with("opus-4-5")
    {
        Rates::new(5.0, 25.0, 0.50)
    } else if m.starts_with("opus-4") || m.starts_with("3-opus") {
        Rates::new(15.0, 75.0, 1.50)
    } else if m.starts_with("sonnet-5") {
        Rates::new(2.0, 10.0, 0.20)
    } else if m.starts_with("sonnet-4")
        || m.starts_with("3-7-sonnet")
        || m.starts_with("3-5-sonnet")
    {
        Rates::new(3.0, 15.0, 0.30)
    } else if m.starts_with("haiku-5-5") {
        if prompt_tokens > HAIKU_5_5_TIER_TOKENS {
            Rates::new(0.50, 2.50, 0.05)
        } else {
            Rates::new(0.10, 0.50, 0.01)
        }
    } else if m.starts_with("haiku-4-5") {
        Rates::new(1.0, 5.0, 0.10)
    } else if m.starts_with("3-5-haiku") {
        Rates::new(0.80, 4.0, 0.08)
    } else if m.starts_with("3-haiku") {
        Rates::new(0.25, 1.25, 0.03)
    } else if m.starts_with("opus") {
        // An Opus id newer than this table: price it as the current Opus.
        Rates::new(4.0, 20.0, 0.20)
    } else if m.starts_with("sonnet") {
        Rates::new(2.0, 10.0, 0.20)
    } else if m.starts_with("haiku") {
        Rates::new(0.10, 0.50, 0.01)
    } else {
        return None;
    };
    Some(rates)
}

/// API-equivalent cost of one response in USD, or 0 for unpriced models.
pub fn cost_usd(model: &str, u: &TokenUsage) -> f64 {
    let Some(r) = rates_for(model, u.prompt_tokens()) else {
        return 0.0;
    };
    let per = |tokens: u64, rate: f64| tokens as f64 / 1_000_000.0 * rate;
    let base = per(u.input, r.input)
        + per(u.output, r.output)
        + per(u.cache_read, r.cache_read)
        + per(u.cache_write_5m, r.input * 1.25)
        + per(u.cache_write_1h, r.input * 2.0);
    if u.fast {
        base * r.fast_multiplier
    } else {
        base
    }
}

/// Cost of usage that was already summed over many responses (such as Claude Code's
/// legacy stats cache). Per-response prompt sizes are unknown, so long-prompt tiers are
/// not applied.
pub fn aggregate_cost_usd(model: &str, u: &TokenUsage) -> f64 {
    let Some(r) = rates_for(model, 0) else {
        return 0.0;
    };
    let per = |tokens: u64, rate: f64| tokens as f64 / 1_000_000.0 * rate;
    per(u.input, r.input)
        + per(u.output, r.output)
        + per(u.cache_read, r.cache_read)
        + per(u.cache_write_5m, r.input * 1.25)
        + per(u.cache_write_1h, r.input * 2.0)
}

/// What the cache reads in `u` saved compared with paying the full input rate.
pub fn cache_savings_usd(model: &str, u: &TokenUsage) -> f64 {
    let Some(r) = rates_for(model, u.prompt_tokens()) else {
        return 0.0;
    };
    let saved = u.cache_read as f64 / 1_000_000.0 * (r.input - r.cache_read);
    if u.fast {
        saved * r.fast_multiplier
    } else {
        saved
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_ids_from_every_surface() {
        assert_eq!(normalize("claude-opus-5-5"), "opus-5-5");
        assert_eq!(normalize("claude-opus-4-5-20251101"), "opus-4-5");
        assert_eq!(normalize("claude-sonnet-4-5-20250929"), "sonnet-4-5");
        assert_eq!(
            normalize("us.anthropic.claude-sonnet-4-6[1m]"),
            "sonnet-4-6"
        );
        assert_eq!(normalize("claude-opus-4-5@20251101"), "opus-4-5");
        assert_eq!(normalize("claude-3-7-sonnet-20250219"), "3-7-sonnet");
    }

    #[test]
    fn specific_ids_win_over_prefixes() {
        assert_eq!(rates_for("claude-opus-5-5", 0).unwrap().input, 4.0);
        assert_eq!(rates_for("claude-opus-5", 0).unwrap().input, 5.0);
        assert_eq!(rates_for("claude-fable-5-1", 0).unwrap().cache_read, 0.25);
        assert_eq!(rates_for("claude-fable-5", 0).unwrap().cache_read, 1.00);
        assert_eq!(
            rates_for("claude-opus-4-1-20250805", 0).unwrap().input,
            15.0
        );
        assert_eq!(rates_for("claude-opus-4-6", 0).unwrap().input, 5.0);
        assert_eq!(rates_for("claude-sonnet-5-5", 0).unwrap().output, 10.0);
        assert_eq!(
            rates_for("claude-haiku-4-5-20251001", 0).unwrap().input,
            1.0
        );
    }

    #[test]
    fn unpriced_models_cost_nothing() {
        assert!(rates_for("<synthetic>", 0).is_none());
        assert!(rates_for("kimi-k2.5:cloud", 0).is_none());
        assert_eq!(
            cost_usd(
                "<synthetic>",
                &TokenUsage {
                    output: 1_000_000,
                    ..Default::default()
                }
            ),
            0.0
        );
    }

    #[test]
    fn opus_5_5_cost_includes_cache_writes_and_reads() {
        let u = TokenUsage {
            input: 1_000_000,
            output: 1_000_000,
            cache_read: 1_000_000,
            cache_write_5m: 1_000_000,
            cache_write_1h: 1_000_000,
            fast: false,
        };
        // 4 + 20 + 0.20 + 5 (1.25x) + 8 (2x)
        assert!((cost_usd("claude-opus-5-5", &u) - 37.20).abs() < 1e-9);
        let fast = TokenUsage { fast: true, ..u };
        assert!((cost_usd("claude-opus-5-5", &fast) - 74.40).abs() < 1e-9);
        assert!((cache_savings_usd("claude-opus-5-5", &u) - 3.80).abs() < 1e-9);
    }

    #[test]
    fn haiku_5_5_switches_tier_above_100k_prompt_tokens() {
        let small = TokenUsage {
            input: 50_000,
            output: 1_000_000,
            ..Default::default()
        };
        let large = TokenUsage {
            input: 150_000,
            output: 1_000_000,
            ..Default::default()
        };
        assert!((cost_usd("claude-haiku-5-5", &small) - (0.005 + 0.50)).abs() < 1e-9);
        assert!((cost_usd("claude-haiku-5-5", &large) - (0.075 + 2.50)).abs() < 1e-9);
    }
}
