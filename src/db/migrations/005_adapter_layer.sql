create table if not exists adapter_entities (
	chain_id bigint not null,
	address text not null,
	adapter_id text not null,
	adapter_version integer not null,
	protocol_id text not null,
	family text not null,
	confidence text not null,
	style_family text not null,
	metadata_json jsonb not null default '{}',
	detected_at_block bigint not null,
	updated_at_block bigint not null,
	primary key (chain_id, address, adapter_id)
);

create index if not exists adapter_entities_chain_family_idx
	on adapter_entities (chain_id, family, confidence);

create table if not exists adapter_events (
	chain_id bigint not null,
	adapter_id text not null,
	tx_hash text not null,
	block_hash text not null,
	log_index integer not null,
	target_address text not null,
	event_family text not null,
	payload_json jsonb not null,
	canonical boolean not null,
	primary key (chain_id, adapter_id, tx_hash, log_index, block_hash)
);

create index if not exists adapter_events_chain_target_idx
	on adapter_events (chain_id, target_address, event_family, canonical);

create table if not exists adapter_surfaces (
	chain_id bigint not null,
	address text not null,
	adapter_id text not null,
	surface_id text not null,
	surface_kind text not null,
	value_json jsonb not null,
	unit text null,
	visual_channel text not null,
	source_mode text not null,
	updated_at_block bigint not null,
	primary key (chain_id, address, adapter_id, surface_id)
);

create index if not exists adapter_surfaces_chain_address_idx
	on adapter_surfaces (chain_id, address);

create table if not exists adapter_hints (
	chain_id bigint not null,
	address text not null,
	adapter_id text not null,
	hint_type text not null,
	payload_json jsonb not null,
	updated_at_block bigint not null,
	primary key (chain_id, address, adapter_id, hint_type)
);

create index if not exists adapter_hints_chain_type_idx
	on adapter_hints (chain_id, hint_type, updated_at_block desc);
