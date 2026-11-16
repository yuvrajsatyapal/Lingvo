//! Offline translation behind a trait. The implementation runs Argos Translate model packages
//! (CTranslate2 + SentencePiece) directly from Rust, pivoting through English when needed.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use ct2rs::{Config, TranslationOptions, Translator as Ct2Translator};
use sentencepiece::SentencePieceProcessor;

use crate::bpe::BpeTokenizer;

pub trait Translator {
  /// Translates `text`. Returns `MissingModel` (via `missing_pairs`) when a package is absent.
  /// `draft` trades a little quality for speed, for provisional text that will be replaced.
  fn translate(&mut self, text: &str, from: &str, to: &str, draft: bool) -> Result<String>;
  /// The language pairs that would have to be installed for `from -> to` to work.
  fn missing_pairs(&self, from: &str, to: &str) -> Vec<(String, String)>;
}

/// Whisper and Argos mostly share ISO 639-1 codes; these are the exceptions.
pub fn normalize_lang(code: &str) -> &str {
  match code {
    "no" | "nn" => "nb",
    "jw" => "jv",
    "iw" => "he",
    other => other,
  }
}

/// Argos packages ship either a SentencePiece model or BPE codes; both are supported.
enum PackageTokenizer {
  SentencePiece(SentencePieceProcessor),
  Bpe(BpeTokenizer),
}

impl PackageTokenizer {
  fn open(dir: &Path, from: &str) -> Result<Self> {
    let sp = dir.join("sentencepiece.model");
    if sp.exists() {
      return Ok(Self::SentencePiece(SentencePieceProcessor::open(sp)?));
    }
    Ok(Self::Bpe(BpeTokenizer::open(&dir.join("bpe.model"), from)?))
  }
}

impl ct2rs::Tokenizer for PackageTokenizer {
  fn encode(&self, input: &str) -> Result<Vec<String>> {
    Ok(match self {
      Self::SentencePiece(sp) => sp.encode(input)?.into_iter().map(|p| p.piece).collect(),
      Self::Bpe(bpe) => bpe.encode(input),
    })
  }

  fn decode(&self, tokens: Vec<String>) -> Result<String> {
    Ok(match self {
      // Pieces mark word starts with U+2581; joining and swapping it for a space detokenizes.
      Self::SentencePiece(_) => tokens.concat().replace('\u{2581}', " ").trim().to_string(),
      Self::Bpe(bpe) => bpe.decode(&tokens),
    })
  }
}

fn threads() -> usize {
  std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 4)
}

pub fn pair_dir(root: &Path, from: &str, to: &str) -> PathBuf {
  root.join(format!("{from}_{to}"))
}

pub fn pair_installed(root: &Path, from: &str, to: &str) -> bool {
  let dir = pair_dir(root, from, to);
  dir.join("model").join("model.bin").exists()
    && (dir.join("sentencepiece.model").exists() || dir.join("bpe.model").exists())
}

pub struct ArgosTranslator {
  root: PathBuf,
  loaded: HashMap<(String, String), Ct2Translator<PackageTokenizer>>,
}

impl ArgosTranslator {
  pub fn new(root: PathBuf) -> Self {
    Self { root, loaded: HashMap::new() }
  }

  fn route(&self, from: &str, to: &str) -> Option<Vec<(String, String)>> {
    if pair_installed(&self.root, from, to) {
      return Some(vec![(from.into(), to.into())]);
    }
    if from != "en" && to != "en" && pair_installed(&self.root, from, "en") && pair_installed(&self.root, "en", to) {
      return Some(vec![(from.into(), "en".into()), ("en".into(), to.into())]);
    }
    None
  }

  fn run_pair(&mut self, text: &str, from: &str, to: &str, draft: bool) -> Result<String> {
    let key = (from.to_string(), to.to_string());
    if !self.loaded.contains_key(&key) {
      let dir = pair_dir(&self.root, from, to);
      let tokenizer = PackageTokenizer::open(&dir, from)
        .map_err(|e| anyhow!("could not load the {from}->{to} tokenizer: {e}"))?;
      let translator = Ct2Translator::with_tokenizer(dir.join("model"), tokenizer, &Config { num_threads_per_replica: threads(), ..Config::default() })
        .map_err(|e| anyhow!("could not load the {from}->{to} translation model: {e}"))?;
      self.loaded.insert(key.clone(), translator);
    }
    let translator = &self.loaded[&key];
    let sentences = split_sentences(text);
    let options = TranslationOptions::<String, String> { beam_size: if draft { 1 } else { 2 }, ..Default::default() };
    let results = translator.translate_batch(&sentences, &options, None)?;
    Ok(results.into_iter().map(|(t, _)| t.trim().to_string()).collect::<Vec<_>>().join(" "))
  }
}

impl Translator for ArgosTranslator {
  fn translate(&mut self, text: &str, from: &str, to: &str, draft: bool) -> Result<String> {
    let (from, to) = (normalize_lang(from), normalize_lang(to));
    if from == to || text.trim().is_empty() {
      return Ok(text.to_string());
    }
    let route = self
      .route(from, to)
      .ok_or_else(|| anyhow!("no translation model installed for {from} -> {to}"))?;
    let mut current = text.to_string();
    for (a, b) in route {
      current = self.run_pair(&current, &a, &b, draft)?;
    }
    Ok(current)
  }

  fn missing_pairs(&self, from: &str, to: &str) -> Vec<(String, String)> {
    let (from, to) = (normalize_lang(from), normalize_lang(to));
    if from == to || self.route(from, to).is_some() {
      return Vec::new();
    }
    if from == "en" || to == "en" {
      return vec![(from.into(), to.into())];
    }
    [(from, "en"), ("en", to)]
      .into_iter()
      .filter(|(a, b)| !pair_installed(&self.root, a, b))
      .map(|(a, b)| (a.to_string(), b.to_string()))
      .collect()
  }
}

/// Splits on sentence-ending punctuation so each sentence is translated on its own.
pub fn split_sentences(text: &str) -> Vec<String> {
  let mut out = Vec::new();
  let mut cur = String::new();
  let mut chars = text.chars().peekable();
  while let Some(c) = chars.next() {
    cur.push(c);
    let ends = matches!(c, '.' | '!' | '?' | '。' | '！' | '？' | '…');
    let boundary = chars.peek().map_or(true, |n| n.is_whitespace()) || matches!(c, '。' | '！' | '？');
    if ends && boundary {
      let s = cur.trim();
      if !s.is_empty() {
        out.push(s.to_string());
      }
      cur.clear();
    }
  }
  let s = cur.trim();
  if !s.is_empty() {
    out.push(s.to_string());
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn splits_sentences() {
    assert_eq!(
      split_sentences("Hola. ¿Dónde está la estación? Vale 3.5 euros"),
      vec!["Hola.", "¿Dónde está la estación?", "Vale 3.5 euros"]
    );
    assert_eq!(split_sentences("  "), Vec::<String>::new());
  }

  #[test]
  fn reports_missing_pairs() {
    let t = ArgosTranslator::new(PathBuf::from("/nonexistent"));
    assert_eq!(t.missing_pairs("es", "en"), vec![("es".to_string(), "en".to_string())]);
    assert_eq!(t.missing_pairs("es", "fr").len(), 2);
    assert!(t.missing_pairs("en", "en").is_empty());
    assert_eq!(normalize_lang("no"), "nb");
  }
}
