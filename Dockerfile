FROM softvisio/core:latest

LABEL maintainer="zdm <zdm@softvisio.net>"

USER root

ENV DIST_PATH="$WORKSPACE/pgsql" \
    POSTGRES_VER=12

ENV POSTGRES_HOME="/usr/pgsql-$POSTGRES_VER"

ENV PATH="$POSTGRES_HOME/bin:$PATH"

ADD . $DIST_PATH

WORKDIR $DIST_PATH/data

RUN \
    # generate additional locales
    # localedef --force -i ru_UA -f UTF-8 ru_UA.UTF-8 \
    dnf install -y langpacks-ru langpacks-uk \
    \
    && dnf install -y \
        postgresql${POSTGRES_VER}-server \
        postgresql${POSTGRES_VER}-llvmjit \
        postgresql${POSTGRES_VER}-contrib \
        pg${POSTGRES_VER}-extensions
        --nobest \

ENTRYPOINT [ "/bin/bash", "-l", "-c", "node ../bin/main.js \"$@\"", "bash" ]
