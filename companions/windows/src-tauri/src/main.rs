#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use futures_util::StreamExt;
use image::{
    codecs::jpeg::JpegEncoder,
    imageops::{resize, FilterType},
    ImageBuffer, Rgba,
};
use reqwest::{Client, RequestBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env, fs,
    io::Cursor,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tokio::sync::Mutex;
#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
    UI::Input::KeyboardAndMouse::GetAsyncKeyState,
    UI::WindowsAndMessaging::{
        CallWindowProcW, DefWindowProcW, GetCursorPos, GetSystemMetrics, GetWindowLongPtrW,
        GetWindowRect, SetWindowLongPtrW, SetWindowPos, GWLP_WNDPROC, HTCLIENT, HTTRANSPARENT,
        SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
        SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER, WM_MOVING, WM_NCHITTEST,
    },
};

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
    pending_capture: Mutex<Option<Vec<u8>>>,
    auto_dock: Mutex<bool>,
    chat_open: Mutex<bool>,
    docked: Mutex<bool>,
    restore_position: Mutex<Option<(i32, i32)>>,
    recovery_hold_until: Mutex<Option<Instant>>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
struct HitRegion {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Deserialize)]
struct CaptureSelection {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum PetMessage {
    Chat {
        text: String,
    },
    Vision {
        prompt: String,
    },
    Capture,
    DiscardCapture,
    Drag,
    Cancel,
    Layout {
        mode: String,
        width: f64,
        height: f64,
        size: f64,
    },
    HitRegions {
        regions: Vec<HitRegion>,
    },
    Preferences {
        auto_dock: bool,
    },
}

#[derive(Clone, Debug, Serialize)]
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
    let base = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join(".dsh")
}

fn read_bridge() -> Option<BridgeFile> {
    let content = fs::read_to_string(dsh_home().join("pet-bridge.json")).ok()?;
    let bridge: BridgeFile = serde_json::from_str(&content).ok()?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    (bridge.port > 0 && !bridge.instance_id.is_empty() && bridge.expires_at > now).then_some(bridge)
}

fn request(state: &AppState, host: &ConnectedHost, path: &str) -> RequestBuilder {
    state
        .client
        .get(format!("{}{}", host.base_url, path))
        .header("X-Pet-Instance", &host.instance_id)
}

fn emit(app: &AppHandle, method: &'static str, args: Vec<Value>) {
    let _ = app.emit("pet:bridge", BridgeEvent { method, args });
}

