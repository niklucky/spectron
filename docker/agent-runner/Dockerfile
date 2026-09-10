FROM node:24-bookworm-slim
ARG OPENCODE_VERSION=1.18.30
RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep ca-certificates && rm -rf /var/lib/apt/lists/* \
    && npm install -g opencode-ai@${OPENCODE_VERSION}
ENV HOME=/work/home XDG_CONFIG_HOME=/work/home/.config XDG_DATA_HOME=/work/home/.local/share XDG_CACHE_HOME=/work/home/.cache
WORKDIR /work
ENTRYPOINT ["sleep", "infinity"]
