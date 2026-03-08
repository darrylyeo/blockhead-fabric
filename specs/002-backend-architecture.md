# Blockhead Fabric Backend Architecture

## Goal

Define the concrete backend implementation for a blockchain-synced Fabric server that:

- ingests Ethereum mainnet from execution node provider via `RPC_WSS_URL`
- maintains a replayable canonical chain journal
- projects chain data into spatial-fabric entities
- publishes that projected state into an RP1-compatible Fabric server
- serves the world through the existing `.msf` / `MSF_Map_Svc` model instead of a custom client protocol

This document turns `001-project-research.md` into an implementation plan.

## Core Decision

The system is **not** one monolithic server process.

It is a composed backend with four runtime roles:

1. `ingest-service`
2. `projection-service`
3. `publication-service`
4. `fabric-server`

The first three are project-owned.

The fourth is initially the existing RP1-compatible server stack, using the local `spatial-fabric-service` at `http://localhost:2000` for development and a forked `MSF_Map_Svc` / `MSF_Map_Db` only if later required.

## System Topology

```text
wss://... (execution node)
  -> ingest-service
  -> postgres chain journal
  -> projection-service
  -> postgres desired fabric state
  -> publication-service
  -> MSF_Map_Svc / MSF_Map_Db
  -> .msf + Fabric clients
```

Supporting infrastructure:

- Postgres for canonical chain facts and desired Fabric state
- MySQL for the current upstream Fabric server
- optional object storage for generated assets and attachment resources
- optional Redis later, but not required for v1

## What Counts As "The Server"

For this project, "the blockchain-synced fabric server" means the combined publication boundary:

- project-owned ingest + projection + publication
- plus the downstream Fabric server that clients actually connect to

That distinction matters because:

- the chain truth should live in Postgres, not in the upstream Fabric database
- the upstream Fabric database is a publication target, not the source of truth
- reorg handling, checkpoints, and semantic projection belong in project-owned services

## Why Postgres

Postgres is the canonical store because this backend is not only serving live data. It needs durable truth, replayability, and transactional rebuilds.

Postgres is responsible for:

- canonical chain facts
- reorg history
- projection jobs
- desired Fabric state
- publication checkpoints

It is the right default because:

- reorg-safe indexing needs transactional updates to canonicality and checkpoints
- projection rebuilds need a durable journal to recompute from
- relational joins across blocks, transactions, receipts, logs, accounts, and contracts are first-class
- desired Fabric state and publication checkpoints need to live next to the chain journal, not inside the upstream Fabric database
- the upstream Fabric database should remain a publication target, not the semantic source of truth

The practical rule is:

- Ethereum RPC is the event source
- Postgres is the canonical memory
- projection is the compiler
- the Fabric server is the client-facing runtime

## End-To-End Data Flows

There are two primary data flows:

1. canonical chain ingest
2. Fabric publication

### Canonical chain ingest flow

1. the provider adapter issues JSON-RPC requests over `wss://... (execution node)`
2. Voltaire `BlockStream` emits canonical `blocks` or `reorg` events
3. `ingest-service` normalizes the event into block, tx, receipt, log, account, and contract records
4. `ingest-service` commits those records into Postgres
5. `ingest-service` advances `ingest_checkpoints`
6. `ingest-service` creates or widens `projection_jobs`

### Fabric publication flow

1. `projection-service` consumes canonical journal rows and pending projection jobs
2. it computes deterministic desired Fabric state
3. it writes desired scopes, entrypoints, objects, attachments, and revisions into Postgres
4. `publication-service` reads desired state and current remote state
5. it plans minimal creates, updates, moves, and deletes
6. it applies those mutations to the Fabric server
7. Fabric clients observe the resulting world through normal `.msf` and live object updates

### Round-by-round runtime behavior

Assume the system is already caught up and inside `BlockStream.watch()`.

#### Normal round

Voltaire emits:

- `type = 'blocks'`
- `blocks = [block_n]`

Then:

1. `ingest-service` writes canonical facts for `block_n`
2. `projection-service` materializes the new spine slice and any dependent updates
3. `publication-service` syncs only the delta into the Fabric server
4. connected clients see a local extension of the world, not a global reset

#### Later rounds

As more normal rounds arrive:

- the chain journal grows monotonically
- state surfaces and corridors roll forward over time windows
- district and anchor structures stay stable unless their placement revision changes
- publication remains incremental

#### Reorg round

Voltaire emits:

- `type = 'reorg'`
- `removed = [...]`
- `added = [...]`
- `commonAncestor = ...`

Then:

