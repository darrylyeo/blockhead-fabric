# Blockhead Fabric Ingest Service Plan

## Goal

Define the concrete ingest-service plan for Ethereum mainnet.

This service is responsible for:

- connecting to execution node via `RPC_WSS_URL`
- probing provider capabilities
- running Voltaire `BlockStream` backfill and watch loops
- persisting canonical chain facts into Postgres
- handling reorgs without destructive data loss
- creating projection jobs for downstream services

This spec is derived from:

- `002-backend-architecture.md`
- `004-projection-algorithms.md`
- `006-database-schema.md`

## Scope

The ingest service owns:

- provider lifecycle
- startup checks
- block and receipt acquisition
- canonical journal writes
- reorg repair
- finality updates
- projection job enqueueing

It does **not** own:

- spatial projection
- Fabric publication
- client-facing world behavior

## Runtime Shape

Executable:

- `src/ingest/index.ts`

Runtime model:

- one ingest worker per chain
- one WebSocket provider connection per worker
- one logical ordered commit stream

V1 supports:

- Ethereum mainnet only
- `chain_id = 1`

## Dependencies

Required:

- Postgres
- WebSocket access to execution node provider
- Voltaire `BlockStream`

Optional later:

- an HTTP fallback provider
- Redis for health or operational caching

## Configuration

### Required environment

- `CHAIN_ID=1`
- `RPC_WSS_URL=wss://...` (execution node provider)
- `DATABASE_URL=postgres://...`
- `BLOCKSTREAM_POLLING_INTERVAL_MS=1000`
- `FINALITY_DEPTH=64`
- `BACKFILL_CHUNK_SIZE=100`
- `INGEST_START_BLOCK=0`

### Optional environment

- `RPC_REQUEST_TIMEOUT_MS=30000`
- `RECONNECT_BACKOFF_MIN_MS=1000`
- `RECONNECT_BACKOFF_MAX_MS=30000`
- `RECEIPT_FETCH_CONCURRENCY=16`
- `BACKFILL_TX_BATCH_SIZE=32`
- `PROJECTION_JOB_MIN_RANGE=1`
- `PROJECTION_JOB_COALESCE_GAP=8`

## Service Lifecycle

### Boot sequence

On process start:

1. load config
2. connect to Postgres
3. create WebSocket provider
4. run capability probe
5. verify `chain_id = 1`
6. load `ingest_checkpoints`
7. determine current remote head
8. decide whether backfill is required
9. run backfill
10. enter live watch mode

### Shutdown sequence

On `SIGINT` or `SIGTERM`:

1. stop issuing new requests
2. abort active `BlockStream` loops
3. wait for in-flight DB transaction to finish or roll back
4. close Postgres connection

## Provider Plan

### Provider interface

The ingest service consumes a project-owned EIP-1193 provider:

```ts
type Eip1193Provider = {
	request(args: {
		method: string
		params?: unknown[]
	}): Promise<unknown>
}
```

### Provider responsibilities

- request multiplexing
- request timeout
- reconnect with backoff
- fail-fast behavior for disconnected requests
- health reporting to ingest logs and metrics

### Provider constraints

- a reconnect does not preserve stream state
- on reconnect, the ingest service must restart watch mode from Postgres checkpoint

## Capability Probe

### Probe calls

Run on startup:

- `eth_chainId`
- `eth_blockNumber`
- `eth_getBlockByNumber`
- `eth_getBlockReceipts`
- `eth_getLogs` with `blockHash`
- `eth_getBalance`
- `eth_getCode`

### Persisted output

Write to `rpc_capabilities`.

### Policy decisions

If probe fails:

- wrong chain ID -> fail fast
- no `eth_getBlockReceipts` -> enable per-tx receipt fallback
- no `blockHash`-scoped logs -> continue with weaker recovery guarantees and warning log

## Checkpoint Strategy

### Source of truth