fn set_window_visibility(app: &AppHandle, visible: bool) {
    if let Some(window) = app.get_webview_window("main") {
        if visible {
            let _ = window.show();
        } else {
            let _ = window.hide();
        }
    }
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
    let mut missing_bridge_count = 0u8;
    let mut observed_bridge = false;
    loop {
        match read_bridge() {
            Some(bridge) => {
                observed_bridge = true;
                missing_bridge_count = 0;
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
                set_window_visibility(&app, bridge.enabled);
            }
            None => {
                missing_bridge_count = missing_bridge_count.saturating_add(1);
                // Harness 卸载插件或退出时会删除/等待 bridge 过期。窗口必须立即隐藏，
                // 否则旧的伴生进程会继续显示，并在 Harness 下次启动前脱离生命周期。
                set_window_visibility(&app, false);
                *state.host.lock().await = None;
                let had_host = !last_key.is_empty();
                if had_host {
                    last_key.clear();
                    emit(&app, "renderOffline", vec![]);
                }
                // bridge 消失代表当前 Harness 生命周期结束。退出伴生进程，避免下一次
                // Harness 启动时重复拉起多个桌宠实例；新的 bridge 出现后由插件重新拉起。
                if observed_bridge && missing_bridge_count >= 3 {
                    app.exit(0);
                    break;
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

#[cfg(target_os = "windows")]
fn dock_debug(message: &str) {
    use std::io::Write;
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(env::temp_dir().join("deepseek-pet-dock.log"))
    {
        let _ = writeln!(
            file,
            "{} {}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0),
            message
        );
    }
}

#[cfg(target_os = "windows")]
fn set_native_window_position(window: &WebviewWindow, x: i32, y: i32) -> bool {
    window
        .hwnd()
        .ok()
        .map(|raw| unsafe {
            SetWindowPos(
                raw.0 as HWND,
                std::ptr::null_mut(),
                x,
                y,
                0,
                0,
                SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
            ) != 0
        })
        .unwrap_or(false)
}

async fn auto_dock_monitor(app: AppHandle, state: Arc<AppState>) {
    const EDGE_THRESHOLD: i32 = 32;
    const RECOVERY_STRIP: i32 = 24;
    const RECOVERY_HOLD: Duration = Duration::from_millis(900);
    const DOCK_DELAY: Duration = Duration::from_millis(450);
    let mut outside_since: Option<Instant> = None;

    loop {
        if let Some(window) = app.get_webview_window("main") {
            let auto_dock = *state.auto_dock.lock().await;
            let chat_open = *state.chat_open.lock().await;
            let is_docked = *state.docked.lock().await;
            let recovery_hold = state
                .recovery_hold_until
                .lock()
                .await
                .map(|until| until > Instant::now())
                .unwrap_or(false);
            let mut rect = RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            let rect_ok = window
                .hwnd()
                .ok()
                .map(|raw| unsafe { GetWindowRect(raw.0 as HWND, &mut rect) != 0 })
                .unwrap_or(false);
            let compact_window =
                rect_ok && rect.right - rect.left <= 220 && rect.bottom - rect.top <= 220;
            dock_debug(&format!(
                "tick auto={} docked={} hold={} rect_ok={} compact={} rect=({},{} {}x{})",
                auto_dock,
                is_docked,
                recovery_hold,
                rect_ok,
                compact_window,
                rect.left,
                rect.top,
                rect.right - rect.left,
                rect.bottom - rect.top
            ));

            // 以原生窗口实际尺寸为准，避免前端布局消息短暂丢失或延迟时，
            // chat_open 与画面已经收缩的紧凑态不一致。
            if (!auto_dock || chat_open || !compact_window) && is_docked {
                if let Some((x, y)) = state.restore_position.lock().await.take() {
                    let _ = set_native_window_position(&window, x, y);
                }
                *state.docked.lock().await = false;
            } else if auto_dock && !chat_open && compact_window {
                let mut cursor = POINT { x: 0, y: 0 };
                let cursor_ok = unsafe { GetCursorPos(&mut cursor) != 0 };
                let mouse_down = unsafe { GetAsyncKeyState(0x01) < 0 };
                let x = rect.left;
                let y = rect.top;
                let width = rect.right - rect.left;
                let height = rect.bottom - rect.top;
                let virtual_left = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
                let virtual_top = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
                let virtual_right = virtual_left + unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
                let virtual_bottom = virtual_top + unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };
                let monitor_bounds = window
                    .available_monitors()
                    .ok()
                    .and_then(|monitors| {
                        monitors
                            .into_iter()
                            .max_by_key(|monitor| {
                                let monitor_position = monitor.position();
                                let monitor_size = monitor.size();
                                let overlap_width = (rect
                                    .right
                                    .min(monitor_position.x + monitor_size.width as i32)
                                    - rect.left.max(monitor_position.x))
                                .max(0);
                                let overlap_height = (rect
                                    .bottom
                                    .min(monitor_position.y + monitor_size.height as i32)
                                    - rect.top.max(monitor_position.y))
                                .max(0);
                                overlap_width * overlap_height
                            })
                            .map(|monitor| {
                                let position = monitor.position();
                                let size = monitor.size();
                                (
                                    position.x,
                                    position.y,
                                    position.x + size.width as i32,
                                    position.y + size.height as i32,
                                )
                            })
                    })
                    .unwrap_or((virtual_left, virtual_top, virtual_right, virtual_bottom));

                if cursor_ok && rect_ok {
                    let (left, top, right, bottom) = monitor_bounds;
                    let in_window = cursor.x >= x
                        && cursor.x < x + width
                        && cursor.y >= y
                        && cursor.y < y + height;
                    // Match the macOS shell's 40px interaction halo. A
                    // transparent WebView area can otherwise make a
                    // cursor merely brushing the pet look "outside" and
                    // trigger docking while the user is trying to click.
                    let near_window = cursor.x >= x - 40
                        && cursor.x < x + width + 40
                        && cursor.y >= y - 40
                        && cursor.y < y + height + 40;

                    if mouse_down || near_window {
                        outside_since = None;
                    } else if outside_since.is_none() {
                        dock_debug(&format!(
                            "outside start cursor=({}, {}) pos=({}, {}) edge=({},{} {}x{})",
                            cursor.x,
                            cursor.y,
                            x,
                            y,
                            left,
                            top,
                            right - left,
                            bottom - top
                        ));
                        outside_since = Some(Instant::now());
                    }

                    if is_docked {
                        if in_window {
                            if let Some((restore_x, restore_y)) =
                                state.restore_position.lock().await.take()
                            {
                                let _ = set_native_window_position(&window, restore_x, restore_y);
                            }
                            *state.docked.lock().await = false;
                            *state.recovery_hold_until.lock().await =
                                Some(Instant::now() + RECOVERY_HOLD);
                        }
                    } else if !near_window
                        && !mouse_down
                        && !recovery_hold
                        && outside_since
                            .map(|started| started.elapsed() >= DOCK_DELAY)
                            .unwrap_or(false)
                    {
                        let edge = if x <= left + EDGE_THRESHOLD {
                            Some((left - width + RECOVERY_STRIP, y))
                        } else if x + width >= right - EDGE_THRESHOLD {
                            Some((right - RECOVERY_STRIP, y))
                        } else if y <= top + EDGE_THRESHOLD {
                            Some((x, top - height + RECOVERY_STRIP))
                        } else if y + height >= bottom - EDGE_THRESHOLD {
                            Some((x, bottom - RECOVERY_STRIP))
                        } else {
                            None
                        };
                        if let Some(target) = edge {
                            dock_debug(&format!("DOCK target=({}, {})", target.0, target.1));
                            if set_native_window_position(&window, target.0, target.1) {
                                *state.restore_position.lock().await = Some((x, y));
                                *state.docked.lock().await = true;
                            }
                            outside_since = None;
                        }
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
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
    let response = state
        .client
        .post(format!("{}{}", host.base_url, path))
        .header("X-Pet-Instance", host.instance_id)
        .json(&body)
        .send()
        .await;
    let response = match response {
        Ok(response) if response.status().is_success() => response,
        Ok(response) => {
            emit(
                &app,
                "renderError",
                vec![json!(format!("请求失败：HTTP {}", response.status()))],
            );
            return;
        }
        Err(error) => {
            emit(
                &app,
                "renderError",
                vec![json!(format!("无法连接桌宠服务：{error}"))],
            );
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
                let Some(payload) = line.strip_prefix("data: ") else {
                    continue;
                };
                let Ok(event) = serde_json::from_str::<Value>(payload) else {
                    continue;
                };
                match event.get("type").and_then(Value::as_str) {
                    Some("delta") => emit(
                        &app,
                        "renderDelta",
                        vec![event
                            .get("text")
                            .cloned()
                            .unwrap_or(Value::String(String::new()))],
                    ),
                    Some("activity") => emit(
                        &app,
                        "renderActivity",
                        vec![event.get("activity").cloned().unwrap_or(Value::Null)],
                    ),
                    Some("error") => emit(
                        &app,
                        "renderError",
                        vec![event.get("error").cloned().unwrap_or(json!("请求失败"))],
                    ),
                    Some("done") => emit(&app, "renderDone", vec![]),
                    _ => {}
                }
            }
        }
    }
}

fn capture_screen_region(x: i32, y: i32, width: u32, height: u32) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 {
        return Err("截图区域为空".into());
    }
    let screen = screenshots::Screen::all()
        .map_err(|e| format!("无法枚举显示器：{e}"))?
        .into_iter()
        .find(|screen| {
            let info = screen.display_info;
            x >= info.x
                && y >= info.y
                && x < info.x + info.width as i32
                && y < info.y + info.height as i32
        })
        .ok_or_else(|| "找不到所选区域所在的显示器".to_string())?;
    let info = screen.display_info;
    let image = screen
        .capture_area(x - info.x, y - info.y, width, height)
        .map_err(|e| format!("无法捕获所选区域：{e}"))?;
    let rgba = image.as_raw();
    let buffer: ImageBuffer<Rgba<u8>, _> =
        ImageBuffer::from_raw(image.width(), image.height(), rgba.to_vec())
            .ok_or_else(|| "屏幕图像格式无效".to_string())?;
    let max_width = 1600;
    let resized = if buffer.width() > max_width {
        resize(
            &buffer,
            max_width,
            buffer.height() * max_width / buffer.width(),
            FilterType::Triangle,
        )
    } else {
        buffer
    };
    let mut output = Cursor::new(Vec::new());
    JpegEncoder::new_with_quality(&mut output, 82)
        .encode_image(&resized)
        .map_err(|e| format!("截图编码失败：{e}"))?;
    let bytes = output.into_inner();
    if bytes.len() > 5 * 1024 * 1024 {
        return Err("截图压缩后仍超过大小限制".into());
    }
    Ok(bytes)
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn pet_wnd_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_MOVING {
        // Keep a recovery strip visible on every virtual desktop edge. Without
        // this, a transparent frameless window can be dragged fully off-screen
        // and HTTRANSPARENT makes it impossible to grab again.
        let rect = lparam as *mut RECT;
        if !rect.is_null() {
            let virtual_left = GetSystemMetrics(SM_XVIRTUALSCREEN);
            let virtual_top = GetSystemMetrics(SM_YVIRTUALSCREEN);
            let virtual_right = virtual_left + GetSystemMetrics(SM_CXVIRTUALSCREEN);
            let virtual_bottom = virtual_top + GetSystemMetrics(SM_CYVIRTUALSCREEN);
            let keep_visible = 48;
            let width = (*rect).right - (*rect).left;
            let height = (*rect).bottom - (*rect).top;
            (*rect).left = (*rect).left.min(virtual_right - keep_visible);
            (*rect).top = (*rect).top.min(virtual_bottom - keep_visible);
            (*rect).left = (*rect).left.max(virtual_left - width + keep_visible);
            (*rect).top = (*rect).top.max(virtual_top - height + keep_visible);
            (*rect).right = (*rect).left + width;
            (*rect).bottom = (*rect).top + height;
        }
        return 1;
    }
    if message == WM_NCHITTEST {
        let screen_x = (lparam as i16) as i32;
        let screen_y = ((lparam >> 16) as i16) as i32;
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        GetWindowRect(hwnd, &mut rect);
        let x = screen_x - rect.left;
        let y = screen_y - rect.top;
        let virtual_left = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let virtual_top = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let virtual_right = virtual_left + GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let virtual_bottom = virtual_top + GetSystemMetrics(SM_CYVIRTUALSCREEN);
        let recovery_strip = 48;
        let at_left_edge = rect.left <= virtual_left + recovery_strip;
        let at_top_edge = rect.top <= virtual_top + recovery_strip;
        let at_right_edge = rect.right >= virtual_right - recovery_strip;
        let at_bottom_edge = rect.bottom >= virtual_bottom - recovery_strip;
        let in_visible_edge = (at_left_edge
            && screen_x >= virtual_left
            && screen_x < virtual_left + recovery_strip)
            || (at_top_edge && screen_y >= virtual_top && screen_y < virtual_top + recovery_strip)
            || (at_right_edge
                && screen_x >= virtual_right - recovery_strip
                && screen_x < virtual_right)
            || (at_bottom_edge
                && screen_y >= virtual_bottom - recovery_strip
                && screen_y < virtual_bottom);
        // 紧凑态窗口只包住桌宠和少量留白。前端首帧发送命中区域前，
        // 也必须保证桌宠可点击，否则 WM_NCHITTEST 会把整次点击穿透给宿主。
        // 展开聊天态仍使用下面的精确区域，避免透明画布遮挡侧栏。
        let compact_window = rect.right - rect.left <= 220 && rect.bottom - rect.top <= 220;
        if compact_window {
            return HTCLIENT as LRESULT;
        }
        let regions = HIT_REGIONS
            .get()
            .map(|r| r.lock().unwrap().clone())
            .unwrap_or_default();
        for region in regions {
            if x >= region.x as i32
                && x <= (region.x + region.width) as i32
                && y >= region.y as i32
                && y <= (region.y + region.height) as i32
            {
                return HTCLIENT as LRESULT;
            }
        }
        // Keep the whole visible recovery strip client-hit-tested. Returning
        // HTCAPTION here makes Windows start an OS drag before pet.js sees
        // mousedown, which makes an edge click look like the pet is fleeing.
        // pet.js already distinguishes click from drag and calls
        // start_dragging after the pointer has moved far enough.
        if in_visible_edge {
            return HTCLIENT as LRESULT;
        }
        return HTTRANSPARENT as LRESULT;
    }
    let previous = PREVIOUS_WND_PROC.load(std::sync::atomic::Ordering::Relaxed);
    if previous != 0 {
        return CallWindowProcW(std::mem::transmute(previous), hwnd, message, wparam, lparam);
    }
    DefWindowProcW(hwnd, message, wparam, lparam)
}

#[cfg(target_os = "windows")]
static HIT_REGIONS: std::sync::OnceLock<std::sync::Mutex<Vec<HitRegion>>> =
    std::sync::OnceLock::new();
#[cfg(target_os = "windows")]
static PREVIOUS_WND_PROC: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

#[tauri::command]
async fn capture_selection(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    selection: CaptureSelection,
) -> Result<(), String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        capture_screen_region(selection.x, selection.y, selection.width, selection.height)
    })
    .await
    .map_err(|error| format!("截图任务失败：{error}"))?;
    match result {
        Ok(image) => {
            *state.pending_capture.lock().await = Some(image);
            if let Some(selector) = app.get_webview_window("capture-selector") {
                let _ = selector.close();
            }
            emit(&app, "captureReady", vec![]);
            Ok(())
        }
        Err(error) => {
            if let Some(selector) = app.get_webview_window("capture-selector") {
                let _ = selector.close();
            }
            emit(&app, "captureFailed", vec![json!(error.clone())]);
            Err(error)
        }
    }
}

#[tauri::command]
async fn cancel_capture(app: AppHandle) -> Result<(), String> {
    if let Some(selector) = app.get_webview_window("capture-selector") {
        let _ = selector.close();
    }
    emit(&app, "captureFailed", vec![json!("已取消截图")]);
    Ok(())
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
            if text.trim().is_empty() {
                return Ok(());
            }
            tauri::async_runtime::spawn(stream_chat(
                app,
                state.inner().clone(),
                "/api/pet/chat",
                json!({ "message": text }),
            ));
        }
        PetMessage::Vision { prompt } => {
            let image = state.inner().pending_capture.lock().await.take();
            let Some(image) = image else {
                emit(&app, "renderError", vec![json!("请先选择截图")]);
                return Ok(());
            };
            let body = json!({
                "data": base64::engine::general_purpose::STANDARD.encode(image),
                "name": "selected-screenshot.jpg",
                "prompt": prompt,
            });
            tauri::async_runtime::spawn(stream_chat(
                app,
                state.inner().clone(),
                "/api/pet/vision",
                body,
            ));
        }
        PetMessage::Capture => {
            *state.inner().pending_capture.lock().await = None;
            if let Some(existing) = app.get_webview_window("capture-selector") {
                let _ = existing.close();
            }
            let selector = tauri::WebviewWindowBuilder::new(
                &app,
                "capture-selector",
                tauri::WebviewUrl::App("selector.html".into()),
            )
            .title("选择屏幕区域")
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(true)
            .build()
            .map_err(|error| error.to_string())?;
            if let Ok(monitors) = app.available_monitors() {
                if let (Some(left), Some(top), Some(right), Some(bottom)) = (
                    monitors.iter().map(|m| m.position().x).min(),
                    monitors.iter().map(|m| m.position().y).min(),
                    monitors
                        .iter()
                        .map(|m| m.position().x + m.size().width as i32)
                        .max(),
                    monitors
                        .iter()
                        .map(|m| m.position().y + m.size().height as i32)
                        .max(),
                ) {
                    let _ = selector.set_position(tauri::Position::Physical(
                        tauri::PhysicalPosition::new(left, top),
                    ));
                    let _ = selector.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
                        (right - left) as u32,
                        (bottom - top) as u32,
                    )));
                }
            }
        }
        PetMessage::DiscardCapture => {
            *state.inner().pending_capture.lock().await = None;
        }
        PetMessage::Drag => window.start_dragging().map_err(|error| error.to_string())?,
        PetMessage::Cancel => {
            if let Some(host) = state.host.lock().await.clone() {
                let _ = state
                    .client
                    .post(format!("{}/api/pet/cancel", host.base_url))
                    .header("X-Pet-Instance", host.instance_id)
                    .send()
                    .await;
            }
        }
        PetMessage::Layout {
            mode,
            width,
            height,
            size: _,
        } => {
            *state.chat_open.lock().await = mode != "compact";
            use tauri::{LogicalSize, PhysicalPosition, Size};
            let old_position = window.outer_position().ok();
            let old_size = window.outer_size().ok();
            let scale_factor = window.scale_factor().unwrap_or(1.0);
            let new_width = (width.max(118.0) * scale_factor).round() as u32;
            let new_height = (height.max(118.0) * scale_factor).round() as u32;
            let anchored_position = old_position.zip(old_size).and_then(|(position, old_size)| {
                let monitor = window.current_monitor().ok().flatten().or_else(|| {
                    window
                        .available_monitors()
                        .ok()
                        .and_then(|mut monitors| monitors.pop())
                })?;
                let monitor_position = monitor.position();
                let monitor_size = monitor.size();
                let monitor_right = monitor_position.x + monitor_size.width as i32;
                let monitor_bottom = monitor_position.y + monitor_size.height as i32;
                let tolerance = (48.0 * scale_factor).round() as i32;
                let old_right = position.x + old_size.width as i32;
                let old_bottom = position.y + old_size.height as i32;
                let x = if position.x <= monitor_position.x + tolerance
                    || (monitor_right - old_right).abs() <= tolerance
                {
                    monitor_position.x
                } else if position.x >= monitor_right - tolerance {
                    monitor_right - new_width as i32
                } else {
                    position.x
                };
                let y = if position.y <= monitor_position.y + tolerance
                    || (monitor_bottom - old_bottom).abs() <= tolerance
                {
                    monitor_position.y
                } else if position.y >= monitor_bottom - tolerance {
                    monitor_bottom - new_height as i32
                } else {
                    position.y
                };
                Some(PhysicalPosition::new(x, y))
            });
            window
                .set_size(Size::Logical(LogicalSize::new(
                    width.max(118.0),
                    height.max(118.0),
                )))
                .map_err(|error| error.to_string())?;
            if let Some(position) = anchored_position {
                #[cfg(target_os = "windows")]
                {
                    set_native_window_position(&window, position.x, position.y);
                }
                #[cfg(not(target_os = "windows"))]
                window
                    .set_position(tauri::Position::Physical(position))
                    .map_err(|error| error.to_string())?;
            }
        }
        PetMessage::HitRegions { regions } =>
        {
            #[cfg(target_os = "windows")]
            if let Some(shared) = HIT_REGIONS.get() {
                *shared.lock().unwrap() = regions;
            }
        }
        PetMessage::Preferences { auto_dock } => {
            *state.auto_dock.lock().await = auto_dock;
        }
    }
    Ok(())
}

