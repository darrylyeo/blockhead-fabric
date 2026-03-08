# Blockhead Fabric Publisher Implementation Plan

## Goal

Define the concrete publication plan that syncs desired Fabric state from Postgres into the live Fabric server.

This service is responsible for:

- connecting to the Fabric root
- reading desired scopes, entrypoints, objects, and attachments from Postgres
- reading the currently published remote state
- computing the minimal safe mutation plan
- applying those mutations idempotently
- advancing publication checkpoints

This spec is derived from:

- `002-backend-architecture.md`
- `003-scene-protocol.md`
- `006-database-schema.md`
- `007-ingest-service-plan.md`

## Scope

The publisher owns:

- connection to the Fabric server
- remote state discovery
- scope-level reconciliation
- ordered object mutations
- attachment publication
- publication checkpointing

It does **not** own:

- chain ingest
- projection logic
- upstream Fabric server internals

## Runtime Shape

Executable:

- `src/publisher/index.ts`

Runtime model:

- one publisher worker
- one active scope sync at a time per scope
- bounded concurrency only for independent object updates

V1 deployment target:

- local `spatial-fabric-service`
- exposed at `http://localhost:2000`

## Publication Boundary

The publisher syncs **desired Fabric state**, not raw chain facts.

Inputs from Postgres:

- `fabric_scopes`
- `fabric_entrypoints`
- `fabric_objects`
- `fabric_attachments`
- `publication_checkpoints`

The publisher should never treat the upstream Fabric database as source of truth.

Rule:

- Postgres desired state is authoritative
- remote Fabric state is only the current publication target state

## Connection Plan

### Connection input

Required runtime config:

- `FABRIC_URL=http://localhost:2000/fabric`
- `FABRIC_ADMIN_KEY=...`
- `PUBLISHER_POLL_INTERVAL_MS=2000`
- `PUBLISHER_CONNECT_TIMEOUT_MS=60000`
- `PUBLISHER_SCOPE_CONCURRENCY=1`
- `PUBLISHER_OBJECT_BATCH_SIZE=50`

### Connection API

The publisher should use a client-wrapper-compatible interface:

```ts
type FabricClient = {
	connectRoot(args: {
		fabricUrl: string
		adminKey?: string
		timeoutMs?: number
	}): Promise<{
		scopeId: string
		rootObjectId: string
	}>
	listObjects(args: {
		scopeId: string
		anchorObjectId: string
		filter?: unknown
	}): Promise<FabricObject[]>
	getObject(args: {
		scopeId: string
		objectId: string
	}): Promise<FabricObject | null>
	createObject(args: CreateObjectArgs): Promise<FabricObject>
	updateObject(args: UpdateObjectArgs): Promise<FabricObject>
	moveObject(args: MoveObjectArgs): Promise<FabricObject>
	deleteObject(args: {
		scopeId: string
		objectId: string
	}): Promise<void>
}
```

### Connection rules

- reconnect on transport failure
- invalidate remote cache on reconnect
- resume from Postgres checkpoints
- do not attempt to mutate remote state if `connectRoot()` fails

## Publisher Main Loop

Loop:

1. load publishable scopes from Postgres
2. for each active scope:
   - read `publication_checkpoints`
   - compare `desired_revision` vs `last_published_revision`
   - if behind, run `reconcileScope(scope_id)`
3. sleep `PUBLISHER_POLL_INTERVAL_MS`

Rule:

- publisher is desired-revision driven
- if no desired revision changed, do nothing

## Scope Reconciliation

### Scope input set

For one `scope_id`, load:

- scope row
- entrypoint rows
- object rows
- attachment rows
- publication checkpoint row

### Scope remote discovery

For one scope:

1. `connectRoot()`
2. load root object
3. load current top-level children
4. discover remote subtree for desired entrypoints

### Scope output

Produce:

- ordered creates
- ordered updates
- ordered moves
- ordered deletes
- ordered attachment updates

Then:

- apply them
- mark `published_revision`
- update `publication_checkpoints`

## Remote Discovery Model

### Root discovery

Treat the root object as authoritative entry into the remote world.

Use:

- `connectRoot()`
- `getObject(rootObjectId)`
- `listObjects(anchorObjectId = rootObjectId)`

### Subtree discovery

The publisher only needs to discover:

- root children
- desired entrypoint subtrees
- any remote objects that could conflict with desired objects

Rule:

- do not recursively crawl the entire remote world if the scope is already partitioned by desired object IDs

### Remote cache

Maintain an in-memory cache keyed by:

- `scopeId`
- `objectId`

Invalidate cache on:

- reconnect
- successful create
- successful update
- successful move
- successful delete

## Diff Model

### Identity basis

Diff by:

- `scope_id`
- `object_id`

Not by:

- remote object name only
- transform similarity

Important adapter note:

- publisher identity remains `object_id`
- a specific upstream adapter may resolve remote objects through `Name_* == object_id` because current upstream Fabric servers are keyed by numeric object IDs
- that remote matching strategy does not change the publisher's canonical identity basis

### Desired vs remote comparison

For each desired object:

- if missing remotely -> create
- if present but fields differ -> update
- if parent differs -> move
- if marked deleted in desired state and present remotely -> delete

For each remote object under managed subtrees:

- if no desired object exists -> delete, unless explicitly unmanaged

### Managed subtree rule

The publisher only manages:

- root-child entrypoint objects owned by blockhead
- descendants of those entrypoints

Do not delete unrelated remote objects outside managed subtrees.

## Mutation Ordering

### Required order

Apply in this order:

