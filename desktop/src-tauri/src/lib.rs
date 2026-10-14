mod lan;

use serde_json::json;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

struct LanState(Arc<lan::Lan>);

fn forward(app: &AppHandle, e: lan::LanEvent) {
    let payload = match e {
        lan::LanEvent::Join { id, addr } => json!({ "kind": "join", "id": id, "addr": addr }),
        lan::LanEvent::Msg { from, data } => json!({ "kind": "msg", "from": from, "data": data }),
        lan::LanEvent::Leave { id } => json!({ "kind": "leave", "id": id }),
        lan::LanEvent::Closed { reason } => json!({ "kind": "closed", "reason": reason }),
    };
    let _ = app.emit("lan", payload);
}

#[tauri::command]
async fn lan_host(app: AppHandle, state: State<'_, LanState>, port: u16) -> Result<serde_json::Value, String> {
    let a = app.clone();
    let bound = state.0.host(port, move |e| forward(&a, e)).await?;
    Ok(json!({ "port": bound, "ip": lan::local_ip() }))
}

#[tauri::command]
async fn lan_join(app: AppHandle, state: State<'_, LanState>, addr: String) -> Result<(), String> {
    let a = app.clone();
    state.0.join(&addr, move |e| forward(&a, e)).await
}

#[tauri::command]
async fn lan_send(state: State<'_, LanState>, to: Option<String>, data: String) -> Result<(), String> {
    state.0.send(to, data).await
}

#[tauri::command]
async fn lan_stop(state: State<'_, LanState>) -> Result<(), String> {
    state.0.stop().await;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(LanState(Arc::new(lan::Lan::new())))
        .invoke_handler(tauri::generate_handler![lan_host, lan_join, lan_send, lan_stop])
        .run(tauri::generate_context!())
        .expect("error while running First Light");
}
