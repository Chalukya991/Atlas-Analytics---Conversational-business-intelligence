# API + worker image: Node 20 with the Python analysis engine alongside.
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PYTHON_BIN=python3 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip python3-venv dumb-init \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python engine (own venv so pip does not fight the system python)
COPY python_engine/requirements.txt ./python_engine/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r python_engine/requirements.txt
ENV PATH="/opt/venv/bin:$PATH"
COPY python_engine ./python_engine

# Node server
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server ./

RUN mkdir -p /data/storage && chown -R node:node /data /app
USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
