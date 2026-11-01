//! 에이전트 브리지: 루프백 HTTP 로 들어온 요청을 문서 창에 전달한다(스펙 §8).

pub mod backend;
pub mod discovery;
pub mod http;
pub mod hub;
pub mod pending;
pub mod protocol;
pub mod registry;
pub mod staging;
pub mod tauri_port;
