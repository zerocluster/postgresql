FROM softvisio/pcore:v0.135.2

LABEL maintainer="zdm <zdm@softvisio.net>"

USER root

ENV DIST_PATH="$WORKSPACE/pgsql" \
    POSTGRES_VER=12

ENV POSTGRES_HOME="/usr/pgsql-$POSTGRES_VER"

ENV PATH="$POSTGRES_HOME/bin:$PATH"

ADD . $DIST_PATH

WORKDIR $DIST_PATH/data

RUN \
    # setup perl build env
    # curl -fsSL https://bitbucket.org/softvisio/scripts/raw/master/env-build-perl.sh | /bin/bash -s -- setup \
    \
    # generate additional locales
    # localedef --force -i ru_UA -f UTF-8 ru_UA.UTF-8 \
    dnf install -y langpacks-ru langpacks-uk \
    \
    && dnf install -y \
        postgresql${POSTGRES_VER}-server \
        postgresql${POSTGRES_VER}-llvmjit \
        postgresql${POSTGRES_VER}-contrib \
        pg${POSTGRES_VER}-extensions \
        --nobest \
    \
    # deploy
    && pcore deploy --recommends --suggests \
    && pcore test -j $(nproc)
    # \
    # cleanup perl build env
    # && curl -fsSL https://bitbucket.org/softvisio/scripts/raw/master/env-build-perl.sh | /bin/bash -s -- cleanup

ENTRYPOINT [ "/bin/bash", "-l", "-c", "exec ../bin/docker-run.sh \"$@\"", "bash" ]
