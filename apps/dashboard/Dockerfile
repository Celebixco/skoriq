FROM node:24-alpine AS build

WORKDIR /app

ARG VITE_API_BASE_URL
ARG VITE_APP_ENV
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_APP_ENV=$VITE_APP_ENV

COPY package.json package-lock.json* ./
COPY . .
RUN npm install --include=dev
RUN npm run build -w @sports-data/dashboard

FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