fn main() {
    let state = Arc::new(AppState {
        client: Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .expect("HTTP client"),
        host: Mutex::new(None),
        pending_capture: Mutex::new(None),
        auto_dock: Mutex::new(true),
        chat_open: Mutex::new(false),
        docked: Mutex::new(false),
        restore_position: Mutex::new(None),
        recovery_hold_until: Mutex::new(None),
    });
    tauri::Builder::default()
        .manage(state.clone())
        .setup(move |app| {
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                // 伴生进程可在 Harness 之前启动；只有读到有效 bridge 且 enabled=true
                // 时才由 bridge_monitor 显示窗口。
                let _ = window.hide();
                let _ = window.set_shadow(false);
                if let Ok(raw) = window.hwnd() {
                    let shared = HIT_REGIONS.get_or_init(|| std::sync::Mutex::new(Vec::new()));
                    let _ = shared;
                    let hwnd: HWND = raw.0 as _;
                    let previous = unsafe { GetWindowLongPtrW(hwnd, GWLP_WNDPROC) };
                    PREVIOUS_WND_PROC.store(previous, std::sync::atomic::Ordering::Relaxed);
                    unsafe {
                        SetWindowLongPtrW(hwnd, GWLP_WNDPROC, pet_wnd_proc as *const () as isize);
                    }
                }
            }
            let app_handle = app.handle().clone();
            #[cfg(target_os = "windows")]
            tauri::async_runtime::spawn(auto_dock_monitor(app_handle.clone(), state.clone()));
            tauri::async_runtime::spawn(bridge_monitor(app_handle, state));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pet_message,
            capture_selection,
            cancel_capture
        ])
        .run(tauri::generate_context!())
        .expect("error while running DeepSeekPet");
}
