# Jobhunter server image: engine + web UI + headless Chromium (Playwright) in one container.
# Build:  docker build -f docker/Dockerfile -t jobhunter .
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS build
ENV CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Toolchain for native modules (better-sqlite3, argon2, keyring) when no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends build-essential python3 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @jobhunter/web build \
 && pnpm --filter @jobhunter/engine build \
 && pnpm --filter @jobhunter/engine deploy --prod --legacy /out \
 && cp -r apps/engine/dist /out/dist \
 && cp -r apps/web/dist /out/web \
 && rm -rf /out/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-linux-*-musl* \
 && BIN="$(find /out/node_modules -path '*claude-agent-sdk-linux-*/claude' -type f | head -1)" \
 && test -n "$BIN" && ln -s "${BIN#/out/}" /out/claude

FROM mcr.microsoft.com/playwright:v1.63.0-noble
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-liberation fonts-dejavu-core tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    JOBHUNTER_MODE=server \
    JOBHUNTER_DATA_DIR=/data \
    JOBHUNTER_HOST=0.0.0.0 \
    JOBHUNTER_PORT=4317 \
    JOBHUNTER_WEB_DIST=/app/web \
    CLAUDE_CONFIG_DIR=/data/claude \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /out /app
# `docker compose exec -it jobhunter claude auth login` runs the official Claude Code login.
RUN ln -s "/app/$(readlink /app/claude)" /usr/local/bin/claude \
 && mkdir -p /data && chown pwuser:pwuser /data
USER pwuser
VOLUME ["/data"]
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4317/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
