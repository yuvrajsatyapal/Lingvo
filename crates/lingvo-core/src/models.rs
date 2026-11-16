//! Model catalog, downloads and installation. This is the only code that touches the network.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::translate::{pair_dir, pair_installed};

const WHISPER_BASE_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const ARGOS_INDEX_URL: &str = "https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json";

#[derive(Debug, Clone)]
pub struct ModelPaths {
  pub root: PathBuf,
}

impl ModelPaths {
  pub fn new(root: PathBuf) -> Result<Self> {
    fs::create_dir_all(root.join("whisper"))?;
    fs::create_dir_all(root.join("translate"))?;
    Ok(Self { root })
  }

  pub fn whisper_dir(&self) -> PathBuf {
    self.root.join("whisper")
  }

  pub fn translate_dir(&self) -> PathBuf {
    self.root.join("translate")
  }

  pub fn whisper_file(&self, id: &str) -> Option<PathBuf> {
    whisper_catalog().iter().find(|m| m.id == id).map(|m| self.whisper_dir().join(m.file))
  }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModel {
  pub id: &'static str,
  pub name: &'static str,
  pub file: &'static str,
  pub size_mb: u32,
  pub note: &'static str,
  /// Whether the model can output English directly (the turbo model cannot).
  pub supports_translate: bool,
  pub installed: bool,
}

pub fn whisper_catalog() -> Vec<WhisperModel> {
  let m = |id, name, file, size_mb, note, supports_translate| WhisperModel {
    id,
    name,
    file,
    size_mb,
    note,
    supports_translate,
    installed: false,
  };
  vec![
    m("tiny", "Tiny", "ggml-tiny.bin", 75, "Fastest, least accurate", true),
    m("base", "Base", "ggml-base.bin", 142, "Good balance for most computers", true),
    m("small", "Small", "ggml-small-q5_1.bin", 181, "More accurate, slower", true),
    m("turbo", "Large v3 Turbo", "ggml-large-v3-turbo-q5_0.bin", 547, "Most accurate; needs a translation model", false),
  ]
}

pub fn list_whisper(paths: &ModelPaths) -> Vec<WhisperModel> {
  whisper_catalog()
    .into_iter()
    .map(|mut m| {
      m.installed = paths.whisper_dir().join(m.file).exists();
      m
    })
    .collect()
}

pub fn whisper_url(model: &WhisperModel) -> String {
  format!("{WHISPER_BASE_URL}/{}", model.file)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationPackage {
  #[serde(alias = "from_code")]
  pub from_code: String,
  #[serde(alias = "to_code")]
  pub to_code: String,
  #[serde(alias = "from_name")]
  pub from_name: String,
  #[serde(alias = "to_name")]
  pub to_name: String,
  #[serde(default)]
  pub links: Vec<String>,
  #[serde(default)]
  pub installed: bool,
}

/// Loads the Argos package index, refreshing the on-disk cache when the network is available.
pub async fn translation_index(paths: &ModelPaths, refresh: bool) -> Result<Vec<TranslationPackage>> {
  let cache = paths.root.join("argos-index.json");
  if refresh || !cache.exists() {
    match reqwest::get(ARGOS_INDEX_URL).await.and_then(|r| r.error_for_status()) {
      Ok(resp) => fs::write(&cache, resp.bytes().await?)?,
      Err(e) if !cache.exists() => bail!("could not fetch the translation model list: {e}"),
      Err(e) => eprintln!("[lingvo] could not refresh the translation model list, using the cached copy: {e}"),
    }
  }
  let mut packages: Vec<TranslationPackage> =
    serde_json::from_slice(&fs::read(&cache)?).context("reading the translation model list")?;
  let dir = paths.translate_dir();
  for p in &mut packages {
    p.installed = pair_installed(&dir, &p.from_code, &p.to_code);
  }
  packages.sort_by(|a, b| (&a.from_name, &a.to_name).cmp(&(&b.from_name, &b.to_name)));
  Ok(packages)
}

/// Streams `url` to `dest`, reporting (downloaded bytes, total bytes).
pub async fn download(url: &str, dest: &Path, mut progress: impl FnMut(u64, Option<u64>)) -> Result<()> {
  let resp = reqwest::get(url).await?.error_for_status()?;
  let total = resp.content_length();
  let part = dest.with_extension("part");
  let mut file = tokio::fs::File::create(&part).await?;
  let mut stream = resp.bytes_stream();
  let mut done = 0u64;
  while let Some(chunk) = stream.next().await {
    let chunk = chunk?;
    file.write_all(&chunk).await?;
    done += chunk.len() as u64;
    progress(done, total);
  }
  file.flush().await?;
  drop(file);
  tokio::fs::rename(&part, dest).await?;
  Ok(())
}

pub async fn install_whisper(paths: &ModelPaths, id: &str, progress: impl FnMut(u64, Option<u64>)) -> Result<()> {
  let model = whisper_catalog()
    .into_iter()
    .find(|m| m.id == id)
    .ok_or_else(|| anyhow!("unknown speech model: {id}"))?;
  download(&whisper_url(&model), &paths.whisper_dir().join(model.file), progress).await
}

pub async fn install_translation(
  paths: &ModelPaths,
  from: &str,
  to: &str,
  progress: impl FnMut(u64, Option<u64>),
) -> Result<()> {
  let index = translation_index(paths, false).await?;
  let package = index
    .iter()
    .find(|p| p.from_code == from && p.to_code == to)
    .ok_or_else(|| anyhow!("no translation model is published for {from} -> {to}"))?;
  let url = package.links.first().ok_or_else(|| anyhow!("translation model has no download link"))?;
  let archive = paths.root.join(format!("{from}_{to}.argosmodel"));
  download(url, &archive, progress).await?;
  let dest = pair_dir(&paths.translate_dir(), from, to);
  let result = tokio::task::spawn_blocking({
    let (archive, dest) = (archive.clone(), dest.clone());
    move || extract_argos(&archive, &dest)
  })
  .await?;
  let _ = fs::remove_file(&archive);
  if result.is_err() {
    let _ = fs::remove_dir_all(&dest);
  }
  result
}

/// Unpacks an .argosmodel zip, dropping its single top-level folder.
fn extract_argos(archive: &Path, dest: &Path) -> Result<()> {
  let mut zip = zip::ZipArchive::new(fs::File::open(archive)?)?;
  let _ = fs::remove_dir_all(dest);
  fs::create_dir_all(dest)?;
  for i in 0..zip.len() {
    let mut entry = zip.by_index(i)?;
    let Some(path) = entry.enclosed_name() else { continue };
    let relative: PathBuf = path.components().skip(1).collect();
    if relative.as_os_str().is_empty() || relative.starts_with("stanza") {
      continue;
    }
    let target = dest.join(relative);
    if entry.is_dir() {
      fs::create_dir_all(&target)?;
    } else {
      if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
      }
      io::copy(&mut entry, &mut fs::File::create(&target)?)?;
    }
  }
  let has_tokenizer = dest.join("sentencepiece.model").exists() || dest.join("bpe.model").exists();
  if !dest.join("model").join("model.bin").exists() || !has_tokenizer {
    bail!("this translation package uses a format Lingvo does not support yet");
  }
  Ok(())
}

pub fn delete_whisper(paths: &ModelPaths, id: &str) -> Result<()> {
  if let Some(file) = paths.whisper_file(id) {
    if file.exists() {
      fs::remove_file(file)?;
    }
  }
  Ok(())
}

pub fn delete_translation(paths: &ModelPaths, from: &str, to: &str) -> Result<()> {
  let dir = pair_dir(&paths.translate_dir(), from, to);
  if dir.exists() {
    fs::remove_dir_all(dir)?;
  }
  Ok(())
}
