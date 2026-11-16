//! Desktop shell. The processing pipeline lives in `lingvo-core`; this file wires it to the
//! control window and the subtitle overlay.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use lingvo_core::audio::{self, AudioCapture, AudioSourceInfo, CpalCapture};
use lingvo_core::models::{self, ModelPaths, TranslationPackage, WhisperModel};
use lingvo_core::pipeline::Engine;
use lingvo_core::speech::Speaker;
use lingvo_core::store::{HistoryEntry, SessionSummary, Store};
use lingvo_core::tools::{Tools, Translation};
use lingvo_core::types::{EngineState, PipelineEvent, Settings};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const OVERLAY: &str = "overlay";
const OVERLAY_BOUNDS_KEY: &str = "overlay_bounds";

struct AppState {
  store: Store,
  paths: ModelPaths,
  engine: Mutex<Option<Engine>>,
  status: Mutex<StatusPayload>,
  overlay_edit: AtomicBool,
  bounds_saved: Mutex<Instant>,
  session: Mutex<Option<i64>>,
  tools: Mutex<Option<Tools>>,
  speaker: Mutex<Option<Speaker>>,
  recording: Mutex<Option<Recording>>,
}

/// A microphone clip being recorded for the Translator tab.
struct Recording {
  capture: CpalCapture,
  audio: Receiver<Vec<f32>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusPayload {
  state: EngineState,
  message: Option<String>,
  detected_lang: Option<String>,
  running: bool,
  session_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadEvent {
  key: String,
  done: u64,
  total: Option<u64>,
  status: &'static str,
  error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelList {
  whisper: Vec<WhisperModel>,
  translation: Vec<TranslationPackage>,
  translation_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Bounds {
  x: i32,
  y: i32,
  w: u32,
  h: u32,
}

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
  e.to_string()
}

fn set_status(app: &AppHandle, state: EngineState, message: Option<String>, detected_lang: Option<String>) {
  let app_state = app.state::<AppState>();
  let running = matches!(
    state,
    EngineState::Loading | EngineState::Listening | EngineState::Recognizing | EngineState::Translating
  );
  let session_id = *app_state.session.lock().unwrap();
  let payload = StatusPayload { state, message, detected_lang, running, session_id };
  *app_state.status.lock().unwrap() = payload.clone();
  let _ = app.emit("status", payload);
}

fn start_engine(app: &AppHandle) -> CmdResult<()> {
  let state = app.state::<AppState>();
  let settings = state.store.load_settings();
  let mut slot = state.engine.lock().unwrap();
  if let Some(mut old) = slot.take() {
    old.stop();
  }
  let handle = app.clone();
  let target = settings.target_lang.clone();
  let speak_aloud = settings.speak_translation;
  let transcript_mode = settings.output_mode == "transcript";
  let save_history = settings.save_history || transcript_mode;
  let session = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
  *state.session.lock().unwrap() = Some(session);
  let engine = Engine::start(settings, state.paths.clone(), move |event| match event {
    PipelineEvent::Status { state, message, detected_lang } => {
      set_status(&handle, state, message, detected_lang);
    }
    PipelineEvent::Subtitle(sub) => {
      if sub.is_final && save_history {
        let store = &handle.state::<AppState>().store;
        if let Err(e) = store.add_history(Some(session), sub.source_lang.as_deref(), &target, sub.original.as_deref(), &sub.text) {
          eprintln!("[lingvo] could not save a transcript line: {e:#}");
          set_status(&handle, EngineState::Listening, Some(format!("Could not save the transcript: {e}")), None);
        }
      }
      if sub.is_final && speak_aloud {
        if let Some(speaker) = handle.state::<AppState>().speaker.lock().unwrap().as_ref() {
          if let Err(e) = speaker.speak(&sub.text, &target) {
            eprintln!("[lingvo] could not speak the translation: {e:#}");
          }
        }
      }
      let _ = handle.emit("subtitle", sub);
    }
    PipelineEvent::Level { value } => {
      let _ = handle.emit("level", value);
    }
  })
  .map_err(err)?;
  *slot = Some(engine);
  if let Some(overlay) = app.get_webview_window(OVERLAY) {
    let _ = if transcript_mode { overlay.hide() } else { overlay.show() };
    let _ = app.emit("overlay-visible", !transcript_mode);
  }
  Ok(())
}

fn stop_engine(app: &AppHandle) {
  let state = app.state::<AppState>();
  if let Some(mut engine) = state.engine.lock().unwrap().take() {
    engine.stop();
  }
  silence(&state);
  set_status(app, EngineState::Idle, None, None);
}

fn silence(state: &AppState) {
  if let Some(speaker) = state.speaker.lock().unwrap().as_ref() {
    speaker.stop();
  }
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
  state.store.load_settings()
}

#[tauri::command]
async fn save_settings(app: AppHandle, settings: Settings) -> CmdResult<()> {
  let state = app.state::<AppState>();
  let old = state.store.load_settings();
  state.store.save_settings(&settings).map_err(err)?;
  let _ = app.emit("settings", &settings);
  let pipeline_changed = Settings { overlay: old.overlay.clone(), save_history: old.save_history, ..settings.clone() } != old
    || settings.save_history != old.save_history
    || settings.overlay.show_original != old.overlay.show_original;
  let running = state.engine.lock().unwrap().as_ref().is_some_and(|e| e.is_running());
  if pipeline_changed && running {
    start_engine(&app)?;
  }
  Ok(())
}

#[tauri::command]
fn list_audio_sources() -> Vec<AudioSourceInfo> {
  audio::list_sources()
}

#[tauri::command]
fn get_status(state: State<AppState>) -> StatusPayload {
  state.status.lock().unwrap().clone()
}

#[tauri::command]
async fn start(app: AppHandle) -> CmdResult<()> {
  start_engine(&app)
}

#[tauri::command]
async fn stop(app: AppHandle) -> CmdResult<()> {
  stop_engine(&app);
  Ok(())
}

#[tauri::command]
async fn list_models(app: AppHandle, refresh: bool) -> CmdResult<ModelList> {
  let paths = app.state::<AppState>().paths.clone();
  let (translation, translation_error) = match models::translation_index(&paths, refresh).await {
    Ok(list) => (list, None),
    Err(e) => (Vec::new(), Some(e.to_string())),
  };
  Ok(ModelList { whisper: models::list_whisper(&paths), translation, translation_error })
}

/// `key` is "whisper:<id>" or "translate:<from>:<to>".
#[tauri::command]
async fn download_model(app: AppHandle, key: String) -> CmdResult<()> {
  let paths = app.state::<AppState>().paths.clone();
  let emit = |done: u64, total: Option<u64>, status: &'static str, error: Option<String>| {
    let _ = app.emit("download", DownloadEvent { key: key.clone(), done, total, status, error });
  };
  let mut last = Instant::now() - Duration::from_secs(1);
  let progress = |done: u64, total: Option<u64>| {
    if last.elapsed() > Duration::from_millis(150) {
      last = Instant::now();
      emit(done, total, "progress", None);
    }
  };
  emit(0, None, "progress", None);
  let parts: Vec<&str> = key.split(':').collect();
  let result = match parts.as_slice() {
    ["whisper", id] => models::install_whisper(&paths, id, progress).await,
    ["translate", from, to] => models::install_translation(&paths, from, to, progress).await,
    _ => return Err("unknown model".into()),
  };
  match result {
    Ok(()) => {
      emit(0, None, "done", None);
      Ok(())
    }
    Err(e) => {
      emit(0, None, "error", Some(e.to_string()));
      Err(e.to_string())
    }
  }
}

#[tauri::command]
async fn delete_model(app: AppHandle, key: String) -> CmdResult<()> {
  let paths = app.state::<AppState>().paths.clone();
  let parts: Vec<&str> = key.split(':').collect();
  match parts.as_slice() {
    ["whisper", id] => models::delete_whisper(&paths, id).map_err(err),
    ["translate", from, to] => models::delete_translation(&paths, from, to).map_err(err),
    _ => Err("unknown model".into()),
  }
}

#[tauri::command]
fn get_history(state: State<AppState>, limit: u32, session: Option<i64>) -> CmdResult<Vec<HistoryEntry>> {
  state.store.history(limit, session).map_err(err)
}

#[tauri::command]
fn list_sessions(state: State<AppState>, limit: u32) -> CmdResult<Vec<SessionSummary>> {
  state.store.sessions(limit).map_err(err)
}

#[tauri::command]
fn delete_session(state: State<AppState>, session: i64) -> CmdResult<()> {
  if *state.session.lock().unwrap() == Some(session) && state.status.lock().unwrap().running {
    return Err("Stop translating before deleting this session.".into());
  }
  state.store.delete_session(session).map_err(err)
}

/// Writes the stored lines (one session, or everything) to a text file and returns its path.
#[tauri::command]
fn export_transcript(app: AppHandle, session: Option<i64>) -> CmdResult<String> {
  let state = app.state::<AppState>();
  let mut entries = state.store.history(100_000, session).map_err(err)?;
  if entries.is_empty() {
    return Err("There is nothing to save yet.".into());
  }
  entries.reverse();
  let mut text = String::new();
  for e in &entries {
    text.push_str(&format!("[{}]\n", e.created_at));
    if let Some(original) = &e.original {
      text.push_str(&format!("{original}\n"));
    }
    text.push_str(&format!("→ {}\n\n", e.translated));
  }
  let dir = app.path().document_dir().map_err(err)?.join("Lingvo");
  std::fs::create_dir_all(&dir).map_err(err)?;
  let name = session.map_or("transcript-all.txt".to_string(), |id| format!("transcript-{id}.txt"));
  let path = dir.join(name);
  std::fs::write(&path, text).map_err(err)?;
  Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn reveal_file(path: String) -> CmdResult<()> {
  std::process::Command::new("open").arg("-R").arg(path).spawn().map_err(err)?;
  Ok(())
}

#[tauri::command]
async fn translate_text(app: AppHandle, text: String, from: String, to: String) -> CmdResult<Translation> {
  tauri::async_runtime::spawn_blocking(move || {
    let state = app.state::<AppState>();
    let tools = state.tools.lock().unwrap();
    let tools = tools.as_ref().ok_or_else(|| lingvo_core::tools::shut_down())?;
    tools.translate_text(text, from, to)
  })
  .await
  .map_err(err)?
  .map_err(err)
}

#[tauri::command]
fn record_start(state: State<AppState>) -> CmdResult<()> {
  let mut slot = state.recording.lock().unwrap();
  if let Some(mut old) = slot.take() {
    old.capture.stop();
  }
  let (tx, audio) = mpsc::channel();
  let capture = CpalCapture::start(audio::DEFAULT_INPUT, tx).map_err(err)?;
  *slot = Some(Recording { capture, audio });
  Ok(())
}

/// Stops the microphone, then recognises and translates what was said.
#[tauri::command]
async fn record_stop(app: AppHandle, to: String) -> CmdResult<Translation> {
  tauri::async_runtime::spawn_blocking(move || {
    let state = app.state::<AppState>();
    let mut recording = state.recording.lock().unwrap().take().ok_or("Nothing is being recorded.")?;
    recording.capture.stop();
    let samples: Vec<f32> = recording.audio.try_iter().flatten().collect();
    let model = state.store.load_settings().whisper_model;
    let tools = state.tools.lock().unwrap();
    let tools = tools.as_ref().ok_or("The translator has shut down.")?;
    tools.translate_audio(samples, model, to).map_err(err)
  })
  .await
  .map_err(err)?
}

#[tauri::command]
fn speak(state: State<AppState>, text: String, lang: String) -> CmdResult<()> {
  let speaker = state.speaker.lock().unwrap();
  speaker.as_ref().ok_or("Speech is not available.")?.speak(&text, &lang).map_err(err)
}

#[tauri::command]
fn stop_speaking(state: State<AppState>) {
  silence(&state);
}

#[tauri::command]
fn clear_history(state: State<AppState>) -> CmdResult<()> {
  state.store.clear_history().map_err(err)
}

#[tauri::command]
fn set_overlay_visible(app: AppHandle, visible: bool) -> CmdResult<()> {
  let overlay = app.get_webview_window(OVERLAY).ok_or("overlay window missing")?;
  if visible { overlay.show() } else { overlay.hide() }.map_err(err)?;
  let _ = app.emit("overlay-visible", visible);
  Ok(())
}

#[tauri::command]
fn get_overlay_state(app: AppHandle) -> (bool, bool) {
  let visible = app.get_webview_window(OVERLAY).and_then(|w| w.is_visible().ok()).unwrap_or(false);
  (visible, app.state::<AppState>().overlay_edit.load(Ordering::Relaxed))
}

/// Edit mode makes the overlay draggable and resizable; otherwise clicks pass through it.
#[tauri::command]
fn set_overlay_edit(app: AppHandle, edit: bool) -> CmdResult<()> {
  let overlay = app.get_webview_window(OVERLAY).ok_or("overlay window missing")?;
  overlay.set_ignore_cursor_events(!edit).map_err(err)?;
  if edit {
    overlay.show().map_err(err)?;
    let _ = app.emit("overlay-visible", true);
  }
  app.state::<AppState>().overlay_edit.store(edit, Ordering::Relaxed);
  let _ = app.emit("overlay-edit", edit);
  Ok(())
}

fn toggle_overlay(app: &AppHandle) {
  if let Some(overlay) = app.get_webview_window(OVERLAY) {
    let visible = overlay.is_visible().unwrap_or(false);
    let _ = if visible { overlay.hide() } else { overlay.show() };
    let _ = app.emit("overlay-visible", !visible);
  }
}

fn place_overlay(overlay: &WebviewWindow, store: &Store) {
  let saved: Option<Bounds> = store.get_value(OVERLAY_BOUNDS_KEY).and_then(|v| serde_json::from_str(&v).ok());
  if let Some(b) = saved {
    let _ = overlay.set_size(PhysicalSize::new(b.w, b.h));
    let _ = overlay.set_position(PhysicalPosition::new(b.x, b.y));
    return;
  }
  if let (Ok(Some(monitor)), Ok(size)) = (overlay.primary_monitor(), overlay.outer_size()) {
    let screen = monitor.size();
    let origin = monitor.position();
    let x = origin.x + (screen.width as i32 - size.width as i32) / 2;
    let y = origin.y + screen.height as i32 - size.height as i32 - (screen.height as i32 / 7);
    let _ = overlay.set_position(PhysicalPosition::new(x, y));
  }
}

/// Lets the overlay float above other apps' fullscreen video.
#[cfg(target_os = "macos")]
fn raise_above_fullscreen(overlay: &WebviewWindow) {
  use objc2::msg_send;
  use objc2::runtime::AnyObject;

  const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
  const STATIONARY: usize = 1 << 4;
  const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
  const SCREEN_SAVER_LEVEL: isize = 1000;

  if let Ok(ptr) = overlay.ns_window() {
    let window = ptr as *mut AnyObject;
    unsafe {
      let _: () = msg_send![window, setCollectionBehavior: CAN_JOIN_ALL_SPACES | STATIONARY | FULL_SCREEN_AUXILIARY];
      let _: () = msg_send![window, setLevel: SCREEN_SAVER_LEVEL];
    }
  }
}

#[cfg(not(target_os = "macos"))]
fn raise_above_fullscreen(_overlay: &WebviewWindow) {}

/// The green button should zoom the window up to its maximum size, not enter full screen.
#[cfg(target_os = "macos")]
fn disable_fullscreen(window: &WebviewWindow) {
  use objc2::msg_send;
  use objc2::runtime::AnyObject;

  const FULL_SCREEN_NONE: usize = 1 << 9;

  if let Ok(ptr) = window.ns_window() {
    let window = ptr as *mut AnyObject;
    unsafe {
      let _: () = msg_send![window, setCollectionBehavior: FULL_SCREEN_NONE];
    }
  }
}

#[cfg(not(target_os = "macos"))]
fn disable_fullscreen(_window: &WebviewWindow) {}

pub fn run() {
  let toggle = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyL);
  tauri::Builder::default()
    .plugin(
      tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |app, shortcut, event| {
          if shortcut == &toggle && event.state() == ShortcutState::Pressed {
            toggle_overlay(app);
          }
        })
        .build(),
    )
    .setup(move |app| {
      let data_dir = app.path().app_data_dir()?;
      std::fs::create_dir_all(&data_dir)?;
      let store = Store::open(&data_dir.join("lingvo.db"))?;
      let paths = ModelPaths::new(data_dir.join("models"))?;
      let tools = Tools::spawn(paths.clone())?;

      if let Some(main) = app.get_webview_window("main") {
        disable_fullscreen(&main);
      }

      if let Some(overlay) = app.get_webview_window(OVERLAY) {
        place_overlay(&overlay, &store);
        let _ = overlay.set_ignore_cursor_events(true);
        raise_above_fullscreen(&overlay);
      }

      app.manage(AppState {
        store,
        paths,
        engine: Mutex::new(None),
        status: Mutex::new(StatusPayload { state: EngineState::Idle, message: None, detected_lang: None, running: false, session_id: None }),
        overlay_edit: AtomicBool::new(false),
        bounds_saved: Mutex::new(Instant::now()),
        session: Mutex::new(None),
        tools: Mutex::new(Some(tools)),
        speaker: Mutex::new(Speaker::spawn().ok()),
        recording: Mutex::new(None),
      });

      // Development aid: `LINGVO_AUTOSTART=1` starts translating on launch and logs events.
      #[cfg(debug_assertions)]
      if std::env::var("LINGVO_AUTOSTART").is_ok() {
        use tauri::Listener;
        for name in ["status", "subtitle"] {
          app.listen(name, move |e| eprintln!("[{name}] {}", e.payload()));
        }
        if std::env::var("LINGVO_AUTOSTART").as_deref() == Ok("dub") {
          let store = &app.state::<AppState>().store;
          let _ = store.save_settings(&Settings { speak_translation: true, ..store.load_settings() });
        }
        if let Err(e) = start_engine(app.handle()) {
          eprintln!("[lingvo] autostart failed: {e}");
        }
      }

      if let Err(e) = app.global_shortcut().register(toggle) {
        eprintln!("[lingvo] could not register the overlay shortcut: {e}");
      }
      Ok(())
    })
    .on_window_event(|window, event| match event {
      WindowEvent::CloseRequested { .. } if window.label() == "main" => {
        stop_engine(window.app_handle());
        let state = window.state::<AppState>();
        state.speaker.lock().unwrap().take();
        // Release the on-demand models before the process exits.
        state.tools.lock().unwrap().take();
        window.app_handle().exit(0);
      }
      WindowEvent::Moved(_) | WindowEvent::Resized(_) if window.label() == OVERLAY => {
        let state = window.state::<AppState>();
        if !state.overlay_edit.load(Ordering::Relaxed) {
          return;
        }
        let mut last = state.bounds_saved.lock().unwrap();
        if last.elapsed() < Duration::from_millis(200) {
          return;
        }
        *last = Instant::now();
        if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
          let bounds = Bounds { x: pos.x, y: pos.y, w: size.width, h: size.height };
          if let Ok(json) = serde_json::to_string(&bounds) {
            let _ = state.store.set_value(OVERLAY_BOUNDS_KEY, &json);
          }
        }
      }
      _ => {}
    })
    .invoke_handler(tauri::generate_handler![
      get_settings,
      save_settings,
      list_audio_sources,
      get_status,
      start,
      stop,
      list_models,
      download_model,
      delete_model,
      get_history,
      list_sessions,
      delete_session,
      clear_history,
      export_transcript,
      reveal_file,
      translate_text,
      record_start,
      record_stop,
      speak,
      stop_speaking,
      set_overlay_visible,
      get_overlay_state,
      set_overlay_edit,
    ])
    .run(tauri::generate_context!())
    .expect("error while running Lingvo");
}
