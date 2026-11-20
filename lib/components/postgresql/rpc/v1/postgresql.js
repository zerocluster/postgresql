export default Super =>
    class extends Super {

        // public
        async [ "API_get-status" ] ( ctx ) {
            return this.app.postgresql.cluster.getStatus();
        }

        async [ "API_recover" ] ( ctx ) {
            return this.app.postgresql.cluster.recoverCluster();
        }

        async [ "API_start" ] ( ctx, { role, replicationHostname } ) {
            return this.app.postgresql.cluster.startCluster( role, {
                replicationHostname,
            } );
        }

        async [ "API_stop" ] ( ctx ) {
            return this.app.postgresql.cluster.stopCluster();
        }

        async [ "API_delete-cluster-old-versions" ] ( ctx, { password } ) {
            if ( password !== this.app.postgresql.config.replication.password ) return result( 401 );

            return this.app.postgresql.cluster.deleteClusterOldVersions();
        }
    };
