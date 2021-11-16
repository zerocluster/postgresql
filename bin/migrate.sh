#!/bin/bash

set -u
set -e

pushd /var/lib/postgresql

BACKUP=/var/lib/postgresql/data-backup

# move old cluster
mv /var/lib/postgresql/data $BACKUP

# get old cluster version
FROM=$(cat $BACKUP/PG_VERSION)

dnf remove -y repo-pgsql
dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-8-x86_64/pgdg-redhat-repo-latest.noarch.rpm

# install old cluster
dnf install -y \
    sudo \
    postgresql$FROM-server \
    postgresql$FROM-contrib \
    pg$FROM-extensions

dnf install -y citus_$FROM

# create new cluster, will ask for postgres superuser password
sudo -u postgres \
    $POSTGRES_HOME/bin/initdb \
    --encoding UTF8 \
    --no-locale \
    -U postgres \
    --pwprompt \
    -D /var/lib/postgresql/data

# move config files
# NOTE this can be not quite correct, because it may contains incompatible settings
\cp --preserve $BACKUP/server.crt /var/lib/postgresql/data/server.crt
\cp --preserve $BACKUP/server.key /var/lib/postgresql/data/server.key
\cp --preserve $BACKUP/postgresql.auto.conf /var/lib/postgresql/data/postgresql.auto.conf
\cp --preserve $BACKUP/pg_hba.conf /var/lib/postgresql/data
\cp --preserve -R $BACKUP/conf.d /var/lib/postgresql/data
\cp --preserve /var/lib/postgresql/data/postgresql.conf /var/lib/postgresql/data/conf.d/0-postgresql.conf
\cp --preserve $BACKUP/postgresql.conf /var/lib/postgresql/data

# check clusters compatibility
sudo -u postgres \
    $POSTGRES_HOME/bin/pg_upgrade \
    -b /usr/pgsql-$FROM/bin \
    -B $POSTGRES_HOME/bin \
    -d $BACKUP \
    -D /var/lib/postgresql/data \
    --check

# migrate
sudo -u postgres \
    $POSTGRES_HOME/bin/pg_upgrade \
    -b /usr/pgsql-$FROM/bin \
    -B $POSTGRES_HOME/bin \
    -d $BACKUP \
    -D /var/lib/postgresql/data \
    -O "-c timescaledb.restoring=on"

# TODO perform vacuum
# VACUUM FULL ANALYZE;
