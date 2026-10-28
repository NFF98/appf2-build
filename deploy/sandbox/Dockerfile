# Isolated sandbox image: no application credentials, egress disabled by Durable Object.
FROM node:24-trixie-slim
COPY --from=docker.io/cloudflare/sandbox:1.0.1 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
RUN mkdir -p /workspace
WORKDIR /workspace
CMD ["sleep", "infinity"]
