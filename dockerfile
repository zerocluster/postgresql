FROM ghcr.io/zerocluster/node/app

ARG POSTGRESQL_VERSION
ARG POSTGIS_VERSION

ENV POSTGRESQL_VERSION=$POSTGRESQL_VERSION \
    POSTGIS_VERSION=$POSTGIS_VERSION \
    PATH="/usr/lib/postgresql/$POSTGRESQL_VERSION/bin:$PATH" \
    PGUSER=postgres

RUN \
    # install postgresql
    apt-get update && apt-get install -y \
        postgresql-$POSTGRESQL_VERSION \
        postgresql-$POSTGRESQL_VERSION-pgvector \
        postgresql-contrib \
        postgresql-$POSTGRESQL_VERSION-postgis-$POSTGIS_VERSION \
        postgresql-$POSTGRESQL_VERSION-softvisio-admin \
        postgresql-$POSTGRESQL_VERSION-softvisio-types \
    \
    # add locales
    && localedef --force -i ru_UA -f UTF-8 ru_UA.UTF-8 \
    \
    # remove default cluster
    && rm -rf /var/lib/postgresql/$POSTGRESQL_VERSION/main \
    \
    # cleanup
    && script=$(curl -fsSL "https://raw.githubusercontent.com/softvisio/scripts/main/env-build-node.sh") \
    && bash <(echo "$script") cleanup

RUN \
    # install dependencies
    NODE_ENV=production npm install-clean \
    \
    # cleanup
    && script=$(curl -fsSL "https://raw.githubusercontent.com/softvisio/scripts/main/env-build-node.sh") \
    && bash <(echo "$script") cleanup
