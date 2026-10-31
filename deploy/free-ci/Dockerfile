# Sprint 3.5 ZERO-NEW-CLOUD-FEES Docker build image.
# Used by standard public-repo GitHub Actions runners, NOT Cloudflare Containers.
# Toolchain installed only at image-build time; runtime always --network none,
# no elevated capabilities, no host secrets and strictly limited resources.
FROM node:24-trixie-slim
RUN mkdir -p /workspace /opt/appf2 && \
    cd /opt/appf2 && \
    npm install --ignore-scripts --no-audit --no-fund --save-exact \
      vite@8.3.1 typescript@6.0.3 react@19.3.0 react-dom@19.3.0
COPY web-smoke.mjs /opt/appf2/web-smoke.mjs
WORKDIR /workspace
CMD ["sleep", "infinity"]
