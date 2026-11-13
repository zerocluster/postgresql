FROM ghcr.io/zerocluster/node/app

ARG POSTGRESQL_VERSION
ARG POSTGIS_VERSION

ENV POSTGRESQL_VERSION=$POSTGRESQL_VERSION \
    POSTGIS_VERSION=$POSTGIS_VERSION \
    PATH="/usr/lib/postgresql/$POSTGRESQL_VERSION/bin:$PATH" \
    PGUSER=postgres

RUN <<EOF
#!/usr/bin/env -S bash

set -Eeuo pipefail
trap 'echo "⚠  Error ($0:$LINENO, exit code: $?): $BASH_COMMAND" >&2' ERR

# install postgresql
apt-get update
apt-get install -y \
    postgresql-$POSTGRESQL_VERSION \
    postgresql-$POSTGRESQL_VERSION-pgvector \
    postgresql-$POSTGRESQL_VERSION-postgis-$POSTGIS_VERSION \
    postgresql-$POSTGRESQL_VERSION-softvisio \
    postgresql-$POSTGRESQL_VERSION-softvisio-admin

# make extensions trusted
for extension in postgis vector; do
    control_file="$(pg_config --sharedir)/extension/${extension}.control"
    sed -i '/^trusted[[:space:]]*=/d' "$control_file"
    echo 'trusted = true' >> "$control_file"
done

# add locales
# NOTE: not used because now we use `icu` locale provider
# localedef --force -i ru_UA -f UTF-8 ru_UA.UTF-8

# remove default cluster
rm -rf /var/lib/postgresql/$POSTGRESQL_VERSION/main

# cleanup
script=$(curl -fsSL "https://raw.githubusercontent.com/softvisio/scripts/main/env-build-node.sh")
bash <(echo "$script") cleanup
EOF

RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
    <<EOF
#!/usr/bin/env -S bash

set -Eeuo pipefail
trap 'echo "⚠  Error ($0:$LINENO, exit code: $?): $BASH_COMMAND" >&2' ERR

# install dependencies
NODE_ENV=production npm install-clean

# cleanup
script=$(curl -fsSL "https://raw.githubusercontent.com/softvisio/scripts/main/env-build-node.sh")
bash <(echo "$script") cleanup
EOF
