FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=7171 \
    CONFIG_DIR=/config \
    NODE_NO_WARNINGS=1
# yt-dlp + ffmpeg download and merge trailers.
RUN apk add --no-cache ffmpeg yt-dlp
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
# Unraid's default nobody:users, so files in /config stay editable from the host.
RUN mkdir -p /config && chown 99:100 /config
USER 99:100
VOLUME /config
EXPOSE 7171
CMD ["node", "server/dist/index.js"]
