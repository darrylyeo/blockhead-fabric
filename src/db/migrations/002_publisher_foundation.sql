create table if not exists fabric_scopes (
	scope_id text primary key,
	chain_id bigint not null,
	name text not null,
	entry_msf_path text not null,
	desired_revision bigint not null,
	published_revision bigint not null default 0,
	status text not null
);

create table if not exists fabric_entrypoints (
	scope_id text not null references fabric_scopes (scope_id) on delete cascade,
	entrypoint_id text not null,
	name text not null,
	root_object_id text not null,
	desired_revision bigint not null,
	published_revision bigint not null default 0,
	primary key (scope_id, entrypoint_id)
);

create table if not exists fabric_objects (
	scope_id text not null,
	object_id text not null,
	entrypoint_id text not null,
	parent_object_id text not null,
	entity_id text null,
	class_id integer not null,
	type integer not null,
	subtype integer not null,
	name text not null,
	transform_json jsonb not null,
	bound_json jsonb null,
	resource_reference text null,
	resource_name text null,
	metadata_json jsonb not null default '{}',
	deleted boolean not null default false,
	desired_revision bigint not null,
	published_revision bigint not null default 0,
	updated_at_block bigint not null,
	primary key (scope_id, object_id),
	foreign key (scope_id, entrypoint_id) references fabric_entrypoints (scope_id, entrypoint_id) on delete cascade
);

create table if not exists fabric_attachments (
	scope_id text not null,
	object_id text not null,
	child_scope_id text not null references fabric_scopes (scope_id),
	resource_reference text not null,
	desired_revision bigint not null,
	primary key (scope_id, object_id),
	foreign key (scope_id, object_id) references fabric_objects (scope_id, object_id) on delete cascade
);

create table if not exists publication_checkpoints (
	scope_id text primary key references fabric_scopes (scope_id) on delete cascade,
	last_attempted_revision bigint not null,
	last_published_revision bigint not null,
	status text not null,
	last_error text null,
	updated_at timestamptz not null default now()
);

create index if not exists fabric_objects_scope_parent_idx
	on fabric_objects (scope_id, parent_object_id);

create index if not exists fabric_objects_scope_entrypoint_idx
	on fabric_objects (scope_id, entrypoint_id);

create index if not exists fabric_objects_scope_entity_idx
	on fabric_objects (scope_id, entity_id);

create index if not exists fabric_objects_scope_revision_idx
	on fabric_objects (scope_id, desired_revision, published_revision);
