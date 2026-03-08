alter table fabric_remote_bindings
	add column if not exists fabric_name text null;

create index if not exists fabric_remote_bindings_scope_fabric_name_idx
	on fabric_remote_bindings (scope_id, fabric_name)
	where fabric_name is not null;
