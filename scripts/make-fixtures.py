# /// script
# dependencies = ["pylance==11.0.0", "pyarrow>=21", "numpy"]
# ///
"""Writes the Lance files the tests and the example link read. Run with `uv run scripts/make-fixtures.py`.

For every file it also writes `tests/fixtures/<file>.json` with what Lance's own reader reports, so tests can check
the parser against it.
"""

import json
import os
import re

import numpy as np
import pyarrow as pa
from lance.file import LanceFileReader, LanceFileWriter


def write(path, table, version, batch_rows=None, **options):
    if os.path.exists(path):
        os.remove(path)
    with LanceFileWriter(path, table.schema, version=version, **options) as writer:
        for batch in table.to_batches(max_chunksize=batch_rows or table.num_rows):
            writer.write_batch(batch)
    meta = LanceFileReader(path).metadata()
    summary = {
        "version": f"{meta.major_version}.{meta.minor_version}",
        "num_rows": meta.num_rows,
        "columns": [
            {
                "pages": [
                    {
                        "buffers": [[b.position, b.size] for b in p.buffers],
                        # Every encoding message in the page's tree, from the Rust Debug output.
                        "encodings": re.findall(r"Some\(\s*(\w+)\(", p.encoding),
                    }
                    for p in c.pages
                ],
                "column_buffers": [[b.position, b.size] for b in c.column_buffers],
            }
            for c in meta.columns
        ],
        "global_buffers": [[b.position, b.size] for b in meta.global_buffers],
    }
    with open(f"tests/fixtures/{os.path.basename(path)}.json", "w") as f:
        json.dump(summary, f)
    print(path, os.path.getsize(path), "bytes,", len(meta.columns), "columns,", sum(len(c.pages) for c in meta.columns), "pages")


rows = 6
point = pa.struct([("x", pa.int32()), ("y", pa.int32())])
nested = pa.table(
    {
        "id": pa.array(range(rows), pa.int64()),
        "city": pa.array(["Paris", "Oslo", "Lima", "Rome", "Oslo", "Paris"], pa.string()),
        "tags": pa.array([["a", "b"], [], ["c"], None, ["d"], ["e", "f"]], pa.list_(pa.string())),
        "point": pa.array([{"x": i, "y": -i} for i in range(rows)], point),
        "points": pa.array([[{"x": i, "y": i}] for i in range(rows)], pa.list_(point)),
        "vec": pa.array([[float(i)] * 4 for i in range(rows)], pa.list_(pa.float32(), 4)),
        "ts": pa.array(np.arange(rows).astype("datetime64[ms]"), pa.timestamp("ms", tz="UTC")),
    },
    schema=pa.schema(
        [
            pa.field("id", pa.int64(), nullable=False),
            pa.field("city", pa.string()),
            pa.field("tags", pa.list_(pa.string())),
            pa.field("point", point),
            pa.field("points", pa.list_(point)),
            pa.field("vec", pa.list_(pa.float32(), 4)),
            pa.field("ts", pa.timestamp("ms", tz="UTC")),
        ]
    ),
)
os.makedirs("tests/fixtures", exist_ok=True)
for version in ["2.0", "2.1", "2.2"]:
    write(f"tests/fixtures/nested-{version}.lance", nested, version)

rng = np.random.default_rng(7)
n = 400_000
sensors = np.array([f"sensor-{i:03d}" for i in range(200)])
cities = np.array(["Paris", "Berlin", "Tokyo", "NYC", "Lagos", "Lima", "Oslo", "Seoul", "Cairo", "Austin", "Delhi", "Rome"])
temperature = 15 + np.cumsum(rng.normal(0, 0.05, n)) + 8 * np.sin(np.arange(n) / 1440 * 2 * np.pi)
notes = np.array(["ok", "recalibrated after maintenance window", "battery low", "signal dropped, value interpolated"])
sensor_table = pa.table(
    {
        "event_id": pa.array(np.arange(1_000_000, 1_000_000 + n), pa.int64()),
        "ts": pa.array((np.datetime64("2024-01-01T00:00:00") + np.arange(n).astype("timedelta64[m]")).astype("datetime64[ms]")),
        "sensor_id": pa.array(sensors[rng.integers(0, 200, n)]),
        "city": pa.array(cities[rng.integers(0, len(cities), n)]),
        "temperature": pa.array(np.round(temperature, 2).astype("float32")),
        "note": pa.array([notes[i] if i else None for i in rng.integers(0, 40, n) % 4]),
    },
    schema=pa.schema(
        [
            pa.field("event_id", pa.int64(), nullable=False),
            pa.field("ts", pa.timestamp("ms")),
            pa.field("sensor_id", pa.string()),
            pa.field("city", pa.string()),
            pa.field("temperature", pa.float32(), metadata={"lance-encoding:compression": "zstd"}),
            pa.field("note", pa.string()),
        ]
    ),
)
os.makedirs("public", exist_ok=True)
write("public/sensors.lance", sensor_table, "2.1", batch_rows=20_000, max_page_bytes=256 * 1024)
