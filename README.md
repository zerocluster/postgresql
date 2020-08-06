# HOW TO CONNECT

```
pgsql://username:password@host:port?db=dbname

pgsql://username:password@/path/to/unix/socket?db=dbname&...
```

# HOW TO UPGRADE

-   Make sure, that old and new cluster use the same versions of timescaledb. If not - upgrade old cluster to the new version first. Look at `upgrade-timescaledb.sh` script.

-   Migrate

```
./pgsql enter

/var/local/dist/bin/migrate.sh
```

-   After successful upgrade old cluster can be removed:

```
# remove old cluster
rm -rf /var/lib/docker/volumes/pgsql/_data/db-old
```

# UPGRADE TIMESCALEDB

-   Stop cluster;

```
./pgsql enter

/var/local/dist/bin/upgrade-timescaledb.sh
```
