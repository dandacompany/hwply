use crate::agent::protocol::{ApiError, ErrorCode};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::oneshot;

pub type Reply = Result<Value, ApiError>;

struct Entry {
    label: String,
    sender: oneshot::Sender<Reply>,
}

/// 창으로 보낸 요청과 그 응답을 잇는다. 응답은 `agent_respond` 명령으로 돌아온다.
#[derive(Default)]
pub struct PendingRequests {
    entries: Mutex<HashMap<String, Entry>>,
}

impl PendingRequests {
    pub fn register_for(&self, label: &str) -> (String, oneshot::Receiver<Reply>) {
        let id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        self.lock().insert(
            id.clone(),
            Entry {
                label: label.to_string(),
                sender,
            },
        );
        (id, receiver)
    }

    /// 모르는 id(이미 시한이 지났거나 실패 처리된 요청)면 false.
    pub fn resolve(&self, id: &str, reply: Reply) -> bool {
        match self.lock().remove(id) {
            Some(entry) => entry.sender.send(reply).is_ok(),
            None => false,
        }
    }

    pub fn fail_window(&self, label: &str, error: ApiError) {
        let failed: Vec<Entry> = {
            let mut entries = self.lock();
            let ids: Vec<String> = entries
                .iter()
                .filter(|(_, e)| e.label == label)
                .map(|(id, _)| id.clone())
                .collect();
            ids.iter().filter_map(|id| entries.remove(id)).collect()
        };
        for entry in failed {
            let _ = entry.sender.send(Err(error.clone()));
        }
    }

    pub async fn wait(
        &self,
        id: &str,
        receiver: oneshot::Receiver<Reply>,
        timeout: Duration,
    ) -> Reply {
        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(reply)) => reply,
            Ok(Err(_)) => Err(ApiError::new(
                ErrorCode::AppBusy,
                "창이 응답 없이 닫혔습니다",
            )),
            Err(_) => {
                self.lock().remove(id);
                Err(ApiError::new(
                    ErrorCode::AppBusy,
                    "창이 제한 시간 안에 응답하지 않았습니다",
                ))
            }
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Entry>> {
        self.entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::protocol::{ApiError, ErrorCode};
    use serde_json::json;
    use std::time::Duration;

    #[tokio::test]
    async fn resolve_delivers_result() {
        let p = PendingRequests::default();
        let (id, rx) = p.register_for("w1");
        assert!(p.resolve(&id, Ok(json!(1))));
        assert_eq!(
            p.wait(&id, rx, Duration::from_secs(1)).await.unwrap(),
            json!(1)
        );
    }

    #[tokio::test]
    async fn pending_request_times_out() {
        let p = PendingRequests::default();
        let (id, rx) = p.register_for("w1");
        let err = p
            .wait(&id, rx, Duration::from_millis(20))
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::AppBusy);
        assert!(!p.resolve(&id, Ok(json!(1))));
    }

    #[tokio::test]
    async fn fail_window_fails_only_that_window() {
        let p = PendingRequests::default();
        let (id1, rx1) = p.register_for("w1");
        let (id2, rx2) = p.register_for("w2");
        p.fail_window("w1", ApiError::new(ErrorCode::DocNotFound, "닫힘"));
        let err = p.wait(&id1, rx1, Duration::from_secs(1)).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::DocNotFound);
        assert!(p.resolve(&id2, Ok(json!(2))));
        assert_eq!(
            p.wait(&id2, rx2, Duration::from_secs(1)).await.unwrap(),
            json!(2)
        );
    }
}