The source of truth for ingest progress is `ingest_checkpoints`.

Fields used:

- `last_seen_block_number`
- `last_seen_block_hash`
- `last_finalized_block_number`

### Start position

On startup:

- if a checkpoint exists, start from `last_seen_block_number + 1`
- otherwise start from `INGEST_START_BLOCK`

## Backfill Plan

### When backfill runs

Run backfill:

- on cold start
- after reconnect if behind head
- after deep reorg repair

### Backfill source

Use Voltaire:

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

### Backfill batch policy

Recommended defaults:

- `chunkSize = 100` from Voltaire
- DB transaction batch max = `32` blocks

Rule:

- never keep one huge DB transaction open for a large historical range

### Backfill completion

After backfill finishes:

- checkpoint must reflect the last canonical block inserted
- finality updater must run
- projection jobs must cover the backfilled range

## Live Watch Plan

### Watch loop

Use Voltaire:

```ts
for await (const event of stream.watch({
	fromBlock: lastSeen + 1n,
	include: 'receipts',
	pollingInterval: config.pollingIntervalMs,
})) {
	if (event.type === 'reorg') {
		await handleReorg(event)
	} else {
		await applyCanonicalBatch(event.blocks, event.metadata)
	}
}
```

### Watch guarantees

The watch loop must:

- preserve canonical ordering
- never commit later blocks before earlier blocks in the same chain segment
- tolerate reconnect by restart + catch-up backfill

## Receipt Acquisition Policy

### Preferred mode

Use:

- `include: 'receipts'`

This is the primary path for:

- block-level receipt ingestion
- log extraction
- contract creation detection

### Fallback mode

If the capability probe disables block receipts:

1. fetch block with transactions
2. fetch receipts per tx
3. synthesize one internal canonical batch
4. write journal rows exactly as in primary mode

### Invariant

Downstream code must not care which receipt mode was used.

## Canonical Batch Apply Plan

### Input

One canonical batch is:

- one or more blocks in strict ascending order
- each block includes transactions and receipts

### Per-block DB write order

Inside one DB transaction:

1. upsert `blocks`
2. upsert `transactions`
3. upsert `receipts`
4. upsert `logs`
5. upsert `accounts`
6. upsert `contracts`
7. upsert `ingest_checkpoints`
8. enqueue or widen `projection_jobs`

### Idempotency rule

Reapplying the same canonical batch must converge to the same DB state.

That means:

- inserts should be written as upserts where appropriate
- canonical flags must end in the correct final state
- projection jobs may widen but should not multiply endlessly for the same range

## Reorg Handling Plan

### Trigger

Voltaire emits:

- `type = 'reorg'`
- `removed`
- `added`
- `commonAncestor`

### Reorg handling sequence

1. begin DB transaction
2. insert one `reorg_events` row
3. mark removed `blocks` non-canonical
4. mark removed `transactions` non-canonical
5. mark removed `receipts` non-canonical
6. mark removed `logs` non-canonical and `removed = true`
7. insert replacement canonical blocks and descendants
8. update `ingest_checkpoints`
9. enqueue projection rebuild from `commonAncestor.number + 1`
10. commit

### Important rule

Never hard-delete facts during reorg repair.

### Reorg rebuild range

Projection rebuild range should be:

```text
[commonAncestor.number + 1, newHead]
```

## Deep Reorg Policy

### Definition

A deep reorg is one where Voltaire can no longer reconcile within tracked history.

### Response

1. stop watch mode
2. log a deep-reorg event
3. determine a safe restart point
4. run bounded backfill from that point
5. restart watch mode

### Safe restart point

Preferred:

- `last_finalized_block_number`

Fallback:

- a conservative distance behind the last seen block

## Finality Update Plan

### Inputs

- provider capabilities
- current canonical head
- `FINALITY_DEPTH`

### Rules

If provider supports tags:

