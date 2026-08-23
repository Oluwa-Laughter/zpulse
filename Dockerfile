FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/app ./app
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/components ./components
COPY --from=builder /app/scripts ./scripts

EXPOSE 3000

CMD ["npm", "start"]
