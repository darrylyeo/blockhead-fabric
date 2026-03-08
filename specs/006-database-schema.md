# Blockhead Fabric Database Schema

## Goal

Define the concrete Postgres schema for the blockhead-fabric backend.

This schema must support:

- canonical chain ingest
- reorg-safe replay
- projection jobs and checkpoints
- adapter persistence
- desired Fabric state
- publication checkpoints

This document is derived from the current architecture, projection, and adapter specs:

- `002-backend-architecture.md`
- `004-projection-algorithms.md`
- `005-protocol-adapters.md`

## Design Principles

- Postgres is the canonical source of truth
- chain facts are append-first and reorg-safe
- derived state is recomputable from canonical facts
- desired Fabric state is stored separately from upstream Fabric server state
- desired Fabric state may be richer than what current upstream Fabric servers can publish without adapters, sidecars, or forks
- every mutable table needs a clear rebuild story
- all tables should support deterministic replay and idempotent writes

## Non-Goals

This schema does not try to model:

- the upstream `MSF_Map_Svc` / `MSF_Map_Db` internal schema
- user-authored content editing
- analytics-only warehouse tables
- arbitrary historical snapshots of every rendered frame

## Schema Layout

Use one logical Postgres schema:

- `public`

Keep naming grouped by responsibility:

- config and capabilities
- canonical ingest journal
- projection state
- adapter state
- desired Fabric state
- publication state

## Type Conventions

Use these PostgreSQL type conventions:

- `bigint` for chain IDs, block numbers, and numeric counters that fit 64-bit
- `numeric` for wei-valued quantities and large gas-related fields
- `text` for hashes, addresses, IDs, labels, and enum-like string states
- `jsonb` for structured metadata and semantically versioned payloads
- `timestamptz` for wall-clock timestamps
- `boolean` for canonicality and flags

## Value Encoding Rules

### Addresses

Store addresses as lowercase hex `text`.

Rule:

- normalize before insert

### Hashes

Store hashes as lowercase `0x`-prefixed `text`.

### JSON fields

Use `jsonb` only when:

- the structure is versioned
- the shape is adapter-defined
- the shape is intentionally extensible

Do not hide core relational keys inside JSON.

## Global Constraints

### Chain scope

V1 is single-chain Ethereum mainnet, but the schema remains multi-chain compatible.

Rule:

- every chain-derived or chain-owned table includes `chain_id`

### Canonicality

Rows derived directly from blocks, transactions, receipts, or logs must preserve canonicality.

Rule:

- reorg repair changes canonical flags
- canonical facts are not hard-deleted during normal operation

### Rebuildability

Any table in these groups must be rebuildable from earlier groups:

- projection tables from canonical ingest + config + adapters
- desired Fabric state from projection tables
- publication checkpoints from desired Fabric state and remote sync

## Recommended Extensions

Enable:

```sql
create extension if not exists pgcrypto;
```

Use cases:

- optional UUIDs
- digest helpers if needed later

## Config And Capability Tables

### `config_revisions`

Purpose:

- store versioned runtime config affecting projection or publication

```text
config_revisions
- id bigserial primary key
- config_kind text not null
- version bigint not null
- payload_json jsonb not null
- activated_at_block bigint null
- created_at timestamptz not null default now()
unique (config_kind, version)
```

Recommended `config_kind` values:

- `projection`
- `adapters`
- `publication`

### `rpc_capabilities`

Purpose:

- record provider capability probes

```text
rpc_capabilities
- endpoint_id text primary key
- chain_id bigint not null
- supports_block_receipts boolean not null
- supports_block_hash_logs boolean not null
- supports_safe_tag boolean not null
- supports_finalized_tag boolean not null
- checked_at timestamptz not null
- raw_json jsonb not null
```

Indexes:

- `rpc_capabilities_chain_checked_idx (chain_id, checked_at desc)`

## Canonical Ingest Journal

### `blocks`

Purpose:

- canonical and non-canonical block facts

```text
blocks
- chain_id bigint not null
- block_number bigint not null
- block_hash text not null
- parent_hash text not null
- timestamp timestamptz not null
- gas_used numeric not null
- gas_limit numeric not null
- base_fee_per_gas numeric null
- tx_count integer not null
- log_count integer not null
- canonical boolean not null
- finality_state text not null
- first_seen_at timestamptz not null
primary key (chain_id, block_hash)
```

Constraints:

