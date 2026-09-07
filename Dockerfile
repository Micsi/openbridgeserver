# ---------------------------------------------------------------------------
# open bridge server — Multi-Stage Dockerfile (4 stages)
# Stage 1 (node-builder):   npm ci + vite/vitepress build → gui_dist/ + frontend_dist/ + help_dist/
# Stage 1b (visu-v2):       picks up the PRE-BUILT visu_v2_dist/ from the build context
# Stage 2 (py-builder):     pip install Python deps
# Stage 3 (runtime):        python:3.14-slim, copies all artefacts
#
# Target: Linux x86_64 and ARM64 (Cortex-A72 / Raspberry Pi 4)
# ---------------------------------------------------------------------------

# ── Stage 1: build Vue Admin-GUI + Visu-Frontend + Help site ────────────────
FROM node:24-slim AS node-builder
ARG VITE_INSTANCE_NAME=
ARG VITE_INSTANCE_COLOR=amber
ENV VITE_INSTANCE_NAME=${VITE_INSTANCE_NAME}
ENV VITE_INSTANCE_COLOR=${VITE_INSTANCE_COLOR}

# Admin-GUI (gui/ → ../gui_dist)
WORKDIR /gui-src
COPY gui/package.json gui/package-lock.json ./
RUN npm ci --prefer-offline
COPY gui/ ./
RUN npm run build
# Output: /gui_dist

# Visu-Frontend (frontend/ → ../frontend_dist)
WORKDIR /visu-src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --prefer-offline
COPY frontend/ ./
RUN npm run build
# Output: /frontend_dist

# Help site (help/ → ../help_dist)
WORKDIR /help-src
COPY help/package.json help/package-lock.json ./
RUN npm ci --prefer-offline
COPY help/ ./
RUN npm run build
# Output: /help_dist


# ── Stage 1b: V2 Visu (apps/visu → visu_v2_dist) ────────────────────────────
# NOT built here, unlike the three stages above. `apps/visu/package.json` depends
# on three skin packages via `link:` paths that point OUTSIDE this repository
# (obs-visu-skins); a `pnpm install` inside the image cannot resolve them. The
# bundle is therefore built in the source checkout (`tools/build-visu-v2.sh`,
# called by `tools/build-local.sh`) and handed to this build as an artefact.
#
# The COPY is deliberately optional: `visu_v2_dist*` alone would abort the build
# when nothing was pre-built (a wildcard matching nothing is an error), so
# `.dockerignore` — always present in the context — keeps the COPY alive and is
# removed again right after. An image built WITHOUT the bundle stays valid: the
# directory is then empty, `obs/main.py` mounts nothing, and `/visu-v2` answers
# 404 instead of silently serving the Admin shell. The build says so out loud.
FROM node:24-slim AS visu-v2
WORKDIR /prebuilt
COPY .dockerignore visu_v2_dist* ./visu_v2_dist/
RUN rm -f ./visu_v2_dist/.dockerignore && \
    if [ -f ./visu_v2_dist/index.html ]; then \
        echo "==> visu_v2_dist: pre-built bundle picked up ($(find ./visu_v2_dist -type f | wc -l) files)"; \
    else \
        echo "==> WARNING: no pre-built visu_v2_dist/ in the build context."; \
        echo "==>          /visu-v2 will answer 404 in this image and the Visu editor's"; \
        echo "==>          preview stays empty. Run tools/build-visu-v2.sh first."; \
    fi


# ── Stage 2: Python dependency builder ─────────────────────────────────────
FROM python:3.14-slim AS py-builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libffi-dev \
        libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Stage 3: runtime image ──────────────────────────────────────────────────
FROM python:3.14-slim AS runtime

# Version stamp — passed via --build-arg OBS_VERSION=<ver> by CI and build-local.sh.
# Falls back to "dev-version" so plain `docker build .` still works.
ARG OBS_VERSION=dev-version

LABEL org.opencontainers.image.title="open bridge server" \
      org.opencontainers.image.description="Open-Source Multiprotocol Server for Building Automation" \
      org.opencontainers.image.licenses="MIT"

RUN apt-get update && apt-get install -y --no-install-recommends \
        iputils-ping \
    && rm -rf /var/lib/apt/lists/*

# Python packages from builder
COPY --from=py-builder /install /usr/local

# Application source
WORKDIR /app
COPY obs/ ./obs/
COPY scripts/obs-admin /usr/local/bin/obs-admin
RUN chmod +x /usr/local/bin/obs-admin
# Stamp the version into the image without touching the working tree
RUN echo "$OBS_VERSION" > ./obs/version

# Built Admin-GUI (served by FastAPI from /app/gui_dist)
COPY --from=node-builder /gui_dist ./gui_dist/

# Built Visu SPA (served by FastAPI from /app/frontend_dist under /visu/)
COPY --from=node-builder /frontend_dist ./frontend_dist/

# Built Help site (served by FastAPI from /app/help_dist under /help/)
COPY --from=node-builder /help_dist ./help_dist/

# Pre-built V2 Visu (served by FastAPI from /app/visu_v2_dist under /visu-v2/),
# including the editor preview at /visu-v2/preview. Empty when the build context
# carried no bundle — see stage `visu-v2` above.
COPY --from=visu-v2 /prebuilt/visu_v2_dist ./visu_v2_dist/

# Pre-create data directory — volume mount inherits this, preventing SQLite errors
RUN mkdir -p /data

# Data volume — DB files, ringbuffer disk, optional config.yaml
VOLUME ["/data"]

# Runtime defaults — overridable via env or mounted /data/config.yaml
ENV OBS_DATABASE__PATH=/data/obs.db \
    OBS_CONFIG=/data/config.yaml

EXPOSE 8080

CMD ["python", "-m", "obs"]
