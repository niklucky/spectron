FROM node:24-alpine AS build
WORKDIR /workspace
RUN npm install --global pnpm@9.15.0
COPY . .
RUN pnpm install --frozen-lockfile
ARG APP=app
RUN pnpm --filter @spectron/${APP} build && cp -r apps/${APP}/dist /site
RUN if [ "$APP" = "app" ]; then cp deploy/nginx.app.conf /nginx.conf; else cp deploy/nginx.conf /nginx.conf; fi

FROM nginx:stable-alpine
COPY --from=build /nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /site /usr/share/nginx/html
EXPOSE 80
