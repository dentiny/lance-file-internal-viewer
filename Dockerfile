# syntax=docker/dockerfile:1.10

FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY index.html tsconfig.json vite.config.ts svelte.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM rust:1.97-bookworm AS backend
WORKDIR /app
COPY server/Cargo.toml server/Cargo.lock ./server/
RUN mkdir -p server/src && echo 'fn main() {}' > server/src/main.rs
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/server/target \
    cargo build --release --locked --manifest-path server/Cargo.toml
COPY server/src ./server/src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/server/target \
    touch server/src/main.rs \
    && cargo build --release --locked --manifest-path server/Cargo.toml \
    && cp server/target/release/lance-file-internal-storage /app/lance-file-internal-storage

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=backend /app/lance-file-internal-storage /usr/local/bin/lance-file-internal-storage
COPY --from=frontend /app/dist /opt/lance-file-internal-storage/ui
ENV LANCE_VIEWER_BIND=0.0.0.0:8080 \
    LANCE_VIEWER_UI_DIR=/opt/lance-file-internal-storage/ui
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["lance-file-internal-storage"]
