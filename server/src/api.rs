use std::sync::Arc;

use axum::{
    Json, Router,
    body::Body,
    extract::{Query, State},
    http::{
        HeaderMap, HeaderValue, Response, StatusCode,
        header::{
            ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE,
        },
    },
    routing::get,
};
use serde::{Deserialize, Serialize};

use crate::{
    config::{Config, NfsRoot},
    error::{AppError, Result},
    storage::{self, Kind, Listing, Stat},
};

/// The viewer reads the footer, metadata and schema; nothing it needs comes near this in one request.
pub(crate) const MAX_RANGE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_LISTED_ENTRIES: usize = 10_000;

pub(crate) fn router(config: Arc<Config>) -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/config", get(client_config))
        .route("/stat", get(stat))
        .route("/list", get(list))
        .route("/raw", get(raw))
        .with_state(config)
}

/// What the browser needs to know: which locations it can type in.
#[derive(Serialize)]
struct ClientConfig {
    nfs_roots: Vec<NfsRoot>,
    object_storage_regions: Vec<String>,
}

async fn client_config(State(config): State<Arc<Config>>) -> Json<ClientConfig> {
    Json(ClientConfig {
        nfs_roots: config.nfs_roots.clone(),
        object_storage_regions: config
            .object_storage
            .as_ref()
            .map(|storage| storage.regions.clone())
            .unwrap_or_default(),
    })
}

#[derive(Deserialize)]
struct LocationQuery {
    uri: String,
    region: Option<String>,
}

async fn stat(
    State(config): State<Arc<Config>>,
    Query(query): Query<LocationQuery>,
) -> Result<Json<Stat>> {
    let location = storage::open(&config, query.uri.trim(), query.region.as_deref()).await?;
    Ok(Json(location.stat().await?))
}

async fn list(
    State(config): State<Arc<Config>>,
    Query(query): Query<LocationQuery>,
) -> Result<Json<Listing>> {
    let location = storage::open(&config, query.uri.trim(), query.region.as_deref()).await?;
    if location.stat().await?.kind != Kind::Directory {
        return Err(AppError::bad_request("not a directory"));
    }
    Ok(Json(location.list(MAX_LISTED_ENTRIES).await?))
}

/// Serves one byte range of a file, answering `Range` headers like a static file server.
async fn raw(
    State(config): State<Arc<Config>>,
    Query(query): Query<LocationQuery>,
    headers: HeaderMap,
) -> Result<Response<Body>> {
    let location = storage::open(&config, query.uri.trim(), query.region.as_deref()).await?;
    let stat = location.stat().await?;
    let total = match (stat.kind, stat.size) {
        (Kind::File, Some(size)) => size,
        _ => return Err(AppError::bad_request("not a file")),
    };
    let range = headers.get(RANGE).and_then(|value| value.to_str().ok());
    let Some((start, end)) = resolve_range(range, total) else {
        return range_not_satisfiable(total);
    };
    if end - start > MAX_RANGE_BYTES {
        return Err(AppError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            format!("ranges are limited to {MAX_RANGE_BYTES} bytes; send a Range header"),
        ));
    }
    let bytes = if end > start {
        location.read(start, end).await?
    } else {
        Default::default()
    };

    let mut response = Response::new(Body::from(bytes));
    let partial = range.is_some();
    *response.status_mut() = if partial {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };
    let out = response.headers_mut();
    out.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    out.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    out.insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    out.insert(CONTENT_LENGTH, HeaderValue::from(end - start));
    if partial {
        let value = format!("bytes {start}-{}/{total}", end.saturating_sub(1));
        out.insert(
            CONTENT_RANGE,
            HeaderValue::from_str(&value).expect("digits are valid header text"),
        );
    }
    Ok(response)
}

/// Parses a single `bytes=a-b`, `bytes=a-` or `bytes=-n` range into `start..end`; `None` if unsatisfiable.
pub(crate) fn resolve_range(value: Option<&str>, total: u64) -> Option<(u64, u64)> {
    let Some(value) = value else {
        return Some((0, total));
    };
    let spec = value.strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    if start.is_empty() {
        let suffix: u64 = end.parse().ok()?;
        return (suffix > 0 && total > 0).then(|| (total.saturating_sub(suffix), total));
    }
    let start: u64 = start.parse().ok()?;
    if start >= total {
        return None;
    }
    let end = if end.is_empty() {
        total
    } else {
        let inclusive: u64 = end.parse().ok()?;
        if inclusive < start {
            return None;
        }
        inclusive.min(total - 1) + 1
    };
    Some((start, end))
}

fn range_not_satisfiable(total: u64) -> Result<Response<Body>> {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::RANGE_NOT_SATISFIABLE;
    let value =
        HeaderValue::from_str(&format!("bytes */{total}")).expect("digits are valid header text");
    response.headers_mut().insert(CONTENT_RANGE, value);
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::parse_nfs_roots;

    #[test]
    fn resolves_the_ranges_the_viewer_sends() {
        assert_eq!(
            resolve_range(Some("bytes=-512"), 10_000),
            Some((9_488, 10_000))
        );
        assert_eq!(resolve_range(Some("bytes=-512"), 100), Some((0, 100)));
        assert_eq!(resolve_range(Some("bytes=10-19"), 100), Some((10, 20)));
        assert_eq!(resolve_range(Some("bytes=90-200"), 100), Some((90, 100)));
        assert_eq!(resolve_range(Some("bytes=10-"), 100), Some((10, 100)));
        assert_eq!(resolve_range(None, 100), Some((0, 100)));
        assert_eq!(resolve_range(Some("bytes=100-"), 100), None);
        assert_eq!(resolve_range(Some("bytes=0-1,5-6"), 100), None);
        assert_eq!(resolve_range(Some("items=0-1"), 100), None);
    }

    #[tokio::test]
    async fn serves_nfs_byte_ranges_over_http() {
        let temporary = tempfile::tempdir().unwrap();
        tokio::fs::write(temporary.path().join("f.lance"), b"0123456789")
            .await
            .unwrap();
        let config = Arc::new(Config {
            bind: "127.0.0.1:0".parse().unwrap(),
            ui_dir: temporary.path().to_owned(),
            nfs_roots: parse_nfs_roots(&format!("/mnt/shared={}", temporary.path().display()))
                .unwrap(),
            object_storage: None,
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server =
            tokio::spawn(async move { axum::serve(listener, router(config)).await.unwrap() });
        let client = reqwest::Client::new();
        let url = format!("http://{address}/raw?uri=%2Fmnt%2Fshared%2Ff.lance");

        let response = client
            .get(&url)
            .header("Range", "bytes=-4")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()[CONTENT_RANGE], "bytes 6-9/10");
        assert_eq!(response.bytes().await.unwrap().as_ref(), b"6789");

        let response = client
            .get(format!("http://{address}/raw?uri=s3%3A%2F%2Fb%2Fk"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response.text().await.unwrap(),
            r#"{"error":"object storage is not configured on this server"}"#
        );
        server.abort();
    }
}
