#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use futures_util::StreamExt;
use reqwest::{Client, RequestBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{env, fs, path::PathBuf, sync::Arc, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tokio::sync::Mutex;

const BRIDGE_PROTOCOL_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct BridgeFile {
    port: u16,
    instance_id: String,
    expires_at: u64,
    enabled: bool,
}

#[derive(Clone)]
struct ConnectedHost {
    base_url: String,
    instance_id: String,
}

struct AppState {
    client: Client,
    host: Mutex<Option<ConnectedHost>>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum PetMessage {
    Chat { text: String },
    Vision { prompt: String },
    Capture,
    DiscardCapture,
    Drag,
    Cancel,
    Layout { mode: String, width: f64, height: f64, size: f64 },
    Preferences { auto_dock: bool },
}

#[derive(Debug, Serialize)]
struct BridgeEvent<'a> {
    method: &'a str,
    args: Vec<Value>,
}

fn dsh_home() -> PathBuf {
    if let Ok(home) = env::var("DSH_HOME") {
        if !home.trim().is_empty() {
            return PathBuf::from(home);
        }
    }
    let base = env::var("USERPROFILE").or_else(|_| env::var("HOME")).unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join(".dsh")
}

fn read_bridge() -> Option<BridgeFile> {
    let content = fs::read_to_string(dsh_home().join("pet-bridge.json")).ok()?;
    let bridge: BridgeFile = serde_json::from_str(&content).ok()?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_millis() as u64;
    (bridge.port > 0 && !bridge.instance_id.is_empty() && bridge.expires_at > now).then_some(bridge)
}

fn request(state: &AppState, host: &ConnectedHost, path: &str) -> RequestBuilder {
    state.client
        .get(format!("{}{}", host.base_url, path))
        .header("X-Pet-Instance", &host.instance_id)
}

fn emit(app: &AppHandle, method: &'static str, args: Vec<Value>) {
    let _ = app.emit("pet:bridge", BridgeEvent { method, args });
}

async fn get_json(state: &AppState, host: &ConnectedHost, path: &str) -> Option<Value> {
    let response = request(state, host, path).send().await.ok()?;
    response.status().is_success().then_some(())?;
    response.json().await.ok()
}

async fn refresh_projection(app: &AppHandle, state: &AppState, host: &ConnectedHost) {
    if let Some(value) = get_json(state, host, "/api/pet/preferences").await {
        if let Some(prefs) = value.get("preferences") {
            emit(app, "applyPreferences", vec![prefs.clone()]);
        }
    }
    if let Some(value) = get_json(state, host, "/api/pet/history").await {
        if let Some(turns) = value.get("turns") {
            emit(app, "loadHistory", vec![turns.clone()]);
        }
    }
    if let Some(value) = get_json(state, host, "/api/pet/status").await {
        if let Some(status) = value.get("status") {
            emit(app, "updateAgentStatus", vec![status.clone()]);
        }
    }
}

async fn bridge_monitor(app: AppHandle, state: Arc<AppState>) {
    let mut last_key = String::new();
    loop {
        match read_bridge() {
            Some(bridge) => {
                let key = format!("{}:{}", bridge.port, bridge.instance_id);
                let host = ConnectedHost {
                    base_url: format!("http://127.0.0.1:{}", bridge.port),
                    instance_id: bridge.instance_id,
                };
                let changed = key != last_key;
                {
                    let mut current = state.host.lock().await;
                    *current = Some(host.clone());
                }
                if changed {
                    last_key = key;
                    emit(&app, "renderOnline", vec![]);
                    refresh_projection(&app, &state, &host).await;
                } else {
                    refresh_projection(&app, &state, &host).await;
                }
                if let Some(window) = app.get_webview_window("main") {
                    if bridge.enabled {
                        let _ = window.show();
                    } else {
                        let _ = window.hide();
                    }
                }
            }
            None => {
                *state.host.lock().await = None;
                if !last_key.is_empty() {
                    last_key.clear();
                    emit(&app, "renderOffline", vec![]);
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

async fn stream_chat(app: AppHandle, state: Arc<AppState>, path: &str, body: Value) {
    let host = match state.host.lock().await.clone() {
        Some(host) => host,
        None => {
            emit(&app, "renderError", vec![json!("DeepSeek Harness 未运行")]);
            return;
        }
    };
    let response = state.client
        .post(format!("{}{}", host.base_url, path))
        .header("X-Pet-Instance", host.instance_id)
        .json(&body)
        .send()
        .await;
    let response = match response {
        Ok(response) if response.status().is_success() => response,
        Ok(response) => {
            emit(&app, "renderError", vec![json!(format!("请求失败：HTTP {}", response.status()))]);
            return;
        }
        Err(error) => {
            emit(&app, "renderError", vec![json!(format!("无法连接桌宠服务：{error}"))]);
            return;
        }
    };
    let mut bytes = response.bytes_stream();
    let mut buffer = String::new();
    while let Some(chunk) = bytes.next().await {
        let Ok(chunk) = chunk else { break };
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(end) = buffer.find("\n\n") {
            let frame: String = buffer.drain(..end + 2).collect();
            for line in frame.lines() {
                let Some(payload) = line.strip_prefix("data: ") else { continue };
                let Ok(event) = serde_json::from_str::<Value>(payload) else { continue };
                match event.get("type").and_then(Value::as_str) {
                    Some("delta") => emit(&app, "renderDelta", vec![event.get("text").cloned().unwrap_or(Value::String(String::new()))]),
                    Some("activity") => emit(&app, "renderActivity", vec![event.get("activity").cloned().unwrap_or(Value::Null)]),
                    Some("error") => emit(&app, "renderError", vec![event.get("error").cloned().unwrap_or(json!("请求失败"))]),
                    Some("done") => emit(&app, "renderDone", vec![]),
                    _ => {}
                }
            }
        }
    }
}

#[tauri::command]
async fn pet_message(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    message: PetMessage,
) -> Result<(), String> {
    match message {
        PetMessage::Chat { text } => {
            if text.trim().is_empty() { return Ok(()); }
            tauri::async_runtime::spawn(stream_chat(app, state.inner().clone(), "/api/pet/chat", json!({ "message": text })));
        }
        PetMessage::Vision { prompt } => {
            emit(&app, "renderError", vec![json!("Windows 截图选择器尚未接入；请先在桌面端使用截图分析。")]);
            let _ = prompt;
        }
        PetMessage::Capture => {
            emit(&app, "captureFailed", vec![json!("Windows 截图选择器开发中")]);
        }
        PetMessage::DiscardCapture => {}
        PetMessage::Drag => window.start_dragging().map_err(|error| error.to_string())?,
        PetMessage::Cancel => {
            if let Some(host) = state.host.lock().await.clone() {
                let _ = state.client.post(format!("{}/api/pet/cancel", host.base_url))
                    .header("X-Pet-Instance", host.instance_id).send().await;
            }
        }
        PetMessage::Layout { mode: _, width, height, size: _ } => {
            use tauri::{LogicalSize, Size};
            window.set_size(Size::Logical(LogicalSize::new(width.max(118.0), height.max(118.0))))
                .map_err(|error| error.to_string())?;
        }
        PetMessage::Preferences { auto_dock: _ } => {}
    }
    Ok(())
}

fn main() {
    let state = Arc::new(AppState {
        client: Client::builder().timeout(Duration::from_secs(120)).build().expect("HTTP client"),
        host: Mutex::new(None),
    });
    tauri::Builder::default()
        .manage(state.clone())
        .setup(move |app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(bridge_monitor(app_handle, state));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![pet_message])
        .run(tauri::generate_context!())
        .expect("error while running DeepSeekPet");
}
