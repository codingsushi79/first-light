//! LAN multiplayer transport: the host runs a small WebSocket hub, guests connect by IP.
//! Messages are opaque JSON strings from the game; this module only routes them:
//! guest -> host (tagged with the guest id), host -> one guest or all guests.

use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, watch, Mutex};
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Clone, PartialEq)]
pub enum LanEvent {
    Join { id: String, addr: String },
    Msg { from: String, data: String },
    Leave { id: String },
    Closed { reason: String },
}

type Callback = Arc<dyn Fn(LanEvent) + Send + Sync>;

#[derive(Default)]
pub struct Lan {
    guests: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<String>>>>,
    to_host: Mutex<Option<mpsc::UnboundedSender<String>>>,
    shutdown: Mutex<Option<watch::Sender<bool>>>,
    next_id: Arc<AtomicU64>,
}

impl Lan {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start hosting on `port` (0 = pick any). Returns the bound port.
    pub async fn host(&self, port: u16, on_event: impl Fn(LanEvent) + Send + Sync + 'static) -> Result<u16, String> {
        self.stop().await;
        let listener = TcpListener::bind(("0.0.0.0", port)).await.map_err(|e| format!("Could not open port {port}: {e}"))?;
        let bound = listener.local_addr().map_err(|e| e.to_string())?.port();
        let (stop_tx, mut stop_rx) = watch::channel(false);
        *self.shutdown.lock().await = Some(stop_tx);
        let cb: Callback = Arc::new(on_event);
        let guests = self.guests.clone();
        let next_id = self.next_id.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = stop_rx.changed() => break,
                    acc = listener.accept() => {
                        let Ok((stream, addr)) = acc else { continue };
                        let cb = cb.clone();
                        let guests = guests.clone();
                        let id = format!("lan-{}", next_id.fetch_add(1, Ordering::Relaxed) + 1);
                        let mut stop = stop_rx.clone();
                        tokio::spawn(async move {
                            let Ok(ws) = tokio_tungstenite::accept_async(stream).await else { return };
                            let (mut write, mut read) = ws.split();
                            let (tx, mut rx) = mpsc::unbounded_channel::<String>();
                            guests.lock().await.insert(id.clone(), tx);
                            cb(LanEvent::Join { id: id.clone(), addr: addr.to_string() });
                            let writer = tokio::spawn(async move {
                                while let Some(text) = rx.recv().await {
                                    if write.send(Message::Text(text.into())).await.is_err() { break; }
                                }
                                let _ = write.close().await;
                            });
                            loop {
                                tokio::select! {
                                    _ = stop.changed() => break,
                                    msg = read.next() => match msg {
                                        Some(Ok(Message::Text(t))) => cb(LanEvent::Msg { from: id.clone(), data: t.to_string() }),
                                        Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                                        _ => {}
                                    }
                                }
                            }
                            guests.lock().await.remove(&id);
                            writer.abort();
                            cb(LanEvent::Leave { id });
                        });
                    }
                }
            }
        });
        Ok(bound)
    }

    /// Connect to a host at "ip:port".
    pub async fn join(&self, addr: &str, on_event: impl Fn(LanEvent) + Send + Sync + 'static) -> Result<(), String> {
        self.stop().await;
        let url = format!("ws://{addr}");
        let conn = tokio::time::timeout(Duration::from_secs(6), tokio_tungstenite::connect_async(url.as_str()))
            .await
            .map_err(|_| format!("Timed out connecting to {addr}. Is the host on the same network, and is the port allowed through their firewall?"))?
            .map_err(|e| format!("Could not connect to {addr}: {e}"))?;
        let (ws, _) = conn;
        let (mut write, mut read) = ws.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        *self.to_host.lock().await = Some(tx);
        let (stop_tx, mut stop_rx) = watch::channel(false);
        *self.shutdown.lock().await = Some(stop_tx);
        let cb: Callback = Arc::new(on_event);
        tokio::spawn(async move {
            while let Some(text) = rx.recv().await {
                if write.send(Message::Text(text.into())).await.is_err() { break; }
            }
            let _ = write.close().await;
        });
        tokio::spawn(async move {
            let reason = loop {
                tokio::select! {
                    _ = stop_rx.changed() => break "left".to_string(),
                    msg = read.next() => match msg {
                        Some(Ok(Message::Text(t))) => cb(LanEvent::Msg { from: "host".into(), data: t.to_string() }),
                        Some(Ok(Message::Close(_))) | None => break "Host closed the connection.".to_string(),
                        Some(Err(e)) => break format!("Connection error: {e}"),
                        _ => {}
                    }
                }
            };
            cb(LanEvent::Closed { reason });
        });
        Ok(())
    }

    /// Host: send to one guest (`to`) or everyone (`None`). Guest: send to the host.
    pub async fn send(&self, to: Option<String>, data: String) -> Result<(), String> {
        if let Some(tx) = self.to_host.lock().await.as_ref() {
            return tx.send(data).map_err(|_| "Not connected.".to_string());
        }
        let guests = self.guests.lock().await;
        match to {
            Some(id) => guests.get(&id).ok_or("No such player.")?.send(data).map_err(|_| "Player disconnected.".to_string()),
            None => {
                for tx in guests.values() { let _ = tx.send(data.clone()); }
                Ok(())
            }
        }
    }

    pub async fn stop(&self) {
        if let Some(tx) = self.shutdown.lock().await.take() { let _ = tx.send(true); }
        self.guests.lock().await.clear();
        *self.to_host.lock().await = None;
    }
}

/// This machine's LAN IPv4 address (the interface used for outbound traffic). No packets are sent.
pub fn local_ip() -> Option<String> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.168.0.1:80").ok()?;
    let ip = s.local_addr().ok()?.ip();
    if ip.is_unspecified() || ip.is_loopback() { None } else { Some(ip.to_string()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn host_and_guest_exchange_messages() {
        let host = Lan::new();
        let (htx, mut hrx) = mpsc::unbounded_channel();
        let port = host.host(0, move |e| { let _ = htx.send(e); }).await.unwrap();

        let guest = Lan::new();
        let (gtx, mut grx) = mpsc::unbounded_channel();
        guest.join(&format!("127.0.0.1:{port}"), move |e| { let _ = gtx.send(e); }).await.unwrap();

        let id = match hrx.recv().await.unwrap() { LanEvent::Join { id, .. } => id, e => panic!("expected join, got {e:?}") };
        guest.send(None, r#"{"t":"hello"}"#.into()).await.unwrap();
        assert_eq!(hrx.recv().await.unwrap(), LanEvent::Msg { from: id.clone(), data: r#"{"t":"hello"}"#.into() });

        host.send(Some(id.clone()), "direct".into()).await.unwrap();
        host.send(None, "broadcast".into()).await.unwrap();
        assert_eq!(grx.recv().await.unwrap(), LanEvent::Msg { from: "host".into(), data: "direct".into() });
        assert_eq!(grx.recv().await.unwrap(), LanEvent::Msg { from: "host".into(), data: "broadcast".into() });

        // big payloads (frames are ~150 KB JPEG data URLs)
        let big = "x".repeat(400_000);
        host.send(None, big.clone()).await.unwrap();
        assert_eq!(grx.recv().await.unwrap(), LanEvent::Msg { from: "host".into(), data: big });

        guest.stop().await;
        assert_eq!(hrx.recv().await.unwrap(), LanEvent::Leave { id });
    }
}