1. `ingest-service` marks removed rows non-canonical and inserts replacement canonical rows
2. `projection-service` rebuilds only the affected range
3. `publication-service` applies compensating remote mutations
4. clients see local world repair near the live edge

This layered behavior is why the Fabric world should always be treated as a converged view of canonical state, not as the source of truth itself.

## Service Responsibilities

### `ingest-service`

Owns:

- provider connection lifecycle
- capability probing
- backfill and live watch
- canonical block journal writes
- reorg detection and repair
- lightweight account and contract identity extraction

Does not own:

- spatial clustering
- asset generation
- direct Fabric mutations

### `projection-service`

Owns:

- chain-to-space mapping
- district assignment
- anchor placement
- corridor aggregation
- state surface derivation
- desired Fabric object graph materialization

Does not own:

- raw RPC access
- direct writes into the upstream Fabric database

### `publication-service`

Owns:

- reading desired Fabric state
- reading current remote Fabric state
- diff planning
- mutation execution
- publication checkpoints

Does not own:

- chain ingest
- semantic interpretation of chain data beyond desired-state rows

### `fabric-server`

Owns:

- `.msf` discovery
- live world access for clients
- RP1-compatible object traversal and mutation semantics
- current Socket.IO transport behavior

For v1, this is the local `spatial-fabric-service` and later a forked upstream server if needed.

## Fabric Client Lifecycle

From a Fabric client's perspective, the backend internals are hidden.

The client lifecycle is:

1. fetch the `.msf` root
2. connect to the Fabric server
3. open the chosen entrypoint hierarchy such as `latest-spine`
4. render the currently published world state
5. receive ongoing object updates according to current Fabric transport behavior

Important consequences:

- the client does not connect to Ethereum RPC
- the client does not know about Voltaire
- the client does not replay chain history from genesis
- the client receives the current already-published canonical world plus incremental changes

### Client-visible sync model

The client experiences sync as:

- initial world load from published Fabric state
- then incremental world updates from the Fabric server

Important boundary:

- current upstream docs clearly support ordinary object traversal and live refresh behavior
- they do not guarantee blockhead-specific rich metadata as a first-class core object field
- they also do not guarantee that every client/server pair implements deep-dive attachment following the same way

So client sync is publication-lagged, not RPC-lagged.

### Client-visible visual behavior

On initial open:

- the user should see a coherent world already present
- recent block slices should already exist
- stable landmarks should already be in place

During normal canonical advance:

- the live edge of the chain spine extends
- local transaction pulses and event effects appear
- nearby state surfaces update
- the rest of the world remains spatially stable

During reorgs:

- only the affected recent region should visibly retract and repair
- the world should not globally re-layout or reset

This client-visible behavior is part of the architecture, not only a rendering concern, because it depends on the separation between journal truth, deterministic projection, and incremental publication.

## Runtime Components

### 1. Provider adapter

Implement a project-owned provider module:

- `src/provider/createWsProvider.ts`

Responsibilities:

- open a WebSocket connection to `wss://... (execution node)`
- expose EIP-1193 `request({ method, params })`
- multiplex concurrent request IDs safely
- support reconnect with bounded retry
- fail all in-flight requests on disconnect
- expose health metadata to the ingest service

Required interface:

```ts
export type Eip1193Provider = {
	request(args: {
		method: string
		params?: unknown[]
	}): Promise<unknown>
}
```

Recommended implementation details:

- use a single socket per ingest worker
- generate monotonically increasing numeric IDs
- store pending requests in a `Map<number, { resolve, reject, timeout }>`
- apply per-request timeout, default `30_000`
- on reconnect, require the caller to restart active streams instead of trying to resume in place

### 2. Capability probe

Implement:

- `src/provider/probeCapabilities.ts`

Run at process startup:

- `eth_chainId`
- `eth_blockNumber`
- `eth_getBlockByNumber`
- `eth_getBlockReceipts`
- `eth_getLogs` with `blockHash`
- `eth_getBalance`
- `eth_getCode`

Persist results in:

- `rpc_capabilities`

Schema:

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

Startup policy:

- if `chainId !== 1`, fail fast
- if `eth_getBlockReceipts` fails, enable receipt fallback mode
- if `blockHash`-scoped log queries fail, disable strong log reconciliation and warn loudly

## Ingest Service

### Process shape

Executable:

- `src/ingest/index.ts`

Main loop:

1. load runtime config
2. create provider
3. probe capabilities
4. read the last canonical checkpoint
5. run backfill if behind
6. run `BlockStream.watch()`
7. write journal records inside ordered transactions
8. enqueue projection wake-ups

### Runtime config

