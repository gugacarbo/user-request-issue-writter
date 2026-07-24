FROM node:22-alpine AS build
WORKDIR /app
# better-sqlite3 is a native addon: needs python3 + make + g++ to compile
# during `pnpm install`. Kept in the build stage only (runtime uses the
# prebuilt binary copied from node_modules).
RUN apk add --no-cache python3 make g++
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json drizzle.config.ts vite.config.ts ./
COPY src ./src
RUN pnpm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Runtime needs the native addon; reinstalling prod deps rebuilds it for
# the runtime arch (alpine/musl). python3/make/g++ are required for that
# rebuild, then removed in the same layer to keep the image lean.
RUN apk add --no-cache python3 make g++ \
	&& corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# --ignore-scripts skips the `prepare` hook (husky), which uses a devDependency
# not installed in the production image.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts \
	&& apk del python3 make g++
COPY --from=build /app/dist ./dist
# Migrations are applied at boot by createDb() (ADR-0007); they must ship
# with the image.
COPY migrations ./migrations
COPY repos.json ./
# SQLite database lives in a named volume so it survives restarts (ADR-0008).
VOLUME ["/app/data"]
ENV DATABASE_PATH=/app/data/app.db
EXPOSE 8080
USER node
CMD ["node", "dist/index.js"]
