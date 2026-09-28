#!/usr/bin/env bash
# Runs e2e/server.spec.ts against the Rust server, with a local S3 (moto) and a directory standing in for NFS.
# Needs cargo, uv and Playwright's Chromium (npx playwright install chromium).
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
work="$(mktemp -d)"
s3_port=9000
port=8090
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$work"
}
trap cleanup EXIT

wait_for() {
  for _ in $(seq 1 120); do
    curl -s -o /dev/null "$1" && return 0
    sleep 0.5
  done
  echo "timed out waiting for $1" >&2
  return 1
}

cd "$root"
npm run build > /dev/null
cargo build --locked --manifest-path server/Cargo.toml
target_dir="${CARGO_TARGET_DIR:-server/target}"

dataset="$work/nfs/team/sensors.lance"
mkdir -p "$dataset/data" "$dataset/_versions"
cp public/sensors.lance "$dataset/data/0a1b2c.lance"
cp tests/fixtures/nested-2.0.lance "$dataset/data/1d2e3f.lance"
echo x > "$dataset/_versions/1.manifest"

export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
uvx --from 'moto[server]' moto_server -H 127.0.0.1 -p "$s3_port" > "$work/moto.log" 2>&1 &
pids+=($!)
wait_for "http://127.0.0.1:$s3_port/"
uv run --with boto3 python - "$s3_port" <<'EOF'
import sys, boto3
s3 = boto3.client("s3", endpoint_url=f"http://127.0.0.1:{sys.argv[1]}", region_name="us-east-1")
s3.create_bucket(Bucket="lance-test")
s3.upload_file("public/sensors.lance", "lance-test", "warehouse/sensors.lance/data/0a1b2c.lance")
s3.upload_file("tests/fixtures/nested-2.1.lance", "lance-test", "warehouse/sensors.lance/data/9f8e7d.lance")
s3.put_object(Bucket="lance-test", Key="warehouse/sensors.lance/_versions/1.manifest", Body=b"x")
EOF

LANCE_VIEWER_BIND="127.0.0.1:$port" \
LANCE_VIEWER_UI_DIR=dist \
LANCE_VIEWER_NFS_ROOTS="/mnt/shared=$work/nfs" \
LANCE_VIEWER_S3_REGIONS=us-east-1,us-west-2 \
LANCE_VIEWER_S3_ENDPOINT="http://127.0.0.1:$s3_port" \
  "$target_dir/debug/lance-file-internal-storage" &
pids+=($!)
wait_for "http://127.0.0.1:$port/api/health"

LANCE_VIEWER_E2E_URL="http://127.0.0.1:$port" npx playwright test e2e/server.spec.ts "$@"
