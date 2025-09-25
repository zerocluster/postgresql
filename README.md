<!-- !!! DO NOT EDIT, THIS FILE IS GENERATED AUTOMATICALLY !!!  -->

> ℹ️ Please, see the full project documentation here:<br><https://zerocluster.github.io/postgresql/>

# PosrgreSQL

### Debug

```sh
docker run --rm -it --network main -p 5432:5432 -v /var/local/zerocluster/postgresql:/var/local/package -v /var/run/postgresql:/var/run/postgresql -v postgresql:/var/local/package/data --entrypoint bash ghcr.io/zerocluster/postgresql/17
```

### Upgrade client

```sh
apt remove -y postgresql-client-16
apt install -y postgresql-client-17
```

### Upgrade cluster

- Make sure, that old and new clusters use the same versions of timescaledb. If not - upgrade old cluster to the new version first.

```sh
export OLD_POSTGRESQL_VERSION=17
export NEW_POSTGRESQL_VERSION=18
export STACK_NAME=devel
export VOLUME_NAME=${STACK_NAME}_postgresql

# stop and remove stack
docker stack rm $STACK_NAME

docker run \
    --rm -it \
    -v $VOLUME_NAME:/var/local/package/data \
    ghcr.io/zerocluster/postgresql/$NEW_POSTGRESQL_VERSION \
    postgresql upgrade $OLD_POSTGRESQL_VERSION main

vacuumdb --all --analyze-in-stages
```

### Restore from backup

- Remove everything from the cluster data dir;

- unpack `base.tar.gz` to the cluster data dir;

- unpack `pg_wal.tar.gz` to the `pg_wal` directory in the cluster data dir;

### Replication and failover

When cluster configuration chanhed you need to remove unused replication slits.

List replication slots:

```sql
SELECT * FROM pg_replication_slots;
```

Delete non-active slots:

```sql
WITH slots AS (
    SELECT slot_name FROM pg_replication_slots WHERE NOT active
)
SELECT pg_drop_replication_slot( slot_name ) FROM slots;
```

### Update extensions

```sql
CREATE EXTENSION IF NOT EXISTS softvisio_admin CASCADE;

SELECT * FROM outdated_extensions();

SELECT * FROM update_extensions();
```

Update `postgis` extension manually:

```sql
SELECT postgis_full_version();

SELECT * FROM pg_available_extensions WHERE name = 'postgis';

SELECT postgis_extensions_upgrade();

```
