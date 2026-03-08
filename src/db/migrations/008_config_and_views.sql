create table if not exists config_revisions (
	id bigserial primary key,
	config_kind text not null,
	version bigint not null,
	payload_json jsonb not null,
	activated_at_block bigint null,
	created_at timestamptz not null default now(),
	unique (config_kind, version)
);

create or replace view canonical_blocks as
select *
from blocks
where canonical = true;

create or replace view canonical_transactions as
select *
from transactions
where canonical = true;

create or replace view canonical_logs as
select *
from logs
where canonical = true
	and removed = false;
