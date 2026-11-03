# Sprint 3.5 zero-additional-cloud-fees sandbox, standard public GitHub runner.
# No cloudflare/sandbox image, Wrangler or Cloudflare Containers subscription.
# All npm packages installed from trusted pinned versions at IMAGE BUILD time.
FROM node:24-trixie-slim
RUN mkdir -p /workspace /opt/appf2 && \
    cd /opt/appf2 && \
    npm install --ignore-scripts --no-audit --no-fund --save-exact \
      vite@8.3.1 typescript@6.0.3 react@19.3.0 react-dom@19.3.0
COPY sandbox/web-smoke.mjs /opt/appf2/web-smoke.mjs
COPY free-ci/build-locked.mjs /opt/appf2/build-locked.mjs
WORKDIR /workspace
CMD ["sleep", "infinity"]
