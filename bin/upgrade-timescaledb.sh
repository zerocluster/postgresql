#!/bin/bash

set -u
set -e

CLUSTER=/var/local/dist/data/db

# get cluster version
VER=$(cat $CLUSTER/PG_VERSION)

# install old deps
dnf -y install \
    sudo \
    postgresql$VER \
    postgresql$VER-server \
    postgresql$VER-contrib \
    pg$VER-extensions

# run server without network support
sudo -u postgres \
    /usr/pgsql-$VER/bin/postgres \
    -c listen_addresses="" \
    -D $CLUSTER &

# upgrade timescaledb extension for all databases
psql -X -f /var/local/dist/bin/upgrade-timescaledb.sql
