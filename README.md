<!-- !!! DO NOT EDIT, THIS FILE IS GENERATED AUTOMATICALLY !!!  -->

> :information_source: Please, see the full project documentation here: [https://zerocluster.github.io/postgresql/](https://zerocluster.github.io/postgresql/).

# PosrgreSQL

### Debug

```shell
docker run --rm -it --network main -p 5432:5432 -v /var/local/zerocluster/postgresql:/var/local/package -v /var/run/postgresql:/var/run/postgresql -v postgresql:/var/local/package/data --entrypoint bash ghcr.io/zerocluster/postgresql/16
```

### Upgrade cluster

-   Make sure, that old and new clusters use the same versions of timescaledb. If not - upgrade old cluster to the new version first.

```shell
docker stack rm postgresql

docker run --rm -it --pull=never -v postgresql:/var/local/package/data --entrypoint bash ghcr.io/zerocluster/postgresql/16

/var/local/package/bin/main.js postgresql upgrade 16 main
```

### Upgrade timescaledb

-   Upgrade docker container to the latest version, contained new `timescaledb` extension version.

-   From `psql` execute:

```sql
psql -h <HOST>

# install and update softvisio_admin extension
CREATE EXTENSION IF NOT EXISTS softvisio_admin CASCADE;
ALTER EXTENSION softvisio_admin UPDATE;

# update all extensions for all databases to the latest available versions
CALL update_extensions();
```

### Restore from backup

-   Remove everything from the cluster data dir;

-   unpack `base.tar.gz` to the cluster data dir;

-   unpack `pg_wal.tar.gz` to the `pg_wal` directory in the cluster data dir;

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

### PostGIs

#### Update extension

```sql
SELECT postgis_full_version();

SELECT * FROM pg_available_extensions WHERE name = 'postgis';

SELECT postgis_extensions_upgrade();

```