- unique canonical head per block number:
  `unique (chain_id, block_number, canonical) where canonical = true`

Recommended `finality_state` values:

- `latest`
- `safe`
- `finalized`

Indexes:

- `blocks_chain_number_idx (chain_id, block_number desc)`
- `blocks_chain_canonical_number_idx (chain_id, canonical, block_number desc)`
- `blocks_chain_parent_idx (chain_id, parent_hash)`

### `transactions`

Purpose:

- transaction facts keyed by tx hash plus containing block hash

```text
transactions
- chain_id bigint not null
- tx_hash text not null
- block_hash text not null
- block_number bigint not null
- tx_index integer not null
- from_address text not null
- to_address text null
- contract_address_created text null
- value_wei numeric not null
- type integer not null
- status integer null
- gas_limit numeric not null
- max_fee_per_gas numeric null
- max_priority_fee_per_gas numeric null
- canonical boolean not null
primary key (chain_id, tx_hash, block_hash)
```

Foreign keys:

- `(chain_id, block_hash)` -> `blocks`

Indexes:

- `transactions_chain_block_idx (chain_id, block_hash, tx_index)`
- `transactions_chain_from_idx (chain_id, from_address, block_number desc)`
- `transactions_chain_to_idx (chain_id, to_address, block_number desc)`
- `transactions_chain_canonical_idx (chain_id, canonical, block_number desc)`

### `receipts`

Purpose:

- receipt facts aligned to a tx in a block

```text
receipts
- chain_id bigint not null
- tx_hash text not null
- block_hash text not null
- block_number bigint not null
- transaction_index integer not null
- gas_used numeric not null
- cumulative_gas_used numeric not null
- effective_gas_price numeric null
- contract_address text null
- status integer null
- canonical boolean not null
primary key (chain_id, tx_hash, block_hash)
```

Foreign keys:

- `(chain_id, tx_hash, block_hash)` -> `transactions`

Indexes:

- `receipts_chain_block_idx (chain_id, block_hash, transaction_index)`
- `receipts_contract_create_idx (chain_id, contract_address) where contract_address is not null`

### `logs`

Purpose:

- log facts keyed by tx hash, log index, and block hash

```text
logs
- chain_id bigint not null
- block_hash text not null
- block_number bigint not null
- tx_hash text not null
- log_index integer not null
- address text not null
- topic0 text null
- topic1 text null
- topic2 text null
- topic3 text null
- data text not null
- removed boolean not null
- canonical boolean not null
primary key (chain_id, tx_hash, log_index, block_hash)
```

Foreign keys:

- `(chain_id, tx_hash, block_hash)` -> `transactions`

Indexes:

- `logs_chain_block_idx (chain_id, block_hash, log_index)`
- `logs_chain_address_idx (chain_id, address, block_number desc)`
- `logs_chain_topic0_idx (chain_id, topic0, block_number desc)`
- `logs_chain_canonical_idx (chain_id, canonical, block_number desc)`

### `accounts`

Purpose:

- lightweight latest-known account identity summary

```text
accounts
- chain_id bigint not null
- address text not null
- first_seen_block bigint not null
- last_seen_block bigint not null
- is_contract boolean not null
- code_hash text null
- last_balance_wei numeric null
- last_nonce numeric null
primary key (chain_id, address)
```

Indexes:

- `accounts_chain_contract_idx (chain_id, is_contract, last_seen_block desc)`

### `contracts`

Purpose:

- latest-known contract summary

```text
contracts
- chain_id bigint not null
- address text not null
- creation_tx_hash text null
- creation_block_number bigint null
- code_hash text null
- bytecode_size integer null
- family_label text null
- metadata_json jsonb not null default '{}'
primary key (chain_id, address)
```

Indexes:

- `contracts_chain_family_idx (chain_id, family_label)`
- `contracts_chain_creation_idx (chain_id, creation_block_number desc)`

### `reorg_events`

Purpose:

- audit trail for canonical branch changes

```text
reorg_events
- id bigserial primary key
- chain_id bigint not null
- common_ancestor_number bigint not null
- common_ancestor_hash text not null
- removed_count integer not null
- detected_at timestamptz not null
- metadata_json jsonb not null
```

Indexes:

- `reorg_events_chain_detected_idx (chain_id, detected_at desc)`

### `ingest_checkpoints`

Purpose:

- single-row ingest progress per chain

