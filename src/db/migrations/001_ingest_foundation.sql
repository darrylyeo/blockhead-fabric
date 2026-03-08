create extension if not exists pgcrypto;

create table if not exists rpc_capabilities (
	endpoint_id text primary key,
	chain_id bigint not null,
	supports_block_receipts boolean not null,
	supports_block_hash_logs boolean not null,
	supports_safe_tag boolean not null,
	supports_finalized_tag boolean not null,
	checked_at timestamptz not null,
	raw_json jsonb not null
);

create index if not exists rpc_capabilities_chain_checked_idx on rpc_capabilities (chain_id, checked_at desc);

create table if not exists blocks (
	chain_id bigint not null,
	block_number bigint not null,
	block_hash text not null,
	parent_hash text not null,
	timestamp timestamptz not null,
	gas_used numeric not null,
	gas_limit numeric not null,
	base_fee_per_gas numeric null,
	tx_count integer not null,
	log_count integer not null,
	canonical boolean not null,
	finality_state text not null,
	first_seen_at timestamptz not null,
	primary key (chain_id, block_hash)
);

create unique index if not exists blocks_chain_number_canonical_idx on blocks (chain_id, block_number, canonical) where canonical = true;
create index if not exists blocks_chain_number_idx on blocks (chain_id, block_number desc);
create index if not exists blocks_chain_canonical_number_idx on blocks (chain_id, canonical, block_number desc);
create index if not exists blocks_chain_parent_idx on blocks (chain_id, parent_hash);

create table if not exists transactions (
	chain_id bigint not null,
	tx_hash text not null,
	block_hash text not null,
	block_number bigint not null,
	tx_index integer not null,
	from_address text not null,
	to_address text null,
	contract_address_created text null,
	value_wei numeric not null,
	type integer not null,
	gas_limit numeric not null,
	max_fee_per_gas numeric null,
	max_priority_fee_per_gas numeric null,
	canonical boolean not null,
	primary key (chain_id, tx_hash, block_hash),
	foreign key (chain_id, block_hash) references blocks (chain_id, block_hash)
);

create index if not exists transactions_chain_block_idx on transactions (chain_id, block_hash, tx_index);
create index if not exists transactions_chain_from_idx on transactions (chain_id, from_address, block_number desc);
create index if not exists transactions_chain_to_idx on transactions (chain_id, to_address, block_number desc);
create index if not exists transactions_chain_canonical_idx on transactions (chain_id, canonical, block_number desc);

create table if not exists receipts (
	chain_id bigint not null,
	tx_hash text not null,
	block_hash text not null,
	block_number bigint not null,
	transaction_index integer not null,
	gas_used numeric not null,
	cumulative_gas_used numeric not null,
	effective_gas_price numeric null,
	contract_address text null,
	status integer null,
	canonical boolean not null,
	primary key (chain_id, tx_hash, block_hash),
	foreign key (chain_id, tx_hash, block_hash) references transactions (chain_id, tx_hash, block_hash)
);

create index if not exists receipts_chain_block_idx on receipts (chain_id, block_hash, transaction_index);
create index if not exists receipts_contract_create_idx on receipts (chain_id, contract_address) where contract_address is not null;

create table if not exists logs (
	chain_id bigint not null,
	block_hash text not null,
	block_number bigint not null,
	tx_hash text not null,
	log_index integer not null,
	address text not null,
	topic0 text null,
	topic1 text null,
	topic2 text null,
	topic3 text null,
	data text not null,
	removed boolean not null,
	canonical boolean not null,
	primary key (chain_id, tx_hash, log_index, block_hash),
	foreign key (chain_id, tx_hash, block_hash) references transactions (chain_id, tx_hash, block_hash)
);

create index if not exists logs_chain_block_idx on logs (chain_id, block_hash, log_index);
create index if not exists logs_chain_address_idx on logs (chain_id, address, block_number desc);
create index if not exists logs_chain_topic0_idx on logs (chain_id, topic0, block_number desc);
create index if not exists logs_chain_canonical_idx on logs (chain_id, canonical, block_number desc);

create table if not exists accounts (
	chain_id bigint not null,
	address text not null,
	first_seen_block bigint not null,
	last_seen_block bigint not null,
	is_contract boolean not null,
	code_hash text null,
	last_balance_wei numeric null,
	last_nonce numeric null,
	primary key (chain_id, address)
);

create index if not exists accounts_chain_contract_idx on accounts (chain_id, is_contract, last_seen_block desc);

create table if not exists contracts (
	chain_id bigint not null,
	address text not null,
	creation_tx_hash text null,
	creation_block_number bigint null,
	code_hash text null,
	bytecode_size integer null,
	family_label text null,
	metadata_json jsonb not null default '{}',
	primary key (chain_id, address)
);

create index if not exists contracts_chain_family_idx on contracts (chain_id, family_label);
create index if not exists contracts_chain_creation_idx on contracts (chain_id, creation_block_number desc);

create table if not exists reorg_events (
	id bigserial primary key,
	chain_id bigint not null,
	common_ancestor_number bigint not null,
	common_ancestor_hash text not null,
	removed_count integer not null,
	detected_at timestamptz not null,
	metadata_json jsonb not null
);

create index if not exists reorg_events_chain_detected_idx on reorg_events (chain_id, detected_at desc);

create table if not exists ingest_checkpoints (
	chain_id bigint primary key,
	last_seen_block_number bigint not null,
	last_seen_block_hash text not null,
	last_finalized_block_number bigint not null,
	updated_at timestamptz not null
);

create table if not exists projection_jobs (
	id bigserial primary key,
	chain_id bigint not null,
	from_block_number bigint not null,
	to_block_number bigint not null,
	status text not null,
	attempt_count integer not null default 0,
	last_error text null,
	created_at timestamptz not null default now(),
	started_at timestamptz null,
	finished_at timestamptz null
);

create index if not exists projection_jobs_chain_status_idx on projection_jobs (chain_id, status, from_block_number, to_block_number);
