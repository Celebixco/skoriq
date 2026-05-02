FROM node:24-alpine AS build

WORKDIR /app

ARG VITE_API_BASE_URL
ARG VITE_APP_ENV
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_APP_ENV=$VITE_APP_ENV

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build -w @sports-data/dashboard

FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
RUN printf 'server {\n  listen 80;\n  server_name _;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / { try_files $uri $uri/ /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