Required environment:

- `CHAIN_ID=1`
- `RPC_WSS_URL=wss://... (execution node)`
- `DATABASE_URL=postgres://...`
- `BLOCKSTREAM_POLLING_INTERVAL_MS=1000`
- `FINALITY_DEPTH=64`
- `BACKFILL_CHUNK_SIZE=100`
- `INGEST_START_BLOCK=0`

Optional:

- `RPC_REQUEST_TIMEOUT_MS=30000`
- `RECONNECT_BACKOFF_MIN_MS=1000`
- `RECONNECT_BACKOFF_MAX_MS=30000`
- `RECEIPT_FETCH_CONCURRENCY=16`

### Voltaire integration

Use:

```ts
const provider = createWsProvider(config)
const stream = BlockStream({ provider })
```

Backfill:

```ts
for await (const batch of stream.backfill({
	fromBlock,
	toBlock,
	include: 'receipts',
	chunkSize: config.backfillChunkSize,
})) {
	await applyCanonicalBatch(batch.blocks, batch.metadata)
}
```

Watch:

```ts
for await (const event of stream.watch({
	fromBlock: lastSeen + 1n,
	include: 'receipts',
	pollingInterval: config.pollingIntervalMs,
})) {
	if (event.type === 'reorg') {
		await rollbackRemovedBlocks(event.removed, event.commonAncestor)
		await applyCanonicalBatch(event.added, event.metadata)
	} else {
		await applyCanonicalBatch(event.blocks, event.metadata)
	}
}
```

### Receipt mode

Primary mode:

- use Voltaire `include: 'receipts'`

Fallback mode when block receipts are unavailable:

1. fetch block with transactions
2. request receipts per transaction
3. synthesize the same internal `StreamBlock<'receipts'>` shape before writing journal state

### Journal write transaction

For each canonical block, write in this order:

1. `blocks`
2. `transactions`
3. `receipts`
4. `logs`
5. `accounts`
6. `contracts`
7. `ingest_checkpoints`

Rule:

- one DB transaction per block for live mode
- bounded batch transactions for backfill mode, default `32` blocks max

### Journal tables

