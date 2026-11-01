use serde::{Deserialize, Serialize};
use std::fmt;
pub(crate) const WINDOWS_X64_NSIS_TARGET: &str = "windows-x86_64-nsis";
pub(crate) const WINDOWS_X64_MSI_TARGET: &str = "windows-x86_64-msi";
pub(crate) const LINUX_X64_APPIMAGE_TARGET: &str = "linux-x86_64-appimage";
pub(crate) const DARWIN_AARCH64_TARGET: &str = "darwin-aarch64";
pub(crate) const DARWIN_X64_TARGET: &str = "darwin-x86_64";
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum UpdaterStatus {
    Idle,
    Checking,
    Available,
    Downloading,
    Installing,
    RestartRequired,
    Error,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum UpdaterTrigger {
    Startup,
    Manual,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ArtifactKind {
    Msi,
    Nsis,
    AppImage,
    MacAppAarch64,
    MacAppX64,
}
impl ArtifactKind {
    pub(crate) fn target(self) -> &'static str {
        match self {
            Self::Msi => WINDOWS_X64_MSI_TARGET,
            Self::Nsis => WINDOWS_X64_NSIS_TARGET,
            Self::AppImage => LINUX_X64_APPIMAGE_TARGET,
            Self::MacAppAarch64 => DARWIN_AARCH64_TARGET,
            Self::MacAppX64 => DARWIN_X64_TARGET,
        }
    }
    /// 설치 뒤 앱을 다시 띄워야 하는 형식(Windows 설치 프로그램은 스스로 앱을 다시 띄운다).
    pub(crate) fn needs_restart(self) -> bool {
        matches!(self, Self::AppImage | Self::MacAppAarch64 | Self::MacAppX64)
    }
    pub(crate) fn accepts_asset_path(self, path: &str) -> bool {
        let file_name = path.rsplit('/').next().unwrap_or(path);
        match self {
            Self::Msi => file_name.to_ascii_lowercase().ends_with("_x64_en-us.msi"),
            Self::Nsis => file_name.to_ascii_lowercase().ends_with("_x64-setup.exe"),
            Self::AppImage => file_name.ends_with("_amd64.AppImage"),
            Self::MacAppAarch64 => file_name.ends_with("_aarch64.app.tar.gz"),
            Self::MacAppX64 => file_name.ends_with("_x64.app.tar.gz"),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdaterTarget {
    pub target: String,
    pub artifact_kind: ArtifactKind,
}
impl UpdaterTarget {
    pub(crate) fn for_kind(artifact_kind: ArtifactKind) -> Self {
        Self {
            target: artifact_kind.target().to_string(),
            artifact_kind,
        }
    }
    pub(crate) fn accepts_asset_path(&self, path: &str) -> bool {
        self.target == self.artifact_kind.target() && self.artifact_kind.accepts_asset_path(path)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdaterProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub percent: Option<u8>,
}
impl UpdaterProgress {
    fn new(downloaded_bytes: u64, total_bytes: Option<u64>) -> Result<Self, StateError> {
        if total_bytes.is_some_and(|total| downloaded_bytes > total) {
            return Err(StateError::InvalidProgress);
        }
        let percent = total_bytes
            .filter(|total| *total > 0)
            .map(|total| ((downloaded_bytes.saturating_mul(100) / total).min(100)) as u8);
        Ok(Self {
            downloaded_bytes,
            total_bytes,
            percent,
        })
    }
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum UpdaterBlocker {
    DirtyDocuments,
    UnsupportedInstall,
    ReadOnlyAppImage,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdaterFailure {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdaterSnapshot {
    pub status: UpdaterStatus,
    pub trigger: Option<UpdaterTrigger>,
    pub operation_id: Option<u64>,
    pub current_version: Option<String>,
    pub available_version: Option<String>,
    pub target: Option<UpdaterTarget>,
    pub release_notes: Option<String>,
    pub progress: Option<UpdaterProgress>,
    pub blocker: Option<UpdaterBlocker>,
    pub failure: Option<UpdaterFailure>,
    pub manual_downloads_url: Option<String>,
}
impl Default for UpdaterSnapshot {
    fn default() -> Self {
        Self {
            status: UpdaterStatus::Idle,
            trigger: None,
            operation_id: None,
            current_version: None,
            available_version: None,
            target: None,
            release_notes: None,
            progress: None,
            blocker: None,
            failure: None,
            manual_downloads_url: None,
        }
    }
}
#[derive(Debug, Default)]
pub(crate) struct UpdaterState {
    snapshot: UpdaterSnapshot,
    next_operation_id: u64,
}
impl UpdaterState {
    pub(crate) fn manual_only(blocker: UpdaterBlocker, downloads_url: String) -> Self {
        let snapshot = UpdaterSnapshot {
            blocker: Some(blocker),
            manual_downloads_url: Some(downloads_url),
            ..UpdaterSnapshot::default()
        };
        Self {
            snapshot,
            next_operation_id: 0,
        }
    }
    pub(crate) fn snapshot(&self) -> UpdaterSnapshot {
        self.snapshot.clone()
    }
    pub(crate) fn begin_check(&mut self, trigger: UpdaterTrigger) -> Result<u64, StateError> {
        if matches!(
            self.snapshot.status,
            UpdaterStatus::Checking
                | UpdaterStatus::Downloading
                | UpdaterStatus::Installing
                | UpdaterStatus::RestartRequired
        ) {
            return Err(StateError::Busy(self.snapshot.status));
        }
        self.next_operation_id = self.next_operation_id.saturating_add(1);
        self.snapshot = UpdaterSnapshot {
            status: UpdaterStatus::Checking,
            trigger: Some(trigger),
            operation_id: Some(self.next_operation_id),
            ..UpdaterSnapshot::default()
        };
        Ok(self.next_operation_id)
    }
    pub(crate) fn mark_no_update(
        &mut self,
        operation_id: u64,
        current_version: String,
    ) -> Result<(), StateError> {
        self.ensure(operation_id, UpdaterStatus::Checking)?;
        self.snapshot.status = UpdaterStatus::Idle;
        self.snapshot.current_version = Some(current_version);
        Ok(())
    }
    pub(crate) fn mark_available(
        &mut self,
        operation_id: u64,
        current_version: String,
        available_version: String,
        target: UpdaterTarget,
        release_notes: Option<String>,
    ) -> Result<(), StateError> {
        self.ensure(operation_id, UpdaterStatus::Checking)?;
        self.snapshot.status = UpdaterStatus::Available;
        self.snapshot.current_version = Some(current_version);
        self.snapshot.available_version = Some(available_version);
        self.snapshot.target = Some(target);
        self.snapshot.release_notes = release_notes;
        Ok(())
    }
    pub(crate) fn begin_download(&mut self, operation_id: u64) -> Result<(), StateError> {
        self.ensure(operation_id, UpdaterStatus::Available)?;
        self.snapshot.status = UpdaterStatus::Downloading;
        self.snapshot.blocker = None;
        self.snapshot.progress = Some(UpdaterProgress::new(0, None)?);
        Ok(())
    }
    pub(crate) fn update_progress(
        &mut self,
        operation_id: u64,
        downloaded_bytes: u64,
        total_bytes: Option<u64>,
    ) -> Result<(), StateError> {
        self.ensure(operation_id, UpdaterStatus::Downloading)?;
        if self
            .snapshot
            .progress
            .as_ref()
            .is_some_and(|progress| downloaded_bytes < progress.downloaded_bytes)
        {
            return Err(StateError::InvalidProgress);
        }
        self.snapshot.progress = Some(UpdaterProgress::new(downloaded_bytes, total_bytes)?);
        Ok(())
    }
    pub(crate) fn block_apply(
        &mut self,
        operation_id: u64,
        blocker: UpdaterBlocker,
    ) -> Result<(), StateError> {
        self.ensure_one_of(
            operation_id,
            &[UpdaterStatus::Available, UpdaterStatus::Downloading],
        )?;
        self.snapshot.status = UpdaterStatus::Available;
        self.snapshot.blocker = Some(blocker);
        self.snapshot.progress = None;
        Ok(())
    }
    pub(crate) fn begin_install(&mut self, operation_id: u64) -> Result<(), StateError> {
        self.ensure(operation_id, UpdaterStatus::Downloading)?;
        self.snapshot.status = UpdaterStatus::Installing;
        Ok(())
    }
    pub(crate) fn mark_restart_required(&mut self, operation_id: u64) -> Result<(), StateError> {
        self.ensure(operation_id, UpdaterStatus::Installing)?;
        self.snapshot.status = UpdaterStatus::RestartRequired;
        Ok(())
    }
    pub(crate) fn fail(
        &mut self,
        operation_id: u64,
        failure: UpdaterFailure,
    ) -> Result<(), StateError> {
        self.ensure_one_of(
            operation_id,
            &[
                UpdaterStatus::Checking,
                UpdaterStatus::Available,
                UpdaterStatus::Downloading,
                UpdaterStatus::Installing,
            ],
        )?;
        self.snapshot.status = UpdaterStatus::Error;
        self.snapshot.progress = None;
        self.snapshot.failure = Some(failure);
        Ok(())
    }
    fn ensure(&self, operation_id: u64, status: UpdaterStatus) -> Result<(), StateError> {
        self.ensure_one_of(operation_id, &[status])
    }
    fn ensure_one_of(
        &self,
        operation_id: u64,
        statuses: &[UpdaterStatus],
    ) -> Result<(), StateError> {
        self.ensure_operation(operation_id)?;
        if statuses.contains(&self.snapshot.status) {
            Ok(())
        } else {
            Err(StateError::InvalidTransition(self.snapshot.status))
        }
    }
    fn ensure_operation(&self, operation_id: u64) -> Result<(), StateError> {
        if self.snapshot.operation_id == Some(operation_id) {
            Ok(())
        } else {
            Err(StateError::StaleOperation)
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StateError {
    Busy(UpdaterStatus),
    StaleOperation,
    InvalidTransition(UpdaterStatus),
    InvalidProgress,
}
impl fmt::Display for StateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "updater state transition rejected: {self:?}")
    }
}
impl std::error::Error for StateError {}