1. create missing entrypoint root objects
2. create missing parent containers
3. create missing child objects
4. update existing objects
5. move objects whose parent changed
6. update attachment resources
7. delete obsolete leaves
8. delete obsolete containers after descendants are gone

### Why order matters

- parent must exist before child
- move targets must exist before move
- attachments should point at valid child scopes
- deletes should not orphan desired descendants

## Entrypoint Materialization

### Entrypoint rule

Entrypoints are ordinary root-child objects.

For each `fabric_entrypoints` row:

- ensure `root_object_id` exists under the root
- ensure its adapter-managed remote identity matches the desired entrypoint object
- ensure it is the subtree root for all corresponding objects

### Required v1 entrypoints

- `entry_latest_spine`
- `entry_district_atlas`
- `entry_protocol_landmarks`

## Object Mutation Mapping

### Create

Map a `fabric_objects` row to:

- `parentId`
- `name`
- `position`
- `rotation`
- `scale`
- `bound`
- `objectType`
- `subtype`
- `resourceReference`
- `resourceName`

### Update

Update when any of these differ:

- name
- transform
- bounds
- resource reference
- resource name
- class/type/subtype if supported through the chosen client path
- sidecar-backed or metadata-backed properties, if supported by the chosen target

### Move

Move when:

- `parent_object_id` differs remotely

### Delete

Delete when:

- desired row is deleted or absent
- remote object is inside a managed subtree
- object is not needed as parent of any desired child

## Attachment Publication

### Attachment representation

Attachments are just desired objects plus `fabric_attachments`.

Rules:

- attachment object must be class `73`
- `resourceReference` must point to the child descriptor URL

Compatibility note:

- subtype `255` is a blockhead / compatible-client convention, not a required upstream Fabric primitive
- current upstream support is strongest for `RMPObject` resource references and explicit descriptor URLs

### Attachment sync

For each `fabric_attachments` row:

1. ensure the attachment object exists
2. apply subtype `255` if the chosen target and compatibility mode expect it
3. ensure `resourceReference` equals the desired child descriptor URL

## Revision Model

### Desired revision

`desired_revision` means:

- the latest desired-state build written by projection

### Published revision

`published_revision` means:

- the latest desired revision successfully materialized remotely

### Update policy

After successful reconciliation of a scope:

- update `fabric_scopes.published_revision`
- update all synced entrypoints and objects `published_revision`
- update `publication_checkpoints.last_published_revision`

If reconciliation fails:

- keep desired state unchanged
- update `publication_checkpoints.last_attempted_revision`
- store `last_error`

## Checkpoint Plan

### `publication_checkpoints`

Use one row per scope.

Fields:

- `scope_id`
- `last_attempted_revision`
- `last_published_revision`
- `status`
- `last_error`
- `updated_at`

### Status values

- `idle`
- `running`
- `failed`
- `degraded`

### Checkpoint rules

- set `running` before mutation execution
- set `idle` only after success
- set `failed` on unrecoverable sync failure
- retain the last error message for operator diagnosis

## Idempotency Rules

The publisher must be safe to rerun after crashes or retries.

### Creates

- must tolerate object already existing
- must resolve to the same object identity

### Updates

- are overwrite-toward-desired-state
- repeated updates must converge

### Moves

- must tolerate object already under desired parent

### Deletes

- must tolerate already-missing targets

## Failure Handling

### Connection failure

Response:

- reconnect with backoff
- invalidate remote cache
- retry from checkpoint

### Scope reconciliation failure

Response:

- mark checkpoint `failed` or `degraded`
- stop mutating that scope for the current loop
- continue other scopes if configured

### Partial mutation failure

Response:

- stop applying further mutations in that scope
- refresh remote state on next attempt
- recompute diff from Postgres desired state

### Invalid desired state

Examples:

- missing parent object row
- attachment references child scope that does not exist

Response:

- fail fast for that scope
- store durable checkpoint error

## Performance Strategy

### V1 strategy

- keep scope concurrency low
- prefer correctness over maximum throughput
- batch only independent sibling updates

### Safe batch candidates

- sibling creates under an existing parent
- sibling updates with no parent change
- sibling deletes after descendants are removed

### Unsafe batch candidates

- mixed create + move across shared dependencies
- parent creation plus child create in the same unordered batch
- attachment retargeting while parent graph is unstable

## Example Reconciliation Sequence

### Normal new block

1. projection increments desired revision for `scope_eth_mainnet`
2. publisher notices `desired_revision > last_published_revision`
3. publisher connects to Fabric root
4. publisher discovers `entry_latest_spine`
5. publisher creates `block:1:H+1` if missing
6. publisher updates nearby objects and pulses
7. publisher marks the scope published at the new revision

### Reorg repair

1. projection rewrites desired state for affected recent block range
2. desired revision increments
3. publisher reconnects or refreshes subtree state
4. publisher deletes or updates removed block children
5. publisher creates or updates replacement block children
6. publisher advances checkpoint only after remote convergence

## Acceptance Criteria

The publisher plan is good enough for v1 when:

- it is clear which Postgres tables drive remote sync
- the remote discovery path is defined
- the mutation order is defined
- attachment publication is defined
- `published_revision` advancement rules are defined
- retries and reconnects are idempotent
- the publisher never needs the upstream Fabric database as source of truth
- a normal new-block round and a recent reorg round both converge through ordinary object mutations

## Implementation Status

- [ ] Fabric client wrapper integrated
- [ ] Scope polling loop implemented
- [ ] Remote discovery cache implemented
- [ ] Diff planner implemented
- [ ] Ordered mutation executor implemented
- [ ] Attachment sync implemented
- [ ] Publication checkpoints implemented
- [ ] Restart-safe idempotency validated