```text
ingest_checkpoints
- chain_id bigint primary key
- last_seen_block_number bigint not null
- last_seen_block_hash text not null
- last_finalized_block_number bigint not null
- updated_at timestamptz not null
```

## Projection State

### `projection_jobs`

Purpose:

- queue bounded recompute work

```text
projection_jobs
- id bigserial primary key
- chain_id bigint not null
- from_block_number bigint not null
- to_block_number bigint not null
- reason text not null
- status text not null
- created_at timestamptz not null
- started_at timestamptz null
- finished_at timestamptz null
```

Recommended `status` values:

- `pending`
- `running`
- `completed`
- `failed`

Indexes:

- `projection_jobs_pending_idx (chain_id, status, from_block_number)`
- `projection_jobs_created_idx (created_at desc)`

### `projection_checkpoints`

Purpose:

- record latest successfully projected head for a given config/version set

```text
projection_checkpoints
- chain_id bigint not null
- projection_version bigint not null
- district_algorithm_version bigint not null
- anchor_algorithm_version bigint not null
- corridor_algorithm_version bigint not null
- surface_algorithm_version bigint not null
- last_projected_block_number bigint not null
- last_projected_block_hash text not null
- updated_at timestamptz not null
primary key (
  chain_id,
  projection_version,
  district_algorithm_version,
  anchor_algorithm_version,
  corridor_algorithm_version,
  surface_algorithm_version
)
```

### `districts`

Purpose:

- currently published district set and metadata

```text
districts
- chain_id bigint not null
- district_id text not null
- district_key text not null
- origin_x numeric not null
- origin_y numeric not null
- origin_z numeric not null
- entity_count integer not null
- contract_count integer not null
- account_count integer not null
- activity_window_32 integer not null
- projection_version bigint not null
- updated_at_block bigint not null
primary key (chain_id, district_id)
```

Indexes:

- `districts_chain_activity_idx (chain_id, activity_window_32 desc)`

### `district_memberships`

Purpose:

- entity to district mapping

```text
district_memberships
- chain_id bigint not null
- entity_id text not null
- entity_kind text not null
- district_id text not null
- district_algorithm_version bigint not null
- updated_at_block bigint not null
primary key (chain_id, entity_id)
```

Indexes:

- `district_memberships_chain_district_idx (chain_id, district_id)`

### `entity_anchors`

Purpose:

- stable anchor positions for published entities

```text
entity_anchors
- chain_id bigint not null
- entity_id text not null
- entity_kind text not null
- district_id text not null
- anchor_x numeric not null
- anchor_y numeric not null
- anchor_z numeric not null
- slot_key text not null
- collision_rank integer not null
- landmark_rank integer null
- anchor_algorithm_version bigint not null
- updated_at_block bigint not null
primary key (chain_id, entity_id)
```

Indexes:

- `entity_anchors_chain_district_idx (chain_id, district_id)`
- `entity_anchors_chain_landmark_idx (chain_id, district_id, landmark_rank)`

### `corridors`

Purpose:

- aggregated inter-district flow windows

```text
corridors
- chain_id bigint not null
- corridor_key text not null
- source_district_id text not null
- target_district_id text not null
- flow_class text not null
- token_class text not null
- window_size integer not null
- event_count integer not null
- distinct_tx_count integer not null
- total_value_wei numeric null
- token_transfer_count integer null
- last_seen_block bigint not null
- published boolean not null
- corridor_algorithm_version bigint not null
- updated_at_block bigint not null
primary key (chain_id, corridor_key)
```

Indexes:

- `corridors_chain_source_window_idx (chain_id, source_district_id, window_size, event_count desc)`
- `corridors_chain_target_window_idx (chain_id, target_district_id, window_size, event_count desc)`
- `corridors_chain_published_idx (chain_id, published, window_size)`

### `state_surfaces`

Purpose:

- projection-owned generic surfaces used by the scene protocol

```text
state_surfaces
- entity_id text not null
- surface_id text not null
- surface_kind text not null
- value_json jsonb not null
- unit text null
- visual_channel text not null
- updated_at_block bigint not null
primary key (entity_id, surface_id)
```

Indexes:

- `state_surfaces_updated_idx (updated_at_block desc)`

## Adapter State

### `adapter_entities`

Purpose:

- detected protocol-family membership and adapter metadata

