FROM alpine:3.21

LABEL org.opencontainers.image.source="https://github.com/Navino16/flixpatrol-top10-on-trakt"
LABEL org.opencontainers.image.description="Sync FlixPatrol Top 10 to Trakt lists"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Create non-root user
RUN addgroup -g 1000 flixpatrol && \
    adduser -u 1000 -G flixpatrol -s /bin/sh -D flixpatrol && \
    mkdir -p /app/config && \
    chown -R flixpatrol:flixpatrol /app

# Copy binary based on architecture
ARG TARGETARCH
COPY ./bin/flixpatrol-top10-linux-${TARGETARCH} /app/flixpatrol-top10

RUN chmod +x /app/flixpatrol-top10

USER flixpatrol

VOLUME /app/config

ENTRYPOINT ["/app/flixpatrol-top10"]