#!/bin/bash

set -u
set -e

# move old cluster
mv /var/lib/pgsql/data /var/lib/pgsql/data-old

# get old cluster version
FROM=$(cat /var/lib/pgsql/data-old/PG_VERSION)

# install old cluster
dnf -y install \
    sudo \
    postgresql$FROM-server \
    postgresql$FROM-contrib \
    pg$FROM-extensions

# create new cluster
# NOTE will ask for superuser password
sudo -u postgres \
    $POSTGRES_HOME/bin/initdb \
    --encoding UTF8 \
    --no-locale \
    -U postgres \
    --pwprompt \
    -D /var/lib/pgsql/data

# move config files
# NOTE this can be not quite correct, because it may contains incompatible settings
\cp --preserve /var/lib/pgsql/data-old/postgresql.auto.conf /var/lib/pgsql/data/postgresql.auto.conf
\cp --preserve /var/lib/pgsql/data-old/pg_hba.conf /var/lib/pgsql/data
\cp --preserve -R /var/lib/pgsql/data-old/conf.d /var/lib/pgsql/data
\cp --preserve /var/lib/pgsql/data/postgresql.conf /var/lib/pgsql/data/conf.d/000-postgresql.conf
\cp --preserve /var/lib/pgsql/data-old/postgresql.conf /var/lib/pgsql/data

# check clusters compatibility
sudo -u postgres \
    $POSTGRES_HOME/bin/pg_upgrade \
    -b /usr/pgsql-$FROM/bin \
    -B $POSTGRES_HOME/bin \
    -d /var/lib/pgsql/data-old \
    -D /var/lib/pgsql/data \
    --check

# migrate
sudo -u postgres \
    $POSTGRES_HOME/bin/pg_upgrade \
    -b /usr/pgsql-$FROM/bin \
    -B $POSTGRES_HOME/bin \
    -d /var/lib/pgsql/data-old \
    -D /var/lib/pgsql/data \
    -O "-c timescaledb.restoring=on"

# TODO perform vacuum
# VACUUM FULL ANALYZE;
