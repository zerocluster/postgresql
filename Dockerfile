FROM zerocluster/node

ENV POSTGRES_VERSION=14
ENV POSTGRES_HOME="/usr/lib/postgresql/$POSTGRES_VERSION"
ENV PATH="$POSTGRES_HOME/bin:$PATH"

HEALTHCHECK NONE

RUN \
    # generate additional locales
    # localedef --force -i ru_UA -f UTF-8 ru_UA.UTF-8 \
    # apt install -y langpacks-ru langpacks-uk \
    \
    apt install -y \
        postgresql-$POSTGRES_VERSION \
        postgresql-contrib \
        pg$POSTGRES_VERSION-extensions \
    \
    # install deps
    && npm i --omit=dev \
    \
    # cleanup
    && curl -fsSL https://raw.githubusercontent.com/softvisio/scripts/main/env-build-node.sh | /bin/bash -s -- cleanup
