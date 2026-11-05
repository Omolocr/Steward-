# Church Connect server: the image Chajio Cloud (or any Docker host) builds from the repository root.
# The mobile app (src/, App.tsx, ...) is NOT part of this image: it is built separately with Expo (see README).
FROM node:22-bookworm-slim

# ffmpeg cuts long sermon recordings into pieces before they are summarised.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# PORT is set by the host from the "Container port" setting; 8080 is the default. The server listens on all interfaces.
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080

WORKDIR /app
COPY server/ ./

# Church data (databases + sermon recordings) is written to /data. It only survives updates if /data is a persistent disk:
# see deploy/CHAJIO.md. Do not set PERSISTENT_STORAGE here: the person who deploys must confirm it.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, foreground: the host stops the old copy with SIGTERM and the server finishes its requests, then exits.
CMD ["node", "--no-warnings", "server.mjs"]
