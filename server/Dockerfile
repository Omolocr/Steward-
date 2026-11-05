# Church Connect server image. ffmpeg is needed to cut long sermon recordings into pieces.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080

WORKDIR /app
COPY server.mjs platform.mjs console-api.mjs console.html providers.mjs messages.mjs bulk.mjs clerks.mjs sandbox.mjs backup.mjs restore.mjs mpesa-register.mjs smoke-test.mjs ./

# All church data (database + sermon recordings) lives in /data, which is a Docker volume that survives updates.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings", "server.mjs"]
