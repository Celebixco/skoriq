FROM node:24-alpine AS deps
WORKDIR /app
COPY . .
RUN npm install --include=dev

FROM deps AS build
RUN npm run build -w @sports-data/api
RUN npm prune --omit=dev --workspaces

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