#### `blocks`

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
unique (chain_id, block_number, canonical) where canonical = true
```

#### `transactions`

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

#### `receipts`

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

#### `logs`

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

#### `accounts`

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

#### `contracts`

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

#### `reorg_events`

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

#### `ingest_checkpoints`

```text
ingest_checkpoints
- chain_id bigint primary key
- last_seen_block_number bigint not null
- last_seen_block_hash text not null
- last_finalized_block_number bigint not null
- updated_at timestamptz not null
```

### Reorg handling

On `reorg` event:

1. insert `reorg_events`
2. mark removed blocks `canonical = false`
3. mark descendant txs, receipts, and logs `canonical = false`
4. mark affected logs `removed = true`
5. apply replacement chain blocks in order
6. update finality states
7. enqueue projection rebuild for the affected block range

Rules:

- never hard-delete chain facts
- canonicality is a projection decision, not a deletion policy
- idempotency must hold if the same reorg is replayed

### Finality updater

Implement:

- `src/ingest/finality.ts`

Policy:

- `latest`: within `FINALITY_DEPTH`
- `safe`: if provider supports `safe`, mark all canonical blocks `<= safe`
- `finalized`: if provider supports `finalized`, mark all canonical blocks `<= finalized`
- fallback: if tags unsupported, mark `finalized` once older than `FINALITY_DEPTH`

## Projection Service

### Process shape

Executable:

- `src/projection/index.ts`

Trigger sources:

- poll `projection_jobs`
- or subscribe later to `LISTEN/NOTIFY`

Initial v1 approach:

- simple DB polling every `1000ms`

### Projection inputs

- canonical `blocks`
- canonical `transactions`
- canonical `receipts`
- canonical `logs`
- `accounts`
- `contracts`
- config revision tables

### Projection outputs

- `districts`
- `district_memberships`
- `entity_anchors`
- `corridors`
- `state_surfaces`
- `fabric_scopes`
- `fabric_entrypoints`
- `fabric_objects`
- `fabric_attachments`
- `projection_checkpoints`

### Projection job model

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

When ingest advances:

- merge adjacent open jobs when possible
- coalesce repeated jobs into the widest needed range

### Projection stages

#### Stage 1: block spine materialization

Create a deterministic chain-spine hierarchy:

- root scope: `eth-mainnet`
- entrypoint: `latest-spine`
- top container object: `spine`
- one child block-slice object per canonical recent block

Recommended object IDs:

- root scope: `scope_eth_mainnet`
- spine entrypoint root: `entry_latest_spine`
- block object: `block_<blockNumber>`

Transform formula:

```text
x = 0
y = finalityBand
z = (blockNumber - windowStart) * blockSpacing
```

Recommended constants:

- `blockSpacing = 24`
- `finalityBand(latest) = 0`
- `finalityBand(safe) = 2`
- `finalityBand(finalized) = 4`

#### Stage 2: entity district assignment

Initial v1 approach:

- deterministic hash-based districts, not community detection yet

Formula:

```text
districtId = 'd_' + hexPrefix(keccak(address), 2)
```

Reason:

- concrete
- deterministic
- cheap
- stable

This intentionally defers graph clustering until later phases.

#### Stage 3: anchor placement

For each account or contract:

```text
districtOrigin = grid(districtId)
slot = hash(address) within district cell
anchor = districtOrigin + slotOffset
```

Rules:

- contracts reserve more prominent central slots
- EOAs use smaller parcel offsets
- addresses never move unless the placement algorithm version changes

#### Stage 4: flow corridors

Aggregate recent ETH and ERC-20 flow between districts.

Initial v1 windows:

- `8` blocks
- `32` blocks
- `128` blocks

Corridor key:

```text
<sourceDistrict>|<targetDistrict>|<flowClass>|<tokenClass>
```

Initial `flowClass` values:

- `native_transfer`
- `erc20_transfer`
- `contract_call`

#### Stage 5: state surfaces

Initial v1 surfaces:

- contract activity count over last `32` blocks
- total incoming value over last `32` blocks
- total outgoing value over last `32` blocks
- event emission count over last `32` blocks

Store as:

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

### Desired Fabric state tables

#### `fabric_scopes`

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

#### `fabric_entrypoints`

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

#### `fabric_objects`

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

#### `fabric_attachments`

```text
fabric_attachments
- scope_id text not null
- object_id text not null
- child_scope_id text not null
- resource_reference text not null
- desired_revision bigint not null
primary key (scope_id, object_id)
```

### Fabric class mapping

Use these publication rules:

- chain world root -> `RMRoot`
- spine container -> `RMCObject`
- district containers -> `RMTObject`
- block slices -> `RMTObject`
- account anchors -> `RMPObject`
- contract landmarks -> `RMPObject`
- transaction pulses -> `RMPObject`
- attachment points -> `RMPObject`, with subtype `255` treated as a blockhead / compatible-client convention rather than an upstream standard primitive

### Resource policy

Do not generate complex 3D assets in the hot path.

For v1:

- use simple resource references when available
- otherwise rely on desired-state metadata first, with current upstream publication exposing that metadata through sidecars or a future fork if needed
- keep geometry basic and deterministic

## Publication Service

### Process shape

Executable:

- `src/publisher/index.ts`

Responsibilities:

- connect to Fabric root
- discover remote object state
- diff against desired Fabric state
- apply creates, updates, moves, deletes
- record `published_revision`

### Integration boundary

V1 publication boundary:

- use a client-wrapper layer compatible with the current Fabric server

Do not:

- write directly into upstream MySQL tables
- call undocumented stored procedures as the primary path

Use direct server internals only if the supported client path proves insufficient.

### Remote state sync order

Per scope:

1. `connectRoot()`
2. fetch root object
3. ensure entrypoint roots exist
4. create missing parents
5. create missing children
6. apply updates
7. apply moves
8. update attachments
9. delete obsolete leaves

### Publication checkpoint table

```text
publication_checkpoints
- scope_id text primary key
- last_attempted_revision bigint not null
- last_published_revision bigint not null
- status text not null
- last_error text null
- updated_at timestamptz not null
```

### Idempotency rules

- creates must be existence-checked
- updates overwrite toward desired state
- moves are safe if already moved
- deletes tolerate already-missing targets

## Fabric Server Integration

### V1 deployment target

- local `spatial-fabric-service`
- exposed at `http://localhost:2000`

### Why this remains external

The upstream Fabric server is a world-serving system, not a blockchain indexer.

Keeping it external gives:

- standards compatibility
- easier local testing
- lower risk
- a clean future fork path

### When to fork upstream

Fork `MSF_Map_Svc` / `MSF_Map_Db` only if one of these becomes true:

- publication throughput is too low through the client-wrapper path
- object mutation semantics required by blockhead are missing
- attachment or entrypoint control is insufficient
- server-side indexing hints or caching are needed for client performance

## Repo Layout

Recommended project-owned layout:

