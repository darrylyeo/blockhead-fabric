create table if not exists state_surfaces (
	entity_id text not null,
	surface_id text not null,
	surface_kind text not null,
	value_json jsonb not null,
	unit text null,
	visual_channel text not null,
	updated_at_block bigint not null,
	primary key (entity_id, surface_id)
);

create index if not exists state_surfaces_updated_idx
	on state_surfaces (updated_at_block desc);
