FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY scripts/ ./scripts/
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build


FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache \
  chromium \
  fontconfig \
  freetype \
  harfbuzz \
  nss \
  ttf-freefont

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist/ ./dist/

ENV HUBTHE_URL=https://hubthe.team
ENV HUBTHE_PROJECT=
ENV PORT=8080
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 8080

ENTRYPOINT ["node", "dist/index.js"]
CMD ["--http"]
