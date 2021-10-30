#!/bin/bash

set -u
set -e

pushd /var/lib/pgsql

BACKUP=/var/lib/pgsql/data-backup

# move old cluster
mv /var/lib/pgsql/data $BACKUP

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
    -D /var/lib/pgsql/data

# move config files
# NOTE this can be not quite correct, because it may contains incompatible settings
\cp --preserve $BACKUP/server.crt /var/lib/pgsql/data/server.crt
\cp --preserve $BACKUP/server.key /var/lib/pgsql/data/server.key
\cp --preserve $BACKUP/postgresql.auto.conf /var/lib/pgsql/data/postgresql.auto.conf
\cp --preserve $BACKUP/pg_hba.conf /var/lib/pgsql/data
\cp --preserve -R $BACKUP/conf.d /var/lib/pgsql/data
\cp --preserve /var/lib/pgsql/data/postgresql.conf /var/lib/pgsql/data/conf.d/0-postgresql.conf
\cp --preserve $BACKUP/postgresql.conf /var/lib/pgsql/data

# check clusters compatibility
sudo -u postgres \
    $POSTGRES_HOME/bin/pg_upgrade \
    -b /usr/pgsql-$FROM/bin \
    -B $POSTGRES_HOME/bin \
    -d $BACKUP \
    -D /var/lib/pgsql/data \
    --check

# migrate
sudo -u postgres \
    $POSTGRES_HOME/bin/pg_upgrade \
    -b /usr/pgsql-$FROM/bin \
    -B $POSTGRES_HOME/bin \
    -d $BACKUP \
    -D /var/lib/pgsql/data \
    -O "-c timescaledb.restoring=on"

# TODO perform vacuum
# VACUUM FULL ANALYZE;