```text
adapter_entities
- chain_id bigint not null
- address text not null
- adapter_id text not null
- adapter_version integer not null
- protocol_id text not null
- family text not null
- confidence text not null
- style_family text not null
- metadata_json jsonb not null default '{}'
- detected_at_block bigint not null
- updated_at_block bigint not null
primary key (chain_id, address, adapter_id)
```

Indexes:

- `adapter_entities_chain_family_idx (chain_id, family, confidence)`

### `adapter_events`

Purpose:

- adapter-decoded semantic events derived from logs

```text
adapter_events
- chain_id bigint not null
- adapter_id text not null
- tx_hash text not null
- block_hash text not null
- log_index integer not null
- target_address text not null
- event_family text not null
- payload_json jsonb not null
- canonical boolean not null
primary key (chain_id, adapter_id, tx_hash, log_index, block_hash)
```

Indexes:

- `adapter_events_chain_target_idx (chain_id, target_address, event_family, canonical)`

### `adapter_surfaces`

Purpose:

- adapter-owned semantic surfaces prior to projection merge

```text
adapter_surfaces
- chain_id bigint not null
- address text not null
- adapter_id text not null
- surface_id text not null
- surface_kind text not null
- value_json jsonb not null
- unit text null
- visual_channel text not null
- source_mode text not null
- updated_at_block bigint not null
primary key (chain_id, address, adapter_id, surface_id)
```

Indexes:

- `adapter_surfaces_chain_address_idx (chain_id, address)`

### `adapter_hints`

Purpose:

- adapter hints for districting, labels, publication style, and attachments

```text
adapter_hints
- chain_id bigint not null
- address text not null
- adapter_id text not null
- hint_type text not null
- payload_json jsonb not null
- updated_at_block bigint not null
primary key (chain_id, address, adapter_id, hint_type)
```

Recommended `hint_type` values:

- `district_seed`
- `object_style`
- `attachment_candidate`
- `preferred_label`

Indexes:

- `adapter_hints_chain_type_idx (chain_id, hint_type, updated_at_block desc)`

## Desired Fabric State

### `fabric_scopes`

Purpose:

- desired top-level scope state

```text
fabric_scopes
- scope_id text primary key
- chain_id bigint not null
- name text not null
- entry_msf_path text not null
- desired_revision bigint not null
- published_revision bigint not null default 0
- status text not null
```

Recommended `status` values:

- `active`
- `disabled`
- `degraded`

### `fabric_entrypoints`

Purpose:

- desired root-child entrypoint objects

```text
fabric_entrypoints
- scope_id text not null
- entrypoint_id text not null
- name text not null
- root_object_id text not null
- desired_revision bigint not null
- published_revision bigint not null default 0
primary key (scope_id, entrypoint_id)
```

Foreign keys:

- `scope_id` -> `fabric_scopes`

### `fabric_objects`

Purpose:

- desired world object graph
- blockhead publication intent, not a claim about the exact writable upstream Fabric schema

```text
fabric_objects
- scope_id text not null
- object_id text not null
- entrypoint_id text not null
- parent_object_id text not null
- entity_id text null
- class_id integer not null
- type integer not null
- subtype integer not null
- name text not null
- transform_json jsonb not null
- bound_json jsonb null
- resource_reference text null
- resource_name text null
- metadata_json jsonb not null default '{}'
- deleted boolean not null default false
- desired_revision bigint not null
- published_revision bigint not null default 0
- updated_at_block bigint not null
primary key (scope_id, object_id)
```

Foreign keys:

- `(scope_id, entrypoint_id)` -> `fabric_entrypoints`

Important note:

- `metadata_json` is part of blockhead desired state
- current upstream `MSF_Map_Svc` / `MSF_Map_Db` docs do not define a first-class mutable `metadata_json` column on core world objects
- publication adapters may therefore expose only a subset of this table through current upstream object fields unless sidecars or a fork are used

Indexes:

- `fabric_objects_scope_parent_idx (scope_id, parent_object_id)`
- `fabric_objects_scope_entrypoint_idx (scope_id, entrypoint_id)`
- `fabric_objects_scope_entity_idx (scope_id, entity_id)`
- `fabric_objects_scope_revision_idx (scope_id, desired_revision, published_revision)`

### `fabric_attachments`

Purpose:

- desired child-scope attachment links
- blockhead deep-dive link intent layered on top of upstream resource-reference behavior

```text
fabric_attachments
- scope_id text not null
- object_id text not null
- child_scope_id text not null
- resource_reference text not null
- desired_revision bigint not null
primary key (scope_id, object_id)
```

