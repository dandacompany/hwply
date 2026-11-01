use super::{ServiceError, UpdaterEventSink, UpdaterService};
use crate::updater::model::{
    ArtifactKind, StateError, UpdaterBlocker, UpdaterSnapshot, UpdaterStatus,
};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

impl UpdaterService {
    pub(crate) async fn apply<F>(
        &self,
        has_dirty_sessions: F,
        sink: Arc<dyn UpdaterEventSink>,
    ) -> Result<UpdaterSnapshot, ServiceError>
    where
        F: Fn() -> bool + Send + Sync,
    {
        let _operation = self.acquire()?;
        let operation_id = self
            .snapshot()
            .operation_id
            .ok_or(ServiceError::state(StateError::StaleOperation))?;
        if has_dirty_sessions() {
            return self.block_dirty(operation_id, &sink);
        }
        let update = self
            .inner
            .pending
            .lock()
            .expect("pending update poisoned")
            .take()
            .ok_or(ServiceError::state(StateError::InvalidTransition(
                UpdaterStatus::Available,
            )))?;
        self.inner
            .state
            .lock()
            .expect("updater state poisoned")
            .begin_download(operation_id)
            .map_err(ServiceError::state)?;
        self.publish(&sink);
        let downloaded = Arc::new(AtomicU64::new(0));
        let progress_service = self.clone();
        let progress_sink = sink.clone();
        let progress_counter = downloaded.clone();
        let on_chunk = Arc::new(move |chunk: usize, total: Option<u64>| {
            let previous = progress_counter.fetch_add(chunk as u64, Ordering::Relaxed);
            let value = previous.saturating_add(chunk as u64);
            progress_service.record_progress(operation_id, value, total, &progress_sink);
        });
        let bytes = match update.download(on_chunk).await {
            Ok(bytes) => bytes,
            Err(error) => return self.fail(operation_id, error, &sink),
        };
        if has_dirty_sessions() {
            self.inner
                .pending
                .lock()
                .expect("pending update poisoned")
                .replace(update);
            return self.block_dirty(operation_id, &sink);
        }
        self.inner
            .state
            .lock()
            .expect("updater state poisoned")
            .begin_install(operation_id)
            .map_err(ServiceError::state)?;
        self.publish(&sink);
        if let Err(error) = update.install(&bytes) {
            return self.fail(operation_id, error, &sink);
        }
        if [ArtifactKind::AppImage, ArtifactKind::MacAppAarch64, ArtifactKind::MacAppX64]
            .iter()
            .any(|kind| kind.needs_restart() && update.metadata().target == kind.target())
        {
            self.inner
                .state
                .lock()
                .expect("updater state poisoned")
                .mark_restart_required(operation_id)
                .map_err(ServiceError::state)?;
        }
        Ok(self.publish(&sink))
    }

    pub(crate) fn prepare_restart(&self) -> Result<(), ServiceError> {
        let _operation = self.acquire()?;
        let status = self.snapshot().status;
        if status != UpdaterStatus::RestartRequired {
            return Err(ServiceError::state(StateError::InvalidTransition(status)));
        }
        Ok(())
    }

    fn block_dirty(
        &self,
        operation_id: u64,
        sink: &Arc<dyn UpdaterEventSink>,
    ) -> Result<UpdaterSnapshot, ServiceError> {
        self.inner
            .state
            .lock()
            .expect("updater state poisoned")
            .block_apply(operation_id, UpdaterBlocker::DirtyDocuments)
            .map_err(ServiceError::state)?;
        Ok(self.publish(sink))
    }

    fn record_progress(
        &self,
        operation_id: u64,
        downloaded: u64,
        total: Option<u64>,
        sink: &Arc<dyn UpdaterEventSink>,
    ) {
        let result = self
            .inner
            .state
            .lock()
            .expect("updater state poisoned")
            .update_progress(operation_id, downloaded, total);
        if result.is_ok() {
            self.publish(sink);
        }
    }
}
