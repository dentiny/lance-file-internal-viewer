use std::{env, net::SocketAddr, path::PathBuf};

use anyhow::{Context, Result, bail};
use serde::Serialize;

pub(crate) const BIND_ENV: &str = "LANCE_VIEWER_BIND";
pub(crate) const UI_DIR_ENV: &str = "LANCE_VIEWER_UI_DIR";
pub(crate) const NFS_ROOTS_ENV: &str = "LANCE_VIEWER_NFS_ROOTS";
pub(crate) const S3_REGIONS_ENV: &str = "LANCE_VIEWER_S3_REGIONS";
pub(crate) const S3_ENDPOINT_ENV: &str = "LANCE_VIEWER_S3_ENDPOINT";
pub(crate) const OCI_NAMESPACE_ENV: &str = "LANCE_VIEWER_OCI_NAMESPACE";

/// A directory tree the server may read, as users name it and as it is mounted in this container.
///
/// For example `/mnt/shared=/mnt/nfs/crusoe` lets users open `/mnt/shared/team/f.lance`,
/// which the server reads from `/mnt/nfs/crusoe/team/f.lance`.
#[derive(Clone, Debug, Serialize)]
pub(crate) struct NfsRoot {
    pub(crate) logical: String,
    #[serde(skip)]
    pub(crate) mount: PathBuf,
}

#[derive(Clone, Debug)]
pub(crate) struct ObjectStorageConfig {
    /// Regions users may pick; the first is the default.
    pub(crate) regions: Vec<String>,
    /// Endpoint URL, optionally with `{region}` and `{namespace}` placeholders. AWS's when absent.
    pub(crate) endpoint_template: Option<String>,
    pub(crate) namespace: Option<String>,
}

impl ObjectStorageConfig {
    pub(crate) fn endpoint(&self, region: &str) -> Option<String> {
        let template = self.endpoint_template.as_deref()?;
        let endpoint = template.replace("{region}", region);
        Some(match &self.namespace {
            Some(namespace) => endpoint.replace("{namespace}", namespace),
            None => endpoint,
        })
    }
}

#[derive(Clone, Debug)]
pub(crate) struct Config {
    pub(crate) bind: SocketAddr,
    pub(crate) ui_dir: PathBuf,
    pub(crate) nfs_roots: Vec<NfsRoot>,
    pub(crate) object_storage: Option<ObjectStorageConfig>,
}

fn non_empty(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn list(value: &str) -> impl Iterator<Item = &str> {
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
}

pub(crate) fn parse_nfs_roots(value: &str) -> Result<Vec<NfsRoot>> {
    list(value)
        .map(|entry| {
            let (logical, mount) = entry.split_once('=').unwrap_or((entry, entry));
            let logical = logical.trim_end_matches('/');
            if !logical.starts_with('/') || !mount.starts_with('/') {
                bail!("{NFS_ROOTS_ENV} entries must be absolute paths, got {entry:?}");
            }
            Ok(NfsRoot {
                logical: if logical.is_empty() {
                    "/".to_owned()
                } else {
                    logical.to_owned()
                },
                mount: PathBuf::from(mount),
            })
        })
        .collect()
}

impl Config {
    pub(crate) fn from_env() -> Result<Self> {
        let bind = non_empty(BIND_ENV).unwrap_or_else(|| "0.0.0.0:8080".to_owned());
        let bind = bind
            .parse()
            .with_context(|| format!("{BIND_ENV} must be a socket address, got {bind:?}"))?;
        let ui_dir = non_empty(UI_DIR_ENV).map_or_else(|| PathBuf::from("dist"), PathBuf::from);
        let nfs_roots = non_empty(NFS_ROOTS_ENV)
            .map(|value| parse_nfs_roots(&value))
            .transpose()?
            .unwrap_or_default();
        let object_storage = non_empty(S3_REGIONS_ENV).map(|regions| ObjectStorageConfig {
            regions: list(&regions).map(str::to_owned).collect(),
            endpoint_template: non_empty(S3_ENDPOINT_ENV),
            namespace: non_empty(OCI_NAMESPACE_ENV),
        });
        if let Some(storage) = &object_storage {
            if storage.regions.is_empty() {
                bail!("{S3_REGIONS_ENV} must list at least one region");
            }
            if storage
                .endpoint_template
                .as_deref()
                .is_some_and(|t| t.contains("{namespace}"))
                && storage.namespace.is_none()
            {
                bail!("{S3_ENDPOINT_ENV} uses {{namespace}} but {OCI_NAMESPACE_ENV} is not set");
            }
        }
        Ok(Self {
            bind,
            ui_dir,
            nfs_roots,
            object_storage,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nfs_roots_with_and_without_a_mount_path() {
        let roots = parse_nfs_roots("/mnt/shared=/mnt/nfs/crusoe, /data/").unwrap();
        assert_eq!(roots[0].logical, "/mnt/shared");
        assert_eq!(roots[0].mount, PathBuf::from("/mnt/nfs/crusoe"));
        assert_eq!(roots[1].logical, "/data");
        assert_eq!(roots[1].mount, PathBuf::from("/data/"));
        assert!(parse_nfs_roots("relative/path").is_err());
    }

    #[test]
    fn fills_in_the_oci_endpoint_template() {
        let storage = ObjectStorageConfig {
            regions: vec!["us-phoenix-1".to_owned()],
            endpoint_template: Some(
                "https://{namespace}.compat.objectstorage.{region}.oraclecloud.com".to_owned(),
            ),
            namespace: Some("ns".to_owned()),
        };
        assert_eq!(
            storage.endpoint("us-ashburn-1").as_deref(),
            Some("https://ns.compat.objectstorage.us-ashburn-1.oraclecloud.com")
        );
    }
}
