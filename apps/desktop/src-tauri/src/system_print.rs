use tauri::WebviewWindow;

#[cfg(target_os = "linux")]
use futures_channel::oneshot;
#[cfg(target_os = "linux")]
use std::{cell::RefCell, rc::Rc};
#[cfg(target_os = "linux")]
use webkit2gtk::{PrintOperation, PrintOperationExt, PrintOperationResponse};

#[cfg(target_os = "linux")]
const PRINT_COMPLETION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5 * 60);

#[cfg(target_os = "linux")]
struct PrintState {
    completion: Option<oneshot::Sender<Result<(), String>>>,
    failure: Option<String>,
    keepalive: Option<PrintOperation>,
    watchdog: Option<gtk::glib::SourceId>,
}

#[cfg(target_os = "linux")]
type SharedPrintState = Rc<RefCell<PrintState>>;

#[cfg(target_os = "linux")]
pub async fn print_current_webview(window: WebviewWindow) -> Result<(), String> {
    print_linux_webview(window).await
}

#[cfg(not(target_os = "linux"))]
pub async fn print_current_webview(window: WebviewWindow) -> Result<(), String> {
    window
        .print()
        .map_err(|error| format!("시스템 인쇄 UI를 열 수 없습니다: {error}"))
}

#[cfg(target_os = "linux")]
async fn print_linux_webview(window: WebviewWindow) -> Result<(), String> {
    let (completion_tx, completion_rx) = oneshot::channel::<Result<(), String>>();
    let parent_window = window.clone();
    window
        .with_webview(move |platform_webview| {
            open_linux_print_dialog(platform_webview.inner(), parent_window, completion_tx);
        })
        .map_err(|error| format!("시스템 인쇄 UI를 열 수 없습니다: {error}"))?;

    completion_rx
        .await
        .map_err(|_| "시스템 인쇄 완료 신호를 받지 못했습니다".to_string())?
}

#[cfg(target_os = "linux")]
fn open_linux_print_dialog(
    webview: webkit2gtk::WebView,
    parent_window: WebviewWindow,
    completion: oneshot::Sender<Result<(), String>>,
) {
    let parent = match parent_window.gtk_window() {
        Ok(parent) => parent,
        Err(error) => {
            let _ = completion.send(Err(format!(
                "시스템 인쇄 대화상자 parent를 가져올 수 없습니다: {error}"
            )));
            return;
        }
    };
    let operation = PrintOperation::new(&webview);
    // `run_dialog` returns before WebKit finishes painting and spooling. Retain
    // the operation until `finished` or the watchdog settles the native job.
    let state = Rc::new(RefCell::new(PrintState {
        completion: Some(completion),
        failure: None,
        keepalive: Some(operation.clone()),
        watchdog: None,
    }));
    connect_print_signals(&operation, &state);

    match operation.run_dialog(Some(&parent)) {
        PrintOperationResponse::Print => arm_print_watchdog(&state),
        PrintOperationResponse::Cancel => settle_print(&state, Ok(()), false),
        response => settle_print(
            &state,
            Err(format!("알 수 없는 시스템 인쇄 응답: {response:?}")),
            false,
        ),
    }
}

#[cfg(target_os = "linux")]
fn connect_print_signals(operation: &PrintOperation, state: &SharedPrintState) {
    let state_for_signal = Rc::clone(state);
    operation.connect_failed(move |_, error| {
        state_for_signal.borrow_mut().failure = Some(error.to_string());
    });
    let state_for_signal = Rc::clone(state);
    operation.connect_finished(move |_| {
        let result = state_for_signal
            .borrow_mut()
            .failure
            .take()
            .map_or(Ok(()), |error| Err(format!("시스템 인쇄 실패: {error}")));
        settle_print(&state_for_signal, result, false);
    });
}

#[cfg(target_os = "linux")]
fn arm_print_watchdog(state: &SharedPrintState) {
    if state.borrow().completion.is_none() {
        return;
    }
    let weak_state = Rc::downgrade(state);
    let watchdog = gtk::glib::timeout_add_local_once(PRINT_COMPLETION_TIMEOUT, move || {
        if let Some(state) = weak_state.upgrade() {
            settle_print(
                &state,
                Err("시스템 인쇄 완료 대기 시간이 5분을 초과했습니다".to_string()),
                true,
            );
        }
    });
    state.borrow_mut().watchdog = Some(watchdog);
}

#[cfg(target_os = "linux")]
fn settle_print(state: &SharedPrintState, result: Result<(), String>, timed_out: bool) {
    let (completion, watchdog) = {
        let mut state = state.borrow_mut();
        let completion = state.completion.take();
        state.keepalive.take();
        (completion, state.watchdog.take())
    };
    if !timed_out {
        if let Some(watchdog) = watchdog {
            watchdog.remove();
        }
    }
    if let Some(completion) = completion {
        let _ = completion.send(result);
    }
}
