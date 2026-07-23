FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod=false
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY repos.json ./
EXPOSE 8080
USER node
CMD ["node", "dist/index.js"]
