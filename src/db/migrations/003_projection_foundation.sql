create table if not exists projection_checkpoints (
	chain_id bigint not null,
	projection_version bigint not null,
	district_algorithm_version bigint not null,
	anchor_algorithm_version bigint not null,
	corridor_algorithm_version bigint not null,
	surface_algorithm_version bigint not null,
	last_projected_block_number bigint not null,
	last_projected_block_hash text not null,
	updated_at timestamptz not null default now(),
	primary key (
		chain_id,
		projection_version,
		district_algorithm_version,
		anchor_algorithm_version,
		corridor_algorithm_version,
		surface_algorithm_version
	)
);
