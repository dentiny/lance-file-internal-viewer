use std::path::PathBuf;

use bytes::Bytes;
use futures::TryStreamExt;
use opendal::{
    EntryMode, Operator,
    layers::{RetryLayer, TimeoutLayer},
    services::S3,
};
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::{
    config::{Config, NfsRoot},
    error::{AppError, Result},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Kind {
    File,
    Directory,
}

#[derive(Debug, Serialize)]
pub(crate) struct Stat {
    pub(crate) kind: Kind,
    pub(crate) size: Option<u64>,
}

#[derive(Debug, Serialize)]
pub(crate) struct Entry {
    pub(crate) name: String,
    /// The entry's own URI, in the form the user typed its parent.
    pub(crate) uri: String,
    pub(crate) kind: Kind,
    pub(crate) size: Option<u64>,
}

#[derive(Debug, Serialize)]
pub(crate) struct Listing {
    pub(crate) entries: Vec<Entry>,
    pub(crate) truncated: bool,
}

/// A file or directory the server has checked it may read.
pub(crate) enum Location {
    Nfs {
        path: PathBuf,
        uri: String,
    },
    Object {
        store: Operator,
        /// `s3://bucket` or `oci://bucket`, for building child URIs.
        base: String,
        key: String,
    },
}

pub(crate) fn is_object_uri(uri: &str) -> bool {
    uri.starts_with("s3://") || uri.starts_with("oci://")
}

pub(crate) async fn open(config: &Config, uri: &str, region: Option<&str>) -> Result<Location> {
    if is_object_uri(uri) {
        open_object(config, uri, region)
    } else if uri.starts_with('/') {
        open_nfs(&config.nfs_roots, uri).await
    } else {
        Err(AppError::bad_request(
            "expected s3://bucket/key, oci://bucket/key or an absolute NFS path",
        ))
    }
}

fn open_object(config: &Config, uri: &str, region: Option<&str>) -> Result<Location> {
    let storage = config
        .object_storage
        .as_ref()
        .ok_or_else(|| AppError::unavailable("object storage is not configured on this server"))?;
    let region = match region.filter(|r| !r.is_empty()) {
        Some(region) if storage.regions.iter().any(|r| r == region) => region,
        Some(region) => {
            return Err(AppError::bad_request(format!(
                "unsupported region {region:?}"
            )));
        }
        None => storage.regions[0].as_str(),
    };
    let (scheme, rest) = uri.split_once("://").expect("object URIs have a scheme");
    let (bucket, key) = rest.split_once('/').unwrap_or((rest, ""));
    if bucket.is_empty() {
        return Err(AppError::bad_request(
            "object storage URI must include a bucket",
        ));
    }
    let key = key.trim_start_matches('/');
    if key.split('/').any(|part| part == "." || part == "..") {
        return Err(AppError::bad_request(
            "object key cannot contain '.' or '..' components",
        ));
    }
    let mut builder = S3::default().bucket(bucket).root("/").region(region);
    if let Some(endpoint) = storage.endpoint(region) {
        builder = builder.endpoint(&endpoint);
    }
    let store = Operator::new(builder)?
        .layer(TimeoutLayer::default())
        .layer(RetryLayer::default());
    Ok(Location::Object {
        store,
        base: format!("{scheme}://{bucket}"),
        key: key.to_owned(),
    })
}

/// Maps a user-visible path onto its mount, rejecting `..`, symbolic links and anything outside the roots.
async fn open_nfs(roots: &[NfsRoot], uri: &str) -> Result<Location> {
    let trimmed = uri.trim_end_matches('/');
    let trimmed = if trimmed.is_empty() { "/" } else { trimmed };
    let root = roots
        .iter()
        .filter(|root| {
            root.logical == "/"
                || trimmed == root.logical
                || trimmed.starts_with(&format!("{}/", root.logical))
        })
        .max_by_key(|root| root.logical.len())
        .ok_or_else(|| {
            AppError::bad_request(format!("{uri:?} is not under a configured NFS root"))
        })?;
    let relative = trimmed
        .strip_prefix(&root.logical)
        .unwrap_or_default()
        .trim_start_matches('/');
    let parts: Vec<&str> = if relative.is_empty() {
        Vec::new()
    } else {
        relative.split('/').collect()
    };
    if parts
        .iter()
        .any(|part| part.is_empty() || *part == "." || *part == "..")
    {
        return Err(AppError::bad_request(
            "path cannot contain empty, '.' or '..' components",
        ));
    }
    let allowed = tokio::fs::canonicalize(&root.mount)
        .await
        .map_err(|error| {
            AppError::unavailable(format!("NFS root {:?} is unavailable: {error}", root.mount))
        })?;
    let mut path = allowed.clone();
    for part in parts {
        path.push(part);
        if tokio::fs::symlink_metadata(&path)
            .await?
            .file_type()
            .is_symlink()
        {
            return Err(AppError::bad_request("symbolic links are not followed"));
        }
    }
    if !tokio::fs::canonicalize(&path).await?.starts_with(&allowed) {
        return Err(AppError::bad_request("path resolves outside the NFS root"));
    }
    Ok(Location::Nfs {
        path,
        uri: trimmed.to_owned(),
    })
}

fn child_uri(parent: &str, name: &str) -> String {
    format!("{}/{name}", parent.trim_end_matches('/'))
}

impl Location {
    pub(crate) async fn stat(&self) -> Result<Stat> {
        match self {
            Location::Nfs { path, .. } => {
                let metadata = tokio::fs::metadata(path).await?;
                if metadata.is_dir() {
                    Ok(Stat {
                        kind: Kind::Directory,
                        size: None,
                    })
                } else if metadata.is_file() {
                    Ok(Stat {
                        kind: Kind::File,
                        size: Some(metadata.len()),
                    })
                } else {
                    Err(AppError::bad_request("not a regular file or directory"))
                }
            }
            Location::Object { store, key, .. } => {
                let file = key.trim_end_matches('/');
                if !file.is_empty() && !key.ends_with('/') {
                    match store.stat(file).await {
                        Ok(metadata) if metadata.mode() == EntryMode::FILE => {
                            return Ok(Stat {
                                kind: Kind::File,
                                size: Some(metadata.content_length()),
                            });
                        }
                        Ok(_) => {}
                        Err(error) if error.kind() == opendal::ErrorKind::NotFound => {}
                        Err(error) => return Err(error.into()),
                    }
                }
                // Object stores have no directories; a prefix with objects under it counts as one.
                let prefix = if file.is_empty() {
                    String::new()
                } else {
                    format!("{file}/")
                };
                let mut children = store.lister_with(&prefix).limit(1).await?;
                if file.is_empty() || children.try_next().await?.is_some() {
                    Ok(Stat {
                        kind: Kind::Directory,
                        size: None,
                    })
                } else {
                    Err(AppError::not_found(format!("no object or prefix {key:?}")))
                }
            }
        }
    }

    /// Reads bytes `start..end` of a file.
    pub(crate) async fn read(&self, start: u64, end: u64) -> Result<Bytes> {
        match self {
            Location::Nfs { path, .. } => {
                let mut file = tokio::fs::File::open(path).await?;
                file.seek(std::io::SeekFrom::Start(start)).await?;
                let mut buffer = vec![0; usize::try_from(end - start).unwrap_or(usize::MAX)];
                file.read_exact(&mut buffer).await?;
                Ok(Bytes::from(buffer))
            }
            Location::Object { store, key, .. } => {
                Ok(store.read_with(key).range(start..end).await?.to_bytes())
            }
        }
    }

    pub(crate) async fn list(&self, limit: usize) -> Result<Listing> {
        let mut entries = Vec::new();
        match self {
            Location::Nfs { path, uri } => {
                let mut children = tokio::fs::read_dir(path).await?;
                while let Some(child) = children.next_entry().await? {
                    let metadata = tokio::fs::symlink_metadata(child.path()).await?;
                    let kind = if metadata.is_dir() {
                        Kind::Directory
                    } else if metadata.is_file() {
                        Kind::File
                    } else {
                        continue;
                    };
                    let Ok(name) = child.file_name().into_string() else {
                        continue;
                    };
                    entries.push(Entry {
                        uri: child_uri(uri, &name),
                        name,
                        kind,
                        size: (kind == Kind::File).then_some(metadata.len()),
                    });
                    if entries.len() > limit {
                        break;
                    }
                }
            }
            Location::Object { store, base, key } => {
                let file = key.trim_end_matches('/');
                let prefix = if file.is_empty() {
                    String::new()
                } else {
                    format!("{file}/")
                };
                let mut objects = store
                    .lister_with(&prefix)
                    .recursive(false)
                    .limit(limit + 1)
                    .await?;
                while let Some(object) = objects.try_next().await? {
                    let kind = match object.metadata().mode() {
                        EntryMode::DIR => Kind::Directory,
                        EntryMode::FILE => Kind::File,
                        EntryMode::Unknown => continue,
                    };
                    let Some(name) = object.path().strip_prefix(&prefix) else {
                        continue;
                    };
                    let name = name.trim_end_matches('/');
                    if name.is_empty() || name.contains('/') {
                        continue;
                    }
                    entries.push(Entry {
                        name: name.to_owned(),
                        uri: format!("{base}/{prefix}{name}"),
                        kind,
                        size: (kind == Kind::File).then(|| object.metadata().content_length()),
                    });
                    if entries.len() > limit {
                        break;
                    }
                }
            }
        }
        let truncated = entries.len() > limit;
        entries.truncate(limit);
        entries.sort_by(|a, b| {
            (a.kind != Kind::Directory, &a.name).cmp(&(b.kind != Kind::Directory, &b.name))
        });
        Ok(Listing { entries, truncated })
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::config::parse_nfs_roots;

    fn roots(mount: &Path) -> Vec<NfsRoot> {
        parse_nfs_roots(&format!("/mnt/shared={}", mount.display())).unwrap()
    }

    #[tokio::test]
    async fn resolves_nfs_paths_inside_the_root_only() {
        let temporary = tempfile::tempdir().unwrap();
        let mount = temporary.path();
        tokio::fs::create_dir_all(mount.join("ds.lance/data"))
            .await
            .unwrap();
        tokio::fs::write(mount.join("ds.lance/data/a.lance"), b"0123456789")
            .await
            .unwrap();
        std::os::unix::fs::symlink("/etc", mount.join("escape")).unwrap();
        let roots = roots(mount);

        let file = open_nfs(&roots, "/mnt/shared/ds.lance/data/a.lance")
            .await
            .unwrap();
        let stat = file.stat().await.unwrap();
        assert_eq!((stat.kind, stat.size), (Kind::File, Some(10)));
        assert_eq!(file.read(3, 7).await.unwrap().as_ref(), b"3456");

        let listing = open_nfs(&roots, "/mnt/shared/ds.lance/")
            .await
            .unwrap()
            .list(10)
            .await
            .unwrap();
        assert_eq!(listing.entries[0].uri, "/mnt/shared/ds.lance/data");
        assert_eq!(listing.entries[0].kind, Kind::Directory);

        assert!(open_nfs(&roots, "/mnt/shared/../etc/passwd").await.is_err());
        assert!(open_nfs(&roots, "/mnt/shared/escape/passwd").await.is_err());
        assert!(open_nfs(&roots, "/mnt/other/file").await.is_err());
    }
}
