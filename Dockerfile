FROM ghcr.io/zerocluster/node

LABEL org.opencontainers.image.source https://github.com/zerocluster/pgsql

ENV POSTGRES_VERSION=14
ENV POSTGRES_HOME="/usr/lib/postgresql/$POSTGRES_VERSION"
ENV PATH="$POSTGRES_HOME/bin:$PATH" \
    PGUSER=postgres

RUN \
    apt update && apt install -y \
        postgresql-$POSTGRES_VERSION \
        postgresql-contrib \
        postgresql-$POSTGRES_VERSION-softvisio-admin \
        postgresql-$POSTGRES_VERSION-softvisio-cron \
        postgresql-$POSTGRES_VERSION-softvisio-locks \
        postgresql-$POSTGRES_VERSION-timescaledb \
    \
    # add locales
    && localedef --force -i ru_UA -f UTF-8 ru_UA.UTF-8 \
    \
    # install deps
    && npm i --omit=dev \
    \
    # cleanup
    && curl -fsSL https://raw.githubusercontent.com/softvisio/scripts/main/env-build-node.sh | /bin/bash -s -- cleanup
