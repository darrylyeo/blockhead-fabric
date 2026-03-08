create table if not exists districts (
	chain_id bigint not null,
	district_id text not null,
	district_key text not null,
	origin_x numeric not null,
	origin_y numeric not null,
	origin_z numeric not null,
	entity_count integer not null,
	contract_count integer not null,
	account_count integer not null,
	activity_window_32 integer not null,
	projection_version bigint not null,
	updated_at_block bigint not null,
	primary key (chain_id, district_id)
);

create index if not exists districts_chain_activity_idx
	on districts (chain_id, activity_window_32 desc);

create table if not exists district_memberships (
	chain_id bigint not null,
	entity_id text not null,
	entity_kind text not null,
	district_id text not null,
	district_algorithm_version bigint not null,
	updated_at_block bigint not null,
	primary key (chain_id, entity_id)
);

create index if not exists district_memberships_chain_district_idx
	on district_memberships (chain_id, district_id);

create table if not exists entity_anchors (
	chain_id bigint not null,
	entity_id text not null,
	entity_kind text not null,
	district_id text not null,
	anchor_x numeric not null,
	anchor_y numeric not null,
	anchor_z numeric not null,
	slot_key text not null,
	collision_rank integer not null,
	landmark_rank integer null,
	anchor_algorithm_version bigint not null,
	updated_at_block bigint not null,
	primary key (chain_id, entity_id)
);

create index if not exists entity_anchors_chain_district_idx
	on entity_anchors (chain_id, district_id);

create index if not exists entity_anchors_chain_landmark_idx
	on entity_anchors (chain_id, district_id, landmark_rank);
