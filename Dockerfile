FROM zerocluster/node

ENV POSTGRES_VERSION=14
ENV POSTGRES_HOME="/usr/lib/postgresql/$POSTGRES_VERSION"
ENV PATH="$POSTGRES_HOME/bin:$PATH"

HEALTHCHECK NONE

RUN \
    apt update && apt install -y \
        postgresql-$POSTGRES_VERSION \
        postgresql-contrib \
        pg$POSTGRES_VERSION-extensions \
    \
    # add locales
    && localedef --force -i ru_UA -f UTF-8 ru_UA.UTF-8 \
    \
    # share socket
    && ln -fs /var/run/postgresql /var/lib/postgresql/sock \
    # install deps
    && npm i --omit=dev \
    \
    # cleanup
    && curl -fsSL https://raw.githubusercontent.com/softvisio/scripts/main/env-build-node.sh | /bin/bash -s -- cleanup
