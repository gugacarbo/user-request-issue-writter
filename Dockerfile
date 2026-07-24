FROM node:20-alpine AS build
WORKDIR /app
# better-sqlite3 is a native addon: needs python3 + make + g++ to compile
# during `pnpm install`. Kept in the build stage only (runtime uses the
# prebuilt binary copied from node_modules).
RUN apk add --no-cache python3 make g++
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod=false
COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
RUN pnpm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Runtime needs the native addon; reinstalling prod deps rebuilds it for
# the runtime arch (alpine/musl). python3/make/g++ are required for that
# rebuild, then removed in the same layer to keep the image lean.
COPY .npmrc ./
RUN apk add --no-cache python3 make g++ \
	&& corepack enable \
	&& pnpm install --frozen-lockfile --prod \
	&& apk del python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
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