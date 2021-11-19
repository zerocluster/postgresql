#!/bin/bash

set -u
set -e

# XXX take old and new versions from command list args

OLD_VERSION=14 # FROM=$(cat $BACKUP/PG_VERSION)
OLD_CLUSTER=/var/lib/docker/volumes/pgsql/_data/$OLD_VERSION

NEW_VERSION=15
NEW_CLUSTER=/var/lib/docker/volumes/pgsql/_data/$NEW_VERSION

apt update

# install old cluster
apt install -y \
    sudo \
    postgresql-contrib \
    postgresql-$OLD_VERSION \
    pg$OLD_VERSION-extensions \
    postgresql-$NEW_VERSION \
    pg$NEW_VERSION-extensions

# create new cluster, will ask for postgres superuser password
sudo -u postgres \
    $POSTGRES_HOME/bin/initdb \
    --encoding UTF8 \
    --no-locale \
    -U postgres \
    --pwprompt \
    -D $NEW_CLUSTER

# move config files
# NOTE this can be not quite correct, because it may contains incompatible settings
\cp --preserve $OLD_CLUSTER/server.crt $NEW_CLUSTER/server.crt
\cp --preserve $OLD_CLUSTER/server.key $NEW_CLUSTER/server.key
\cp --preserve $OLD_CLUSTER/postgresql.auto.conf $NEW_CLUSTER/postgresql.auto.conf
\cp --preserve $OLD_CLUSTER/pg_hba.conf $NEW_CLUSTER
\cp --preserve -R $OLD_CLUSTER/conf.d $NEW_CLUSTER
\cp --preserve $NEW_CLUSTER/postgresql.conf $NEW_CLUSTER/conf.d/0-postgresql.conf
\cp --preserve $OLD_CLUSTER/postgresql.conf $NEW_CLUSTER

# check clusters compatibility
sudo -u postgres \
    $POSTGRES_HOME/bin/pg_upgrade \
    -b /usr/lib/postgresql/$OLD_VERSION/bin \
    -B /usr/lib/postgresql/$NEW_VERSION/bin \
    -d $OLD_CLUSTER \
    -D $NEW_CLUSTER \
    --check

# migrate
sudo -u postgres \
    $POSTGRES_HOME/bin/pg_upgrade \
    -b /usr/lib/postgresql/$OLD_VERSION/bin \
    -B /usr/lib/postgresql/$NEW_VERSION/bin \
    -d $OLD_CLUSTER \
    -D $NEW_CLUSTER \
    -O "-c timescaledb.restoring=on"

# TODO perform vacuum
# VACUUM FULL ANALYZE;
