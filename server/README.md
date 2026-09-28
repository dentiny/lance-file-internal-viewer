# Server

Browsers can't read S3 or NFS: object storage needs credentials and CORS, and NFS is only mounted on
servers. This Rust server (Axum and OpenDAL, following `ml-infra/file_viewer`) reads those locations and
hands the browser byte ranges. Parsing still happens in the browser, as it does for HTTP URLs. The server
also serves the built UI, so one container gives you the whole app.

The server only reads. NFS paths must resolve inside a configured root, `..` components and symbolic links
are rejected, and credentials never leave the server.

## Running it

```sh
npm run build                       # the UI, into dist/
cd server
LANCE_VIEWER_NFS_ROOTS=/mnt/shared \
LANCE_VIEWER_S3_REGIONS=us-east-1 \
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
LANCE_VIEWER_UI_DIR=../dist cargo run --release
```

Open <http://localhost:8080> and enter `s3://bucket/path/ds.lance`, `/mnt/shared/team/ds.lance`, or a
single data file. Directories open as a listing to pick a data file from. During UI development, run
`npm run dev` as well; Vite proxies `/api` to port 8080.

`docker build -t lance-file-internal-storage .` in the repository root builds the same thing as an
image.

## Configuration

| Variable                                     | Meaning                                                                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LANCE_VIEWER_BIND`                          | Address to listen on. Default `0.0.0.0:8080`.                                                                                                      |
| `LANCE_VIEWER_UI_DIR`                        | The built UI. Default `dist`.                                                                                                                      |
| `LANCE_VIEWER_NFS_ROOTS`                     | Comma-separated directories users may open. `logical=mount` maps the path users type onto where it is mounted, e.g. `/mnt/shared=/mnt/nfs/crusoe`. |
| `LANCE_VIEWER_S3_REGIONS`                    | Comma-separated regions users may pick for `s3://` and `oci://` URIs; the first is the default. Object storage is off when unset.                  |
| `LANCE_VIEWER_S3_ENDPOINT`                   | S3 endpoint, with optional `{region}` and `{namespace}` placeholders. AWS when unset.                                                              |
| `LANCE_VIEWER_OCI_NAMESPACE`                 | Fills `{namespace}` in the endpoint.                                                                                                               |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Object storage credentials, read by OpenDAL. For OCI these are a Customer Secret Key.                                                              |

For OCI Object Storage through its S3-compatible API:

```sh
LANCE_VIEWER_S3_REGIONS=us-phoenix-1,us-ashburn-1,ap-melbourne-1
LANCE_VIEWER_S3_ENDPOINT='https://{namespace}.compat.objectstorage.{region}.oraclecloud.com'
LANCE_VIEWER_OCI_NAMESPACE=<your tenancy's Object Storage namespace>
```

## API

All endpoints take `uri` and, for object storage, an optional `region`.

- `GET /api/config`: the NFS roots and regions, so the UI knows what it can open.
- `GET /api/stat`: `{ "kind": "file" | "directory", "size": ... }`.
- `GET /api/list`: a directory's immediate entries, capped at 10,000.
- `GET /api/raw`: the file's bytes. Honors a single `Range` header (`bytes=a-b`, `bytes=a-`, `bytes=-n`) with
  `206 Partial Content`; one response is limited to 64 MiB.

Errors are `{ "error": "..." }` with a matching status code.

## Tests

```sh
cargo test                          # unit tests, including NFS reads over HTTP from a temporary directory
../scripts/server-e2e.sh            # browser tests against a local S3 (moto) and NFS directory
```
