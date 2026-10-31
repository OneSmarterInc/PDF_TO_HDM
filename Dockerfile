FROM node:24-trixie-slim AS node-runtime
FROM node-runtime AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN node scripts/build.mjs

# Wolfi provides patched runtime libraries without substituting OCR engines/models.
FROM cgr.dev/chainguard/wolfi-base@sha256:88a20e2d017bd20cdc0cb3910de603e7bea9512a6c351a8dd3c9df212ab03d73 AS runtime
RUN apk add --no-cache python-3.12 py3.12-pip nodejs-24-minimal mesa-gl glib libstdc++ tini ca-certificates openssl \
    && python3.12 -m venv /opt/venv
ENV PATH=/opt/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
COPY requirements.lock.txt /tmp/requirements.lock.txt
RUN pip install --no-cache-dir -r /tmp/requirements.lock.txt && pip check \
    && pip uninstall -y pip && apk del py3.12-pip \
    && rm /tmp/requirements.lock.txt
RUN mkdir -p /app/certs && python -c "import urllib.request; urllib.request.urlretrieve('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem', '/app/certs/rds-global-bundle.pem')" \
    && addgroup -g 10001 portal && adduser -D -u 10001 -G portal portal
WORKDIR /app
COPY --from=build /build/dist/ ./
COPY --from=build /build/node_modules/ ./node_modules/
RUN mkdir -p /app/.runtime && chown -R portal:portal /app/.runtime
VOLUME ["/app/.runtime", "/tmp"]
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4317 PYTHON_PATH=/opt/venv/bin/python \
    PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RUNTIME_DIR=/app/.runtime \
    DATABASE_SSL_MODE=verify-full DATABASE_SSL_CA_FILE=/app/certs/rds-global-bundle.pem
USER 10001:10001
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=8s --start-period=90s --retries=3 \
 CMD ["node","-e","fetch('http://127.0.0.1:4317/healthz',{signal:AbortSignal.timeout(6000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/sbin/tini","--"]
CMD ["node","server.mjs"]
