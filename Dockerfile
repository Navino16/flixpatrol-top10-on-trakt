FROM debian:bookworm-slim

LABEL org.opencontainers.image.source="https://github.com/Navino16/flixpatrol-top10-on-trakt"
LABEL org.opencontainers.image.description="Sync FlixPatrol Top 10 to Trakt lists"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Create non-root user with a real home directory. pkg's native-module extractor
# (used by `impit`) writes `.node` files under $HOME at runtime, so without an
# existing home directory the binary aborts with "impit couldn't load native bindings".
RUN groupadd -g 1000 flixpatrol && \
    useradd -u 1000 -g flixpatrol -s /bin/sh -m -d /home/flixpatrol flixpatrol && \
    mkdir -p /app/config && \
    chown -R flixpatrol:flixpatrol /app /home/flixpatrol

# Copy binary based on architecture
ARG TARGETARCH
COPY ./bin/flixpatrol-top10-linux-${TARGETARCH} /app/flixpatrol-top10

RUN chmod +x /app/flixpatrol-top10

USER flixpatrol

VOLUME /app/config

ENTRYPOINT ["/app/flixpatrol-top10"]