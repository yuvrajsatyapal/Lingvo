//! Audio capture behind a common interface. The macOS/Windows/Linux differences live in cpal:
//! on macOS 14.6+ opening an input stream on an *output* device records what the system plays.

pub mod resample;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use serde::Serialize;

use crate::SAMPLE_RATE;
use resample::Resampler;

pub const SYSTEM_SOURCE: &str = "system";
pub const DEFAULT_INPUT: &str = "default-input";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSourceInfo {
  pub id: String,
  pub name: String,
  pub is_system: bool,
}

/// A running capture that delivers 16 kHz mono chunks until dropped.
pub trait AudioCapture: Send {
  fn stop(&mut self);
}

pub fn list_sources() -> Vec<AudioSourceInfo> {
  let host = cpal::default_host();
  let mut sources = vec![AudioSourceInfo {
    id: SYSTEM_SOURCE.into(),
    name: "System audio (everything playing)".into(),
    is_system: true,
  }];
  if let Ok(devices) = host.input_devices() {
    for device in devices {
      let (Ok(id), Ok(desc)) = (device.id(), device.description()) else {
        continue;
      };
      sources.push(AudioSourceInfo {
        id: format!("input:{id}"),
        name: desc.name().to_string(),
        is_system: false,
      });
    }
  }
  sources
}

pub struct CpalCapture {
  stop: Arc<AtomicBool>,
  thread: Option<JoinHandle<()>>,
}

impl CpalCapture {
  /// Starts capturing `source_id` and sends 16 kHz mono chunks to `sink`.
  pub fn start(source_id: &str, sink: Sender<Vec<f32>>) -> Result<Self> {
    Self::start_with(source_id, sink, false)
  }

  /// `mute_original` silences the captured system audio on the speakers (used when dubbing).
  pub fn start_with(source_id: &str, sink: Sender<Vec<f32>>, mute_original: bool) -> Result<Self> {
    // Lingvo's own spoken output must never be recorded, or it would translate itself.
    #[cfg(target_os = "macos")]
    {
      cpal::loopback_options::set_exclude_own_process(true);
      cpal::loopback_options::set_mute_tapped(mute_original && source_id == SYSTEM_SOURCE);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = mute_original;
    let stop = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = mpsc::channel::<Result<()>>();
    let source_id = source_id.to_string();
    let stop_flag = stop.clone();

    // cpal streams are not Send on macOS, so the stream lives and dies on this thread.
    let thread = thread::Builder::new()
      .name("lingvo-capture".into())
      .spawn(move || match build_stream(&source_id, sink) {
        Ok(stream) => {
          let _ = ready_tx.send(Ok(()));
          while !stop_flag.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(50));
          }
          drop(stream);
        }
        Err(e) => {
          let _ = ready_tx.send(Err(e));
        }
      })?;

    ready_rx
      .recv_timeout(Duration::from_secs(10))
      .map_err(|_| anyhow!("audio capture did not start in time"))??;
    Ok(Self { stop, thread: Some(thread) })
  }
}

impl AudioCapture for CpalCapture {
  fn stop(&mut self) {
    self.stop.store(true, Ordering::Relaxed);
    if let Some(t) = self.thread.take() {
      let _ = t.join();
    }
  }
}

impl Drop for CpalCapture {
  fn drop(&mut self) {
    self.stop();
  }
}

fn build_stream(source_id: &str, sink: Sender<Vec<f32>>) -> Result<cpal::Stream> {
  let host = cpal::default_host();
  let (device, config) = if source_id == SYSTEM_SOURCE {
    let device = host
      .default_output_device()
      .ok_or_else(|| anyhow!("no audio output device found"))?;
    let config = device.default_output_config().context("reading output format")?;
    (device, config)
  } else if source_id == DEFAULT_INPUT {
    let device = host
      .default_input_device()
      .ok_or_else(|| anyhow!("no microphone found"))?;
    let config = device.default_input_config().context("reading input format")?;
    (device, config)
  } else {
    let wanted = source_id.strip_prefix("input:").unwrap_or(source_id);
    let device = host
      .input_devices()?
      .find(|d| d.id().map(|id| id.to_string() == wanted).unwrap_or(false))
      .ok_or_else(|| anyhow!("audio source is no longer available"))?;
    let config = device.default_input_config().context("reading input format")?;
    (device, config)
  };

  let channels = config.channels() as usize;
  let format = config.sample_format();
  let mut resampler = Resampler::new(config.sample_rate(), SAMPLE_RATE);
  let mut mono: Vec<f32> = Vec::new();

  let mut deliver = move |interleaved: &mut dyn Iterator<Item = f32>| {
    mono.clear();
    let mut acc = 0.0f32;
    let mut n = 0usize;
    for s in interleaved {
      acc += s;
      n += 1;
      if n == channels {
        mono.push(acc / channels as f32);
        acc = 0.0;
        n = 0;
      }
    }
    let mut out = Vec::with_capacity(mono.len() / 2 + 8);
    resampler.process(&mono, &mut out);
    if !out.is_empty() {
      let _ = sink.send(out);
    }
  };
  let on_error = |e: cpal::Error| eprintln!("[lingvo] audio stream error: {e}");

  let stream = match format {
    SampleFormat::F32 => device.build_input_stream(
      config.into(),
      move |data: &[f32], _: &_| deliver(&mut data.iter().copied()),
      on_error,
      None,
    ),
    SampleFormat::I16 => device.build_input_stream(
      config.into(),
      move |data: &[i16], _: &_| deliver(&mut data.iter().map(|s| *s as f32 / 32768.0)),
      on_error,
      None,
    ),
    SampleFormat::I32 => device.build_input_stream(
      config.into(),
      move |data: &[i32], _: &_| deliver(&mut data.iter().map(|s| *s as f32 / 2147483648.0)),
      on_error,
      None,
    ),
    other => return Err(anyhow!("unsupported audio sample format: {other:?}")),
  }
  .map_err(|e| anyhow!("could not open the audio source: {e}"))?;

  stream.play().map_err(|e| anyhow!("could not start the audio source: {e}"))?;
  Ok(stream)
}
