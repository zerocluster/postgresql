FROM ghcr.io/zerocluster/node/app

ARG POSTGRESQL_VERSION \
    POSTGIS_VERSION

ENV POSTGRESQL_VERSION=$POSTGRESQL_VERSION \
    PATH="/usr/lib/postgresql/$POSTGRESQL_VERSION:$PATH" \
    PGUSER=postgres

RUN \
    apt-get update && apt-get install -y \
        postgresql-$POSTGRESQL_VERSION \
        postgresql-contrib \
        postgresql-$POSTGRESQL_VERSION-postgis-$POSTGIS_VERSION \
        postgresql-$POSTGRESQL_VERSION-softvisio-admin \
        postgresql-$POSTGRESQL_VERSION-softvisio-types \
        postgresql-$POSTGRESQL_VERSION-softvisio-locks \
    \
    # add locales
    && localedef --force -i ru_UA -f UTF-8 ru_UA.UTF-8 \
    \
    # remove default cluster
    && rm -rf /var/lib/postgresql/$POSTGRESQL_VERSION/main \
    \
    # install deps
    && NODE_ENV=production npm i \
    \
    # cleanup
    && /bin/bash <(curl -fsSL https://raw.githubusercontent.com/softvisio/scripts/main/env-build-node.sh) cleanup
