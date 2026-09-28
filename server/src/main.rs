mod api;
mod config;
mod error;
mod storage;

use std::sync::Arc;

use anyhow::Result;
use axum::{
    Router,
    http::{HeaderValue, header::CACHE_CONTROL},
};
use tower_http::{
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
};

#[tokio::main]
async fn main() -> Result<()> {
    opendal::install_default();
    let config = Arc::new(config::Config::from_env()?);
    let bind = config.bind;

    let index = config.ui_dir.join("index.html");
    let ui = Router::new()
        .fallback_service(ServeDir::new(&config.ui_dir).not_found_service(ServeFile::new(index)))
        .layer(SetResponseHeaderLayer::overriding(
            CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        ));
    let app = Router::new()
        .nest("/api", api::router(Arc::clone(&config)))
        .merge(ui);

    let roots: Vec<_> = config
        .nfs_roots
        .iter()
        .map(|root| root.logical.as_str())
        .collect();
    let regions = config.object_storage.as_ref().map(|s| s.regions.join(", "));
    println!("Lance File Internal Storage: http://{bind}");
    println!(
        "  NFS roots: {}",
        if roots.is_empty() {
            "none".to_owned()
        } else {
            roots.join(", ")
        }
    );
    println!(
        "  object storage regions: {}",
        regions.as_deref().unwrap_or("none")
    );
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
