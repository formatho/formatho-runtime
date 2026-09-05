# Formatho Runtime — Phase 1 (stdio MCP server)
# Run entirely inside your infrastructure:
#   docker build -t formatho-runtime .
#   docker run -i --rm -v formatho-audit:/data -e FORMATHO_AUDIT_LOG=/data/audit.jsonl formatho-runtime

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV FORMATHO_AUDIT_LOG=/data/audit.jsonl
ENV FORMATHO_HOST=0.0.0.0
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
# stdio MCP: attach to the caller's stdin/stdout. Use --interactive.
CMD ["node", "dist/index.js"]
