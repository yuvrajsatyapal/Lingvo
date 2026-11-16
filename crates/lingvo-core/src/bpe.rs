//! Moses-style tokenization plus subword-nmt BPE, the scheme used by OPUS-MT based Argos packages.

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result};

pub struct BpeTokenizer {
  ranks: HashMap<(String, String), usize>,
  cache: RefCell<HashMap<String, Vec<String>>>,
  source_lang: String,
}

impl BpeTokenizer {
  pub fn open(codes: &Path, source_lang: &str) -> Result<Self> {
    let text = std::fs::read_to_string(codes).context("reading BPE codes")?;
    Ok(Self::from_codes(&text, source_lang))
  }

  pub fn from_codes(codes: &str, source_lang: &str) -> Self {
    let mut ranks = HashMap::new();
    for line in codes.lines().filter(|l| !l.starts_with("#version")) {
      if let Some((a, b)) = line.split_once(' ') {
        let next = ranks.len();
        ranks.entry((a.to_string(), b.to_string())).or_insert(next);
      }
    }
    Self { ranks, cache: RefCell::new(HashMap::new()), source_lang: source_lang.to_string() }
  }

  fn bpe_word(&self, word: &str) -> Vec<String> {
    if let Some(hit) = self.cache.borrow().get(word) {
      return hit.clone();
    }
    let mut parts: Vec<String> = word.chars().map(|c| c.to_string()).collect();
    if let Some(last) = parts.last_mut() {
      last.push_str("</w>");
    }
    while parts.len() > 1 {
      let best = (0..parts.len() - 1)
        .filter_map(|i| self.ranks.get(&(parts[i].clone(), parts[i + 1].clone())).map(|r| (*r, i)))
        .min();
      let Some((rank, _)) = best else { break };
      let mut merged = Vec::with_capacity(parts.len());
      let mut i = 0;
      while i < parts.len() {
        if i + 1 < parts.len() && self.ranks.get(&(parts[i].clone(), parts[i + 1].clone())) == Some(&rank) {
          merged.push(format!("{}{}", parts[i], parts[i + 1]));
          i += 2;
        } else {
          merged.push(parts[i].clone());
          i += 1;
        }
      }
      parts = merged;
    }
    let n = parts.len();
    let out: Vec<String> = parts
      .into_iter()
      .enumerate()
      .map(|(i, p)| if i + 1 < n { format!("{p}@@") } else { p.trim_end_matches("</w>").to_string() })
      .collect();
    self.cache.borrow_mut().insert(word.to_string(), out.clone());
    out
  }

  pub fn encode(&self, text: &str) -> Vec<String> {
    moses_tokenize(text, &self.source_lang).iter().flat_map(|w| self.bpe_word(w)).collect()
  }

  pub fn decode(&self, tokens: &[String]) -> String {
    let joined = tokens.join(" ").replace("@@ ", "");
    moses_detokenize(joined.trim_end_matches("@@"))
  }
}

fn escape(c: char) -> Option<&'static str> {
  Some(match c {
    '&' => "&amp;",
    '|' => "&#124;",
    '<' => "&lt;",
    '>' => "&gt;",
    '\'' | '’' => "&apos;",
    '"' | '“' | '”' => "&quot;",
    '[' => "&#91;",
    ']' => "&#93;",
    _ => return None,
  })
}

