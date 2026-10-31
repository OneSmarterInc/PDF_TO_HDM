FROM node:24-trixie-slim AS node-runtime
FROM node-runtime AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN node scripts/build.mjs

FROM python:3.12-slim-trixie AS runtime
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libstdc++6 ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY requirements.lock.txt /tmp/requirements.lock.txt
RUN pip install --no-cache-dir -r /tmp/requirements.lock.txt && pip check && rm /tmp/requirements.lock.txt
RUN mkdir -p /app/certs && python -c "import urllib.request; urllib.request.urlretrieve('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem', '/app/certs/rds-global-bundle.pem')" \
    && useradd --uid 10001 --create-home portal
WORKDIR /app
COPY --from=build /build/dist/ ./
COPY --from=build /build/node_modules/ ./node_modules/
RUN mkdir -p /app/.runtime && chown -R portal:portal /app/.runtime
VOLUME ["/app/.runtime", "/tmp"]
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4317 PYTHON_PATH=/usr/local/bin/python \
    PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RUNTIME_DIR=/app/.runtime \
    DATABASE_SSL_MODE=verify-full DATABASE_SSL_CA_FILE=/app/certs/rds-global-bundle.pem
USER 10001:10001
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=8s --start-period=90s --retries=3 \
 CMD ["node","-e","fetch('http://127.0.0.1:4317/healthz',{signal:AbortSignal.timeout(6000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","server.mjs"]
