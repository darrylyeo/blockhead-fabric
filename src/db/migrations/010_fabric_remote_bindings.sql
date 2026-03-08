create table if not exists fabric_remote_bindings (
	scope_id text not null references fabric_scopes (scope_id) on delete cascade,
	object_id text not null,
	remote_class_id integer not null,
	remote_object_ix bigint not null,
	last_seen_revision bigint not null,
	last_seen_at timestamptz not null default now(),
	primary key (scope_id, object_id),
	unique (scope_id, remote_class_id, remote_object_ix)
);

create index if not exists fabric_remote_bindings_scope_idx
	on fabric_remote_bindings (scope_id);
