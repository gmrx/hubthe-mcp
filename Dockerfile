FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build


FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist/ ./dist/

ENV HUBTHE_URL=https://hubthe.team
ENV PORT=8080

EXPOSE 8080

ENTRYPOINT ["node", "dist/index.js"]
CMD ["--http"]
