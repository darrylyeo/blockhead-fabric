create table if not exists event_stream_checkpoints (
	chain_id bigint not null,
	stream_id text not null,
	last_seen_block bigint not null,
	updated_at timestamptz not null default now(),
	primary key (chain_id, stream_id)
);
