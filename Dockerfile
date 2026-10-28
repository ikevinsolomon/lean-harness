# Lean Harness: the quickstart server with the web app and the widget.
# docker build -t lean-harness . && docker run -p 8787:8787 --env-file examples/quickstart/.env lean-harness

FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
# Dependencies first, so code changes don't reinstall them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/widget/package.json packages/widget/
COPY packages/app/package.json packages/app/
COPY apps/web/package.json apps/web/
COPY examples/quickstart/package.json examples/quickstart/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @lean-harness/widget build && pnpm --filter @lean-harness/web build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY --from=build --chown=node:node /app /app
RUN mkdir -p examples/quickstart/.data && chown node:node examples/quickstart/.data
USER node
EXPOSE 8787
VOLUME /app/examples/quickstart/.data
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--no-warnings", "--import", "tsx", "examples/quickstart/src/index.ts"]
