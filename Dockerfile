FROM ubuntu:latest
LABEL authors="Navino16"

WORKDIR /app

RUN mkdir -p "/app/config"

COPY ./bin/flixpatrol-top10-linux /app/flixpatrol-top10

VOLUME /app/config

RUN chmod +x /app/flixpatrol-top10

ENTRYPOINT ["/app/flixpatrol-top10"]
