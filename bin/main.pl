#!/usr/bin/env perl

package main v0.1.0;

use Pcore;
use Pcore::Service::PgSQL;

my $instance = Pcore::Service::PgSQL->new( { data_dir => $ENV->{DATA_DIR} } );

$instance->run;

1;
__END__
=pod

=encoding utf8

=cut
