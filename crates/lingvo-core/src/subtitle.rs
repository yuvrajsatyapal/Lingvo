//! Text clean-up: drops Whisper's known silence hallucinations, noise tags and repeats.

const HALLUCINATIONS: &[&str] = &[
  "thanks for watching",
  "thank you for watching",
  "thanks for watching!",
  "please subscribe",
  "subscribe to my channel",
  "subtitles by the amara.org community",
  "subtitles by",
  "transcribed by",
  "you",
  "thank you.",
  "bye.",
  ".",
];

/// Removes bracketed noise tags like [Music] or (applause) and tidies whitespace.
pub fn clean(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  let mut depth = 0u32;
  for c in text.chars() {
    match c {
      '[' | '(' => depth += 1,
      ']' | ')' => depth = depth.saturating_sub(1),
      '♪' => {}
      _ if depth == 0 => out.push(c),
      _ => {}
    }
  }
  out.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn is_hallucination(text: &str) -> bool {
  let t = text.trim().to_lowercase();
  if t.is_empty() || !t.chars().any(|c| c.is_alphanumeric()) {
    return true;
  }
  if HALLUCINATIONS.iter().any(|h| t == *h || t.trim_end_matches(['.', '!']) == *h) {
    return true;
  }
  const MARKERS: &[&str] = &[
    "thanks for watching",
    "thank you for watching",
    "subscribe to my channel",
    "please subscribe",
    "like and subscribe",
    "amara.org",
  ];
  if MARKERS.iter().any(|m| t.contains(m)) {
    return true;
  }
  // The same short phrase looping is a classic failure on music or noise.
  let words: Vec<&str> = t.split_whitespace().collect();
  if words.len() >= 8 {
    let unique: std::collections::HashSet<&str> = words.iter().copied().collect();
    if unique.len() * 4 <= words.len() {
      return true;
    }
  }
  false
}

/// Suppresses a final line identical to the previous one.
#[derive(Default)]
pub struct Dedupe {
  last: String,
}

impl Dedupe {
  pub fn is_repeat(&mut self, text: &str) -> bool {
    let norm = text.trim().to_lowercase();
    if norm == self.last {
      return true;
    }
    self.last = norm;
    false
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn strips_noise_tags() {
    assert_eq!(clean(" [Music]  Hola   amigos (risas) ♪ "), "Hola amigos");
  }

  #[test]
  fn flags_hallucinations() {
    assert!(is_hallucination("Thanks for watching!"));
    assert!(is_hallucination("Thank you for watching. If you enjoyed this video, please subscribe to my channel."));
    assert!(is_hallucination("  "));
    assert!(is_hallucination("..."));
    assert!(is_hallucination("la la la la la la la la la la la la"));
    assert!(!is_hallucination("Where is the train station?"));
  }

  #[test]
  fn dedupes_consecutive_lines() {
    let mut d = Dedupe::default();
    assert!(!d.is_repeat("Hello there"));
    assert!(d.is_repeat("hello there "));
    assert!(!d.is_repeat("Something else"));
  }
}
