#!/bin/bash

set -u
set -e

# move old cluster
mv /var/local/dist/data/db /var/local/dist/data/db-old

# get old cluster version
FROM=$(cat /var/local/dist/data/db-old/PG_VERSION)

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
    -D /var/local/dist/data/db

# move config files
# NOTE this can be not quite correct, because it may contains incompatible settings
\cp --preserve /var/local/dist/data/db-old/postgresql.auto.conf /var/local/dist/data/db/postgresql.auto.conf
\cp --preserve /var/local/dist/data/db-old/pg_hba.conf /var/local/dist/data/db
\cp --preserve -R /var/local/dist/data/db-old/conf.d /var/local/dist/data/db
\cp --preserve /var/local/dist/data/db/postgresql.conf /var/local/dist/data/db/conf.d/000-postgresql.conf
\cp --preserve /var/local/dist/data/db-old/postgresql.conf /var/local/dist/data/db

# check clusters compatibility
sudo -u postgres \
    $POSTGRES_HOME/bin/pg_upgrade \
    -b /usr/pgsql-$FROM/bin \
    -B $POSTGRES_HOME/bin \
    -d /var/local/dist/data/db-old \
    -D /var/local/dist/data/db \
    --check

# migrate
sudo -u postgres \
    $POSTGRES_HOME/bin/pg_upgrade \
    -b /usr/pgsql-$FROM/bin \
    -B $POSTGRES_HOME/bin \
    -d /var/local/dist/data/db-old \
    -D /var/local/dist/data/db \
    -O "-c timescaledb.restoring=on"

# TODO perform vacuum
# VACUUM FULL ANALYZE;
