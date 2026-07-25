FROM node:24-alpine
WORKDIR /app
COPY apps/multi-terminal/package.json ./package.json
COPY apps/multi-terminal/src ./src
COPY apps/multi-terminal/public ./public
ENV MULTI_TERMINAL_PORT=4311
EXPOSE 4311
USER node
CMD ["node", "src/index.mjs"]