```text
src/
  provider/
    createWsProvider.ts
    probeCapabilities.ts
  ingest/
    index.ts
    applyCanonicalBatch.ts
    rollbackRemovedBlocks.ts
    finality.ts
  projection/
    index.ts
    materializeSpine.ts
    materializeDistricts.ts
    materializeCorridors.ts
    materializeStateSurfaces.ts
  publisher/
    index.ts
    connectFabric.ts
    reconcileScope.ts
    mutationPlanner.ts
  db/
    migrate.ts
    queries/
  shared/
    config.ts
    ids.ts
    types.ts
```

## Deployment Model

### Local development

- `spatial-fabric-service` via Docker Compose
- Postgres locally
- one ingest process
- one projection process
- one publication process

### Production v1

- one Postgres instance
- one Fabric server deployment
- one ingest worker for chain `1`
- one projection worker
- one publication worker

Do not introduce queueing, Kafka, or multi-region topology in v1.

## Observability

### Metrics

- `head_lag_seconds`
- `backfill_blocks_per_second`
- `reorg_count_total`
- `reorg_removed_blocks_total`
- `provider_reconnects_total`
- `projection_job_latency_ms`
- `publication_latency_ms`
- `publication_mutations_total`
- `publication_failures_total`

### Required logs

- provider connect/disconnect
- capability probe results
- backfill start/finish
- reorg detection
- projection job range
- publication scope sync summary

## Failure Modes

### RPC disconnect

Response:

- fail in-flight requests
- reconnect with backoff
- restart watch loop
- backfill from last checkpoint

### Deep reorg

Response:

- stop live watch
- mark suspect range dirty
- backfill from common ancestor or last trusted block
- rebuild projections for the affected range

### Fabric publication failure

Response:

- leave desired state untouched
- persist checkpoint error
- retry from last published revision

### Projection bug or schema change

Response:

- bump projection config revision
- rebuild desired Fabric state from canonical chain journal
- republish

## Acceptance Criteria

The backend is ready for the first end-to-end demo when:

- it ingests live mainnet blocks from `wss://... (execution node)`
- it survives disconnects and resumes from Postgres checkpoints
- it handles at least a 6-block reorg correctly
- it publishes a visible `latest-spine` entrypoint into `localhost:2000`
- existing Fabric clients can traverse the published object graph
- the source of truth remains the project-owned Postgres journal, not the Fabric server database

### Detailed backend acceptance criteria

- `ingest-service` can restart and resume from `ingest_checkpoints` without manual repair
- canonical blocks, transactions, receipts, and logs are never hard-deleted during reorg handling
- a replacement canonical branch converges to the same desired Fabric state after replay
- projection can rebuild desired Fabric state from Postgres without re-fetching old chain data
- publication retries are idempotent and do not require remote cleanup
- the Fabric server database can be discarded and republished from Postgres-derived desired state

### Detailed client-visible acceptance criteria

- opening the Fabric root yields an already-coherent `latest-spine` world rather than a visibly bootstrapping scene
- after a few normal `BlockStream` rounds, a user sees local live-edge extension of the spine rather than global re-layout
- contracts and accounts remain spatially stable across normal updates
- transaction and event activity appears as local motion or surface change, not as full-scene redraw
- after a recent reorg, the user sees localized repair near the live edge rather than a full world reset
- Fabric-client sync semantics remain ordinary Fabric semantics: open root, traverse objects, and receive updates, with attachment-following and rich metadata depending on compatible client behavior or sidecar support

## Immediate Build Order

1. implement `createWsProvider()`
2. implement startup capability probing
3. create journal migrations
4. implement `ingest-service`
5. implement deterministic `latest-spine` projection only
6. implement `publication-service`
7. validate object traversal in the local Fabric server
8. add districts, corridors, and state surfaces after the spine path works

## Implementation Status

- [x] Provider adapter (`createWsProvider`, EIP-1193 over WebSocket)
- [x] Capability probe (`probeCapabilities`, `rpc_capabilities` table)
- [x] Chain journal migrations (`ingest_checkpoints`, `projection_jobs`, canonical columns)
- [x] Ingest service (WS/HTTP, probe, checkpoints, projection job enqueue)
- [x] Reorg rollback path (mark blocks/txs/receipts/logs non-canonical)
- [x] Projection service (poll `projection_jobs`, materialize spine into fabric_*)
- [x] Desired Fabric state tables (fabric_scopes, fabric_entrypoints, fabric_objects)
- [x] Publication service (reconcile desired → Fabric server)
- [ ] Local Fabric server integration (manual: run spatial-fabric-service, bootstrap, then services)
- [ ] End-to-end demo against Ethereum mainnet
