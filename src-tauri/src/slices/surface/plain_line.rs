//! Text Quay did not write, made fit for a line of Quay's own.

/// `written`, cut where it is longer than `most` characters, with a space for each character that has no
/// look of its own or turns the text around it.
pub fn plain_line(written: &str, most: usize) -> String {
    let unseen = |c: char| c.is_control() || matches!(c, '\u{200b}'..='\u{200f}' | '\u{2028}'..='\u{202e}' | '\u{2060}'..='\u{206f}' | '\u{feff}');
    let mut shown: String = written.chars().take(most).map(|c| if unseen(c) { ' ' } else { c }).collect();
    if written.chars().nth(most).is_some() {
        shown.push('…');
    }
    shown.trim().to_string()
}
