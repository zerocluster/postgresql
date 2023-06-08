FROM ghcr.io/zerocluster/node

ENV POSTGRES_VERSION=15
ENV POSTGRES_HOME="/usr/lib/postgresql/$POSTGRES_VERSION"
ENV PATH="$POSTGRES_HOME/bin:$PATH" \
    PGUSER=postgres

RUN \
    apt-get update && apt-get install -y \
        postgresql-$POSTGRES_VERSION \
        postgresql-contrib \
        postgresql-$POSTGRES_VERSION-softvisio-admin \
        postgresql-$POSTGRES_VERSION-softvisio-cron \
        postgresql-$POSTGRES_VERSION-softvisio-int53 \
        postgresql-$POSTGRES_VERSION-softvisio-locks \
    \
    # add locales
    && localedef --force -i ru_UA -f UTF-8 ru_UA.UTF-8 \
    \
    # remove default database
    && rm -rf /var/lib/postgresql/$POSTGRES_VERSION/main \
    \
    # install deps
    && npm i --omit=dev \
    \
    # cleanup
    && /bin/bash <(curl -fsSL https://raw.githubusercontent.com/softvisio/scripts/main/env-build-node.sh) cleanup