- mark blocks `<= safe` as `safe`
- mark blocks `<= finalized` as `finalized`

If provider does not:

- mark blocks older than `FINALITY_DEPTH` as `finalized`

### Update timing

Run finality updates:

- after every normal batch
- after every reorg repair
- after backfill completion

## Projection Job Enqueue Plan

### Normal round

When canonical blocks `[A, B]` are committed:

- create or widen a `projection_jobs` row covering `[A, B]`

### Reorg round

When a reorg is repaired:

- create or widen a `projection_jobs` row covering `[commonAncestor + 1, newHead]`

### Coalescing rules

If a pending job already exists for the same chain:

- merge if ranges overlap
- merge if gap between ranges is `<= PROJECTION_JOB_COALESCE_GAP`

Status transitions:

- `pending -> running -> completed`
- `pending|running -> failed`

## Account And Contract Upserts

### Accounts

Update when touched by:

- tx sender
- tx receiver
- log emitter
- contract creation

Fields maintained:

- `first_seen_block`
- `last_seen_block`
- `is_contract`
- `last_balance_wei` if available later
- `last_nonce` if available later

### Contracts

Upsert when:

- `eth_getCode` or receipt creation data indicates code exists
- contract creation receipt is present

Fields maintained:

- `creation_tx_hash`
- `creation_block_number`
- `code_hash`
- `bytecode_size`

## Error Handling

### Retriable errors

- transient provider disconnect
- timeout
- short-lived Postgres connectivity issue

Response:

- retry with backoff
- restart provider if needed
- resume from checkpoint

### Non-retriable startup errors

- wrong chain ID
- invalid DB config
- missing required capability plus no supported fallback

Response:

- fail fast

### Block-level write failure

Response:

- roll back the DB transaction
- log the failed block range
- do not advance checkpoint
- restart the loop from checkpoint

## Observability

### Metrics

- `ingest_head_lag_seconds`
- `ingest_backfill_blocks_per_second`
- `ingest_provider_reconnects_total`
- `ingest_reorg_count_total`
- `ingest_reorg_removed_blocks_total`
- `ingest_batch_commit_latency_ms`
- `ingest_receipt_fetch_latency_ms`
- `ingest_projection_jobs_enqueued_total`

### Logs

Log at minimum:

- startup config summary without secrets
- capability probe results
- backfill start and finish
- watch start and restart
- normal batch ranges
- reorg details
- deep reorg fallback
- checkpoint updates

## Example Runtime Sequence

### Normal sequence

1. worker starts
2. probe succeeds
3. current head is `H`
4. checkpoint says `H-12`
5. backfill `[H-11, H]`
6. update checkpoint to `H`
7. enter watch mode
8. receive new canonical block `H+1`
9. commit `H+1`
10. enqueue projection job `[H+1, H+1]`

### Reorg sequence

1. watch emits reorg removing `H+1` and `H`
2. insert `reorg_events`
3. mark removed branch non-canonical
4. insert replacement branch
5. enqueue rebuild from common ancestor + 1
6. update checkpoint to replacement head

## Acceptance Criteria

The ingest service plan is good enough for v1 when:

- startup behavior is fully defined
- cold start backfill path is defined
- watch mode and reconnect behavior are defined
- receipt fallback policy is defined
- per-block DB write order is defined
- reorg repair sequence is defined without destructive deletes
- deep reorg fallback path is defined
- finality update behavior is defined
- projection job enqueue behavior is defined
- the service can always recover from Postgres checkpoint state alone

## Implementation Status

- [ ] Provider lifecycle implemented
- [ ] Capability probe implemented
- [ ] Backfill path implemented
- [ ] Watch loop implemented
- [ ] Receipt fallback implemented
- [ ] Reorg repair implemented
- [ ] Deep reorg fallback implemented
- [ ] Finality updater implemented
- [ ] Projection job enqueueing implemented
- [ ] Restart-from-checkpoint validated
