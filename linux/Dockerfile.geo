FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive
ARG APP_UID=10001
ARG APP_GID=10001
ARG MINIFORGE_VERSION=26.3.2-2
ARG MINIFORGE_INSTALLER=Miniforge3-26.3.2-2-Linux-x86_64.sh
ARG MINIFORGE_SHA256=42260ffe3830fb953d5eee1bbb32229ff06aa7c3833c1ed7a9a0420a95685d94

ENV PATH=/opt/conda/envs/platform_geo_worker/bin:/opt/conda/bin:${PATH} \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONNOUSERSITE=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/tmp/village-home \
    XDG_CACHE_HOME=/tmp/village-cache \
    GDAL_DATA=/opt/conda/envs/platform_geo_worker/share/gdal \
    PROJ_DATA=/opt/conda/envs/platform_geo_worker/share/proj \
    PROJ_LIB=/opt/conda/envs/platform_geo_worker/share/proj

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && curl --fail --show-error --location \
        --output /tmp/Miniforge3.sh \
        "https://github.com/conda-forge/miniforge/releases/download/${MINIFORGE_VERSION}/${MINIFORGE_INSTALLER}" \
    && echo "${MINIFORGE_SHA256}  /tmp/Miniforge3.sh" | sha256sum --check --strict \
    && bash /tmp/Miniforge3.sh -b -p /opt/conda \
    && rm -f /tmp/Miniforge3.sh

COPY server/environment/platform_geo_worker.yml /tmp/platform_geo_worker.yml
RUN conda env create --file /tmp/platform_geo_worker.yml \
    && conda clean --all --yes \
    && rm -f /tmp/platform_geo_worker.yml

COPY server/pyproject.toml /app/server/pyproject.toml
COPY server/src /app/server/src
COPY server/config /app/server/config
RUN /opt/conda/envs/platform_geo_worker/bin/python -m pip install /app/server

RUN groupadd --gid "${APP_GID}" village \
    && useradd --uid "${APP_UID}" --gid "${APP_GID}" --no-create-home --shell /usr/sbin/nologin village \
    && install -d -o "${APP_UID}" -g "${APP_GID}" /work

WORKDIR /app
USER 10001:10001

CMD ["python", "-m", "village_processing", "worker"]
