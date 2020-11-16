FROM softvisio/core

ENV POSTGRES_VER=12

ENV POSTGRES_HOME="/usr/pgsql-$POSTGRES_VER"

ENV PATH="$POSTGRES_HOME/bin:$PATH"

RUN \
    # XXX temp fix for centos8
    dnf -y remove repo-pgsql \
    && dnf -y install https://download.postgresql.org/pub/repos/yum/reporpms/EL-8-x86_64/pgdg-redhat-repo-latest.noarch.rpm \
    && dnf -y update pgdg-redhat-repo \
    && dnf -qy module disable postgresql llvm-toolset rust-toolset \
    && dnf config-manager --set-enabled pgdg-centos8-sysupdates \
    \
    # generate additional locales
    # localedef --force -i ru_UA -f UTF-8 ru_UA.UTF-8 \
    && dnf install -y langpacks-ru langpacks-uk \
    \
    && dnf install -y \
        postgresql${POSTGRES_VER}-server \
        postgresql${POSTGRES_VER}-llvmjit \
        postgresql${POSTGRES_VER}-contrib \
        pg${POSTGRES_VER}-extensions \
    \
    # install deps
    && pushd .. \
    && npm i --unsafe --only=prod \
    && popd \
    \
    # clean npm cache
    && rm -rf ~/.npm-cache