Foreign keys:

- `(scope_id, object_id)` -> `fabric_objects`
- `child_scope_id` -> `fabric_scopes`

Important note:

- this table records desired deep-dive linkage independent of how a specific Fabric client follows it
- current upstream support is strongest for `RMPObject` resource references
- conventions such as subtype `255` are client-compatibility conventions, not guaranteed upstream schema primitives

## Publication State

### `publication_checkpoints`

Purpose:

- track per-scope remote sync progress

```text
publication_checkpoints
- scope_id text primary key
- last_attempted_revision bigint not null
- last_published_revision bigint not null
- status text not null
- last_error text null
- updated_at timestamptz not null
```

Recommended `status` values:

- `idle`
- `running`
- `failed`
- `degraded`

## Optional Helper Views

### `canonical_blocks`

Purpose:

- simplify projection queries

Definition:

```sql
create view canonical_blocks as
select *
from blocks
where canonical = true;
```

### `canonical_transactions`

```sql
create view canonical_transactions as
select *
from transactions
where canonical = true;
```

### `canonical_logs`

```sql
create view canonical_logs as
select *
from logs
where canonical = true
  and removed = false;
```

## Migration Order

Recommended order:

1. extensions
2. config and capability tables
3. canonical ingest journal tables
4. projection tables
5. adapter tables
6. desired Fabric state tables
7. publication tables
8. helper views

Reason:

- later groups depend conceptually on earlier groups

## Rebuild Rules

### Full rebuild from canonical journal

Allowed to truncate and rebuild:

- `districts`
- `district_memberships`
- `entity_anchors`
- `corridors`
- `state_surfaces`
- `adapter_entities`
- `adapter_events`
- `adapter_surfaces`
- `adapter_hints`
- `fabric_scopes`
- `fabric_entrypoints`
- `fabric_objects`
- `fabric_attachments`
- `projection_checkpoints`

Must not be truncated during ordinary rebuild:

- `blocks`
- `transactions`
- `receipts`
- `logs`
- `reorg_events`
- `ingest_checkpoints`
- `publication_checkpoints`

## Performance Notes

V1 expected hot paths:

- insert block/tx/receipt/log batches
- query recent canonical windows
- query logs by address/topic0
- query transactions by address
- load desired Fabric delta by `desired_revision > published_revision`

If volume grows, likely next optimizations are:

- partition `blocks`, `transactions`, `receipts`, and `logs` by `chain_id` then optionally by block-number range
- materialized summaries for rolling windows
- narrower partial indexes for canonical-only paths

Partitioning is not required for v1.

## Integrity Rules

- every tx row must point to a known block row
- every receipt row must point to a known tx row
- every log row must point to a known tx row
- desired Fabric objects must reference a known scope and entrypoint
- attachment rows must reference an existing object and child scope
- no projection or adapter table may be treated as canonical if it can be rebuilt from upstream chain facts
- no desired-state column should be assumed to be a first-class upstream Fabric field unless separately validated in the integration contract

## Acceptance Criteria

The schema is good enough for v1 when:

- all tables required by `002`, `004`, and `005` exist with compatible keys
- canonical ingest can persist normal and reorg rounds without destructive updates
- projection can rebuild desired Fabric state from Postgres alone
- adapter outputs can be persisted and recomputed
- publication can diff desired vs published revisions without reading the upstream Fabric database as source of truth
- helper queries for recent canonical blocks, logs, and object revisions are index-supported

## Implementation Status

- [x] Migration order fixed (008 adds config_revisions and helper views)
- [x] Journal tables implemented (blocks, transactions, receipts, logs, accounts, contracts, reorg_events, ingest_checkpoints)
- [x] Projection tables implemented (projection_jobs, projection_checkpoints, districts, district_memberships, entity_anchors, corridors, state_surfaces)
- [x] Adapter tables implemented (adapter_entities, adapter_events, adapter_surfaces, adapter_hints)
- [x] Desired Fabric tables implemented (fabric_scopes, fabric_entrypoints, fabric_objects, fabric_attachments)
- [x] Publication checkpoint table implemented
- [x] Helper views implemented (canonical_blocks, canonical_transactions, canonical_logs)
- [x] End-to-end replay and rebuild validated

### Schema Mismatches (non-blocking)

- **transactions**: missing `status integer null` (receipts has status)
- **projection_jobs**: missing `reason text not null`; has extra `attempt_count`, `last_error` (operational columns)
