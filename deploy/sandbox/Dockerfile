# APPf2 Sprint 3.5 private isolated build image; never receives Worker API keys.
# npm packages are installed only at IMAGE BUILD time; container egress is disabled.
FROM node:24-trixie-slim
COPY --from=docker.io/cloudflare/sandbox:1.0.1 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
RUN mkdir -p /workspace /opt/appf2 && \
    cd /opt/appf2 && \
    npm install --ignore-scripts --no-audit --no-fund --save-exact \
      vite@8.3.1 typescript@6.0.3 react@19.3.0 react-dom@19.3.0
COPY web-smoke.mjs /opt/appf2/web-smoke.mjs
WORKDIR /workspace
CMD ["sleep", "infinity"]
