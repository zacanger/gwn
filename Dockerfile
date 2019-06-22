FROM mhart/alpine-node:10
# hadolint ignore=DL3018
RUN apk add --no-cache git tar zip gzip
# RUN addgroup -g 1000 -S node && \
#     adduser -u 1000 -S node -G node
WORKDIR /app
# COPY --chown=node:node . .
COPY . .
RUN npm ci --production --no-optional
# USER node
ENV NODE_ENV=production \
    TERM=linux \
    TERMINFO=/etc/terminfo
EXPOSE 9999
HEALTHCHECK --interval=30s \
    --timeout=2s \
    --retries=10 \
    CMD node /app/scripts/healthcheck.js
CMD ["node", "."]
