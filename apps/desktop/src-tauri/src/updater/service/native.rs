use super::{
    BackendError, BackendFuture, CheckOutcome, UpdateMetadata, UpdatePackage, UpdaterBackend,
};
use crate::updater::model::UpdaterTarget;
use std::{sync::Arc, time::Duration};
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};

const UPDATER_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

pub(crate) struct NativeUpdaterBackend {
    app: AppHandle,
    target: UpdaterTarget,
}

impl NativeUpdaterBackend {
    pub(crate) fn new(app: AppHandle, target: UpdaterTarget) -> Self {
        Self { app, target }
    }
}

impl UpdaterBackend for NativeUpdaterBackend {
    fn check(&self) -> BackendFuture<'_, CheckOutcome> {
        Box::pin(async move {
            let updater = self
                .app
                .updater_builder()
                .target(self.target.target.clone())
                .timeout(UPDATER_REQUEST_TIMEOUT)
                .build()
                .map_err(|_| BackendError::Check)?;
            let current_version = self.app.package_info().version.to_string();
            let update = updater
                .check()
                .await
                .map_err(|_| BackendError::Check)?
                .map(|update| Box::new(NativeUpdate::new(update)) as Box<dyn UpdatePackage>);
            Ok(CheckOutcome {
                current_version,
                update,
            })
        })
    }
}

struct NativeUpdate {
    update: Update,
    metadata: UpdateMetadata,
}

impl NativeUpdate {
    fn new(mut update: Update) -> Self {
        // tauri-plugin-updater 2.10 does not propagate UpdaterBuilder::timeout
        // to the Update returned by check(), so bind the download separately.
        update.timeout = Some(UPDATER_REQUEST_TIMEOUT);
        let metadata = UpdateMetadata {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            target: update.target.clone(),
            asset_path: update.download_url.path().to_string(),
            secure_download: update.download_url.scheme() == "https",
            release_notes: update.body.clone(),
        };
        Self { update, metadata }
    }
}

impl UpdatePackage for NativeUpdate {
    fn metadata(&self) -> &UpdateMetadata {
        &self.metadata
    }

    fn download<'a>(
        &'a self,
        on_chunk: Arc<dyn Fn(usize, Option<u64>) + Send + Sync>,
    ) -> BackendFuture<'a, Vec<u8>> {
        Box::pin(async move {
            self.update
                .download(move |chunk, total| on_chunk(chunk, total), || {})
                .await
                .map_err(|_| BackendError::Download)
        })
    }

    fn install(&self, bytes: &[u8]) -> Result<(), BackendError> {
        self.update
            .install(bytes)
            .map_err(|_| BackendError::Install)
    }
}
