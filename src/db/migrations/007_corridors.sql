create table if not exists corridors (
	chain_id bigint not null,
	corridor_key text not null,
	source_district_id text not null,
	target_district_id text not null,
	flow_class text not null,
	token_class text not null,
	window_size integer not null,
	event_count integer not null,
	distinct_tx_count integer not null,
	total_value_wei numeric null,
	token_transfer_count integer null,
	last_seen_block bigint not null,
	published boolean not null,
	corridor_algorithm_version bigint not null,
	updated_at_block bigint not null,
	primary key (chain_id, corridor_key)
);

create index if not exists corridors_chain_source_window_idx
	on corridors (chain_id, source_district_id, window_size, event_count desc);

create index if not exists corridors_chain_target_window_idx
	on corridors (chain_id, target_district_id, window_size, event_count desc);

create index if not exists corridors_chain_published_idx
	on corridors (chain_id, published, window_size);
