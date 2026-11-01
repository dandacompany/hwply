use tauri::{AppHandle, Manager};

pub(crate) const MIN_EDITOR_WINDOW_WIDTH: f64 = 960.0;
pub(crate) const MIN_EDITOR_WINDOW_HEIGHT: f64 = 720.0;
pub(crate) const NEW_WINDOW_WORK_AREA_MARGIN: f64 = 24.0;
const NEW_WINDOW_PREFERRED_WIDTH: f64 = 1100.0;
const NEW_WINDOW_PREFERRED_HEIGHT: f64 = 760.0;
const NEW_WINDOW_MAX_WORK_AREA_RATIO: f64 = 0.85;
const NEW_WINDOW_FRAME_HEIGHT_RESERVE: f64 = 72.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct NewWindowGeometry {
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) min_width: f64,
    pub(crate) min_height: f64,
    pub(crate) position: Option<(f64, f64)>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct LogicalWorkArea {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

pub(crate) fn new_window_geometry(app: &AppHandle) -> NewWindowGeometry {
    new_window_geometry_for_work_area(active_monitor_logical_work_area(app))
}

fn new_window_geometry_for_work_area(work_area: Option<LogicalWorkArea>) -> NewWindowGeometry {
    let Some(work_area) = work_area else {
        return NewWindowGeometry {
            width: NEW_WINDOW_PREFERRED_WIDTH,
            height: NEW_WINDOW_PREFERRED_HEIGHT,
            min_width: MIN_EDITOR_WINDOW_WIDTH,
            min_height: MIN_EDITOR_WINDOW_HEIGHT,
            position: None,
        };
    };

    let usable_width = (work_area.width - NEW_WINDOW_WORK_AREA_MARGIN * 2.0).max(1.0);
    let usable_height =
        (work_area.height - NEW_WINDOW_WORK_AREA_MARGIN * 2.0 - NEW_WINDOW_FRAME_HEIGHT_RESERVE)
            .max(1.0);
    let max_width = (usable_width * NEW_WINDOW_MAX_WORK_AREA_RATIO).floor();
    let max_height = (usable_height * NEW_WINDOW_MAX_WORK_AREA_RATIO).floor();

    let width = clamped_dimension(
        NEW_WINDOW_PREFERRED_WIDTH,
        MIN_EDITOR_WINDOW_WIDTH,
        max_width,
    );
    let height = clamped_dimension(
        NEW_WINDOW_PREFERRED_HEIGHT,
        MIN_EDITOR_WINDOW_HEIGHT,
        max_height,
    );
    let min_width = MIN_EDITOR_WINDOW_WIDTH.min(width);
    let min_height = MIN_EDITOR_WINDOW_HEIGHT.min(height);
    let position = Some(centered_position(work_area, width, height));

    NewWindowGeometry {
        width,
        height,
        min_width,
        min_height,
        position,
    }
}

fn centered_position(work_area: LogicalWorkArea, width: f64, height: f64) -> (f64, f64) {
    (
        work_area.x + ((work_area.width - width) / 2.0).max(NEW_WINDOW_WORK_AREA_MARGIN),
        work_area.y
            + ((work_area.height - height - NEW_WINDOW_FRAME_HEIGHT_RESERVE) / 2.0)
                .max(NEW_WINDOW_WORK_AREA_MARGIN),
    )
}

fn active_monitor_logical_work_area(app: &AppHandle) -> Option<LogicalWorkArea> {
    #[cfg(target_os = "linux")]
    {
        // Tauri 2.10 converts its GTK monitor handle on the calling thread.
        // Keep GDK access (including workarea()) on the GTK main thread; only
        // the plain logical rectangle may cross back to the window worker.
        // Callers must run on a non-main worker because waiting here on the GTK
        // main thread would deadlock the queued callback below.
        let (sender, receiver) = std::sync::mpsc::channel();
        let main_thread_app = app.clone();
        app.run_on_main_thread(move || {
            let _ = sender.send(read_active_monitor_logical_work_area(&main_thread_app));
        })
        .ok()?;
        receiver.recv().ok().flatten()
    }
    #[cfg(not(target_os = "linux"))]
    read_active_monitor_logical_work_area(app)
}

fn read_active_monitor_logical_work_area(app: &AppHandle) -> Option<LogicalWorkArea> {
    let monitor = crate::windows::target_window_label(app)
        .and_then(|label| app.get_webview_window(&label))
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let scale_factor = monitor.scale_factor();
    if scale_factor <= 0.0 {
        return None;
    }
    let work_area = monitor.work_area();
    Some(LogicalWorkArea {
        x: f64::from(work_area.position.x) / scale_factor,
        y: f64::from(work_area.position.y) / scale_factor,
        width: f64::from(work_area.size.width) / scale_factor,
        height: f64::from(work_area.size.height) / scale_factor,
    })
}

fn clamped_dimension(preferred: f64, min: f64, max: f64) -> f64 {
    if max <= 0.0 {
        return preferred.max(min);
    }
    preferred.min(max).max(min.min(max))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamped_dimension_prefers_default_within_work_area() {
        assert_eq!(clamped_dimension(1100.0, 960.0, 1400.0), 1100.0);
    }

    #[test]
    fn clamped_dimension_caps_to_work_area() {
        assert_eq!(clamped_dimension(1100.0, 960.0, 1000.0), 1000.0);
    }

    #[test]
    fn clamped_dimension_keeps_minimum_on_small_screens() {
        assert_eq!(clamped_dimension(1100.0, 720.0, 578.0), 578.0);
    }

    #[test]
    fn geometry_uses_work_area_size_and_position() {
        let geometry = new_window_geometry_for_work_area(Some(LogicalWorkArea {
            x: 1200.0,
            y: 40.0,
            width: 1600.0,
            height: 1000.0,
        }));

        assert_eq!(geometry.width, 1100.0);
        assert_eq!(geometry.height, 748.0);
        assert_eq!(geometry.min_width, 960.0);
        assert_eq!(geometry.min_height, 720.0);
        assert_eq!(geometry.position, Some((1450.0, 130.0)));
    }

    #[test]
    fn geometry_stays_inside_small_work_area() {
        let geometry = new_window_geometry_for_work_area(Some(LogicalWorkArea {
            x: 0.0,
            y: 0.0,
            width: 1024.0,
            height: 680.0,
        }));

        assert_eq!(geometry.width, 829.0);
        assert_eq!(geometry.height, 476.0);
        assert_eq!(geometry.min_width, 829.0);
        assert_eq!(geometry.min_height, 476.0);
        assert_eq!(geometry.position, Some((97.5, 66.0)));
    }

    #[test]
    fn geometry_falls_back_without_monitor_data() {
        assert_eq!(
            new_window_geometry_for_work_area(None),
            NewWindowGeometry {
                width: 1100.0,
                height: 760.0,
                min_width: 960.0,
                min_height: 720.0,
                position: None,
            }
        );
    }
}
