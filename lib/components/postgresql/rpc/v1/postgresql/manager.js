export default Super =>
    class extends Super {

        // public
        async [ "API_get-status" ] ( ctx ) {
            return this.app.postgresql.manager.getStatus();
        }

        async [ "API_delete-cluster-old-versions" ] ( ctx, { password } ) {
            if ( password !== this.app.postgresql.config.replication.password ) return result( 401 );

            return this.app.postgresql.manager.deleteClusterOldVersions();
        }
    };
