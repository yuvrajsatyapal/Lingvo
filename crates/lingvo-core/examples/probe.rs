//! Headless checks: `probe file <wav> [target]`, `probe live [seconds] [target]`, `probe install <from> <to>`.
use std::time::{Duration, Instant};

use lingvo_core::asr::{AsrOptions, SpeechRecognizer, WhisperRecognizer};
use lingvo_core::models::{self, ModelPaths};
use lingvo_core::pipeline::Engine;
use lingvo_core::translate::{ArgosTranslator, Translator};
use lingvo_core::types::{PipelineEvent, Settings};

fn read_wav_16k_mono(path: &str) -> Vec<f32> {
  let bytes = std::fs::read(path).expect("read wav");
  let data = bytes.windows(4).position(|w| w == b"data").expect("data chunk") + 8;
  bytes[data..].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect()
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
  let args: Vec<String> = std::env::args().collect();
  let root = std::env::var("LINGVO_MODELS").expect("set LINGVO_MODELS");
  let paths = ModelPaths::new(root.into())?;
  match args.get(1).map(String::as_str) {
    Some("install") => {
      if args[2] == "whisper" {
        models::install_whisper(&paths, &args[3], |_, _| {}).await?;
      } else {
        models::install_translation(&paths, &args[2], &args[3], |_, _| {}).await?;
      }
      println!("installed");
    }
    Some("file") => {
      let audio = read_wav_16k_mono(&args[2]);
      let target = args.get(3).cloned().unwrap_or("en".into());
      let mut rec = WhisperRecognizer::load(&paths.whisper_file("base").unwrap(), true)?;
      for translate in [false, true] {
        let t = Instant::now();
        let out = rec.transcribe(&audio, &AsrOptions { language: None, translate_to_english: translate, beam_size: None })?;
        println!("whisper translate={translate} {:?} lang={:?} no_speech={:.2} -> {}", t.elapsed(), out.language, out.no_speech_prob, out.text);
        if !translate {
          let mut tr = ArgosTranslator::new(paths.translate_dir());
          let t = Instant::now();
          match tr.translate(&out.text, out.language.as_deref().unwrap_or("en"), &target, false) {
            Ok(s) => println!("argos first {:?} -> {s}", t.elapsed()),
            Err(e) => println!("argos: {e}"),
          }
          let t = Instant::now();
          if let Ok(s) = tr.translate(&out.text, out.language.as_deref().unwrap_or("en"), &target, false) {
            println!("argos warm {:?} -> {s}", t.elapsed());
          }
        }
      }
    }
    Some("bench") => {
      // Times one recognition pass on the first N seconds of a wav: `probe bench <wav> [model]`.
      let audio = read_wav_16k_mono(&args[2]);
      let model = args.get(3).map(String::as_str).unwrap_or("base");
      let mut rec = WhisperRecognizer::load(&paths.whisper_file(model).expect("model not installed"), true)?;
      for secs in [1usize, 2, 4, 6, 8, 10] {
        let clip = &audio[..(secs * 16_000).min(audio.len())];
        for (label, translate, beam) in [("greedy", false, None), ("greedy+translate", true, None), ("beam5", false, Some(5))] {
          let opts = AsrOptions { language: None, translate_to_english: translate, beam_size: beam };
          let runs: Vec<_> = (0..3)
            .map(|_| {
              let t = Instant::now();
              rec.transcribe(clip, &opts).expect("transcribe");
              t.elapsed().as_millis()
            })
            .collect();
          println!("{model} {secs:>2}s {label:<17} {runs:?} ms");
        }
      }
    }
    Some("text") => {
      let tools = lingvo_core::tools::Tools::spawn(paths)?;
      let t = Instant::now();
      println!("{:?} {:?}", tools.translate_text(args[4].clone(), args[2].clone(), args[3].clone()).map(|r| r.translated), t.elapsed());
    }
    Some("audio") => {
      let tools = lingvo_core::tools::Tools::spawn(paths)?;
      let t = Instant::now();
      println!("{:?} {:?}", tools.translate_audio(read_wav_16k_mono(&args[2]), "base".into(), args[3].clone()), t.elapsed());
    }
    Some("voice") => println!("{:?}", {
      let out = std::process::Command::new("say").args(["-v", "?"]).output()?;
      lingvo_core::speech::pick_voice(&String::from_utf8_lossy(&out.stdout), &args[2])
    }),
    Some("stream") => {
      // Feeds a wav through the live pipeline in real time and prints when each line appears.
      let audio = read_wav_16k_mono(&args[2]);
      let mut settings = Settings::default();
      if let Some(t) = args.get(3) {
        settings.target_lang = t.clone();
        settings.english_via_whisper = t == "en";
      }
      if let Some(m) = args.get(4) {
        settings.whisper_model = m.clone();
      }
      let (tx, rx) = std::sync::mpsc::channel();
      let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
      let started = std::sync::Arc::new(std::sync::Mutex::new(None::<Instant>));
      let (flag, clock) = (stop.clone(), started.clone());
      let worker = std::thread::spawn(move || {
        lingvo_core::pipeline::run_stream(&settings, &paths, rx, &flag, &|e| {
          let at = clock.lock().unwrap().map(|t| t.elapsed().as_secs_f32()).unwrap_or(0.0);
          match e {
            PipelineEvent::Subtitle(s) => println!("{at:5.1}s {} #{} {}", if s.is_final { "FINAL  " } else { "partial" }, s.id, s.text),
            PipelineEvent::Status { state, message, .. } => {
              if at == 0.0 && matches!(state, lingvo_core::types::EngineState::Listening) {
                *clock.lock().unwrap() = Some(Instant::now());
              }
              if let Some(m) = message {
                println!("{at:5.1}s STATUS {m}");
              }
            }
            _ => {}
          }
        })
      });
      while started.lock().unwrap().is_none() {
        std::thread::sleep(Duration::from_millis(20));
      }
      let begun = Instant::now();
      for (i, chunk) in audio.chunks(320).enumerate() {
        tx.send(chunk.to_vec())?;
        // Keep to real time without drifting.
        let due = Duration::from_millis(20 * (i as u64 + 1));
        std::thread::sleep(due.saturating_sub(begun.elapsed()));
      }
      println!("-- audio ended at {:.1}s", audio.len() as f32 / 16000.0);
      std::thread::sleep(Duration::from_secs(3));
      stop.store(true, std::sync::atomic::Ordering::Relaxed);
      let _ = worker.join();
    }
    Some("live") => {
      let secs: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(15);
      let mut settings = Settings::default();
      settings.save_history = false;
      if let Some(t) = args.get(3) {
        settings.target_lang = t.clone();
        settings.english_via_whisper = false;
      }
      let peak = std::sync::Mutex::new(0.0f32);
      let mut engine = Engine::start(settings, paths, move |e| match e {
        PipelineEvent::Level { value } => {
          let mut peak = peak.lock().unwrap();
          if value > *peak {
            *peak = value;
            println!("level peak {value:.3}");
          }
        }
        other => println!("{other:?}"),
      })?;
      std::thread::sleep(Duration::from_secs(secs));
      engine.stop();
    }
    _ => eprintln!("usage: probe file|live|install"),
  }
  Ok(())
}