/// A simplified Moses tokenizer: splits punctuation, aggressive hyphen splitting, entity escaping.
pub fn moses_tokenize(text: &str, lang: &str) -> Vec<String> {
  let chars: Vec<char> = text.chars().collect();
  let mut tokens: Vec<String> = Vec::new();
  let mut cur = String::new();
  let flush = |cur: &mut String, tokens: &mut Vec<String>| {
    if !cur.is_empty() {
      tokens.push(std::mem::take(cur));
    }
  };
  let alnum = |i: usize| chars.get(i).is_some_and(|c| c.is_alphanumeric());
  let digit = |i: usize| chars.get(i).is_some_and(|c| c.is_ascii_digit());

  for (i, &c) in chars.iter().enumerate() {
    let prev_alnum = i > 0 && alnum(i - 1);
    if c.is_alphanumeric() {
      cur.push(c);
    } else if c.is_whitespace() {
      flush(&mut cur, &mut tokens);
    } else if (c == '.' || c == ',') && i > 0 && digit(i - 1) && digit(i + 1) {
      cur.push(c);
    } else if c == '.' && prev_alnum && alnum(i + 1) {
      cur.push(c);
    } else if c == '-' && prev_alnum && alnum(i + 1) {
      flush(&mut cur, &mut tokens);
      tokens.push("@-@".into());
    } else if (c == '\'' || c == '’') && prev_alnum && alnum(i + 1) {
      if lang == "en" {
        // don't -> don 't
        flush(&mut cur, &mut tokens);
        cur.push_str("&apos;");
      } else {
        // l'ami -> l' ami
        cur.push_str("&apos;");
        flush(&mut cur, &mut tokens);
      }
    } else {
      flush(&mut cur, &mut tokens);
      match escape(c) {
        Some(e) => tokens.push(e.into()),
        None => tokens.push(c.to_string()),
      }
    }
  }
  flush(&mut cur, &mut tokens);
  tokens
}

pub fn moses_detokenize(text: &str) -> String {
  let unescaped = text
    .replace(" @-@ ", "-")
    .replace("&quot;", "\"")
    .replace("&apos;", "'")
    .replace("&#124;", "|")
    .replace("&lt;", "<")
    .replace("&gt;", ">")
    .replace("&#91;", "[")
    .replace("&#93;", "]")
    .replace("&amp;", "&");

  let mut out = String::with_capacity(unescaped.len());
  let mut open_quote = false;
  let mut glue_next = false;
  for tok in unescaped.split_whitespace() {
    let first = tok.chars().next().unwrap_or(' ');
    let closing = matches!(first, ',' | '.' | '!' | '?' | ':' | ';' | ')' | ']' | '%' | '»') && tok.chars().count() <= 3;
    let contraction = tok.starts_with('\'') && tok.len() > 1 && tok.len() <= 4;
    let is_quote = tok == "\"";
    let attach_left = closing || contraction || (is_quote && open_quote) || tok == "'";
    if !out.is_empty() && !glue_next && !attach_left {
      out.push(' ');
    }
    out.push_str(tok);
    glue_next = matches!(tok, "(" | "[" | "¿" | "¡" | "«")
      || (is_quote && !open_quote)
      || (tok.ends_with('\'') && tok.chars().count() <= 3 && tok != "'");
    if is_quote {
      open_quote = !open_quote;
    }
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn tokenizes_like_moses() {
    assert_eq!(
      moses_tokenize("¿Dónde está la estación, amigo?", "es"),
      vec!["¿", "Dónde", "está", "la", "estación", ",", "amigo", "?"]
    );
    assert_eq!(moses_tokenize("I don't know.", "en"), vec!["I", "don", "&apos;t", "know", "."]);
    assert_eq!(moses_tokenize("l'ami bien-aimé", "fr"), vec!["l&apos;", "ami", "bien", "@-@", "aimé"]);
    assert_eq!(moses_tokenize("It costs 3.5 euros", "en"), vec!["It", "costs", "3.5", "euros"]);
  }

  #[test]
  fn applies_merges_in_priority_order() {
    let t = BpeTokenizer::from_codes("#version: 0.2\nl o\nlo w</w>\ne r</w>", "en");
    assert_eq!(t.encode("low lower"), vec!["low", "lo@@", "w@@", "er"]);
  }

  #[test]
  fn detokenizes() {
    let toks: Vec<String> = "Where is the train sta@@ tion , my well @-@ known friend ? I don &apos;t know ."
      .split(' ')
      .map(String::from)
      .collect();
    let t = BpeTokenizer::from_codes("", "en");
    assert_eq!(t.decode(&toks), "Where is the train station, my well-known friend? I don't know.");
    assert_eq!(moses_detokenize("He said &quot; hello &quot; ( twice )"), "He said \"hello\" (twice)");
    assert_eq!(moses_detokenize("l&apos; ami est là"), "l'ami est là");
  }
}
