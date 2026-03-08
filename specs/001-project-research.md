# Blockhead Fabric Research Spec

## Objective

Build a live, reorg-aware visualization of Ethereum mainnet as an Open Metaverse Spatial Fabric.

The system should:

- ingest canonical chain data from execution node provider
- use Voltaire `BlockStream` as the primary live block ingestion primitive
- map blockchain-native entities into RP1 / OMB spatial-fabric structures instead of inventing a separate public scene protocol
- publish the resulting world through the current Fabric server model, with the local dev target at `http://localhost:2000`
- determine whether the existing `spatial-fabric-service` is a viable foundation or whether the project should fork or rewrite

## Decision Summary

### Recommended approach

Use a separate blockchain sync and publication service that writes into an RP1-compatible Fabric server.

### Server decision

- use the current local `spatial-fabric-service` as a **dev publication target**
- do **not** treat the current local wrapper as the real long-term codebase
- fork upstream `MSF_Map_Svc` and `MSF_Map_Db` if server-side changes become necessary
- do **not** rewrite the Fabric server from scratch for v1

### Ingest decision

- use Voltaire `BlockStream.backfill()` and `BlockStream.watch()` for canonical block ingestion
- use Voltaire `EventStream` for curated protocol overlays
- keep a replayable journal keyed by `blockHash`
- handle reorgs by rollback plus replay, never by mutating state in place without history

### Spatial-model decision

- publish a **chain world** rooted at one `RMRoot`
- represent stable neighborhoods and parcels with terrestrial containers
- represent accounts, contracts, transaction pulses, and state surfaces as physical objects or physical effects
- treat tokens and logs primarily as **flow grammars** and **surface mutations**, not as standalone permanent meshes everywhere

## Why This Fits Open Metaverse Standards

The OMB spatial-fabric architecture is hierarchical and query-driven: clients ask a map service for objects near a root or anchor and then traverse children from there. That is a strong fit for blockchain visualization because Ethereum is already hierarchical and canonical in several ways:

- chain -> canonical block order
- block -> transactions
- transaction -> logs and touched entities
- address -> code, balance, nonce, storage, labels, protocol family

The Fabric model also provides three useful spatial classes:

- `RMRoot` for the world root
- `RMCObject` for large-scale containers
- `RMTObject` for surface and parcel-like territorial structure
- `RMPObject` for physical objects, landmarks, and interactable scene content

That means blockchain data does not need a custom visualization transport. It can be projected into an existing world graph and served through current OMB tooling.

Important boundary:

- the hierarchy and descriptor-based world model are standards-backed
- rich blockchain metadata, named entrypoints, and inspect attachments are blockhead conventions layered on top
- those conventions may require adapter behavior, sidecar info payloads, or an upstream fork rather than existing as first-class upstream primitives today

Sources:

- [Spatial Fabric Architecture](https://omb.wiki/en/spatial-fabric/architecture)
- [Map Service Prospective Features](https://omb.wiki/hackathon/tracks/tools/Map-Service-SQL)
- [MSF Map Service](https://github.com/MetaversalCorp/MSF_Map_Svc)
- [MSF Map Database](https://github.com/MetaversalCorp/MSF_Map_Db?tab=readme-ov-file)

## Research Findings

### 1. Voltaire is the right ingest primitive

Voltaire `BlockStream` is already designed for the exact hard part of this project:

- backfill over a block range
- live watch mode
- reorg detection
- content selection via `'header'`, `'transactions'`, or `'receipts'`
- explicit `reorg` events with `removed`, `added`, and `commonAncestor`
- clear deep-reorg failure via `UnrecoverableReorgError`

Voltaire `EventStream` is the right companion primitive for protocol overlays because it adds:

- historical backfill
- polling watch mode
- retry logic
- adaptive chunking for large ranges
- decoded event logs with block metadata

Important nuance:

- `BlockStream.watch()` is documented as polling-based
- that means it does not depend on `eth_subscribe`
- a WebSocket endpoint is still usable if wrapped as an EIP-1193 provider, but the core Voltaire live model is "poll and reconcile", not "trust pubsub delivery"

Sources:

- [Voltaire BlockStream](https://voltaire.tevm.sh/primitives/block-stream)
- [Voltaire Events / EventStream](https://voltaire.tevm.sh/contract/events)
- [Voltaire JSON-RPC Provider](https://voltaire.tevm.sh/jsonrpc-provider/getting-started)
- [BlockStream indexer example](https://voltaire.tevm.sh/examples/indexing/blockstream-indexer)

### 2. Ethereum JSON-RPC can support the sync loop, but only if the service is event-sourced

Useful live and recovery surfaces:

- `eth_getBlockByNumber`
- `eth_getBlockByHash`
- `eth_getBlockReceipts`
- `eth_getTransactionReceipt`
- `eth_getLogs`
- `eth_getBalance`
- `eth_getTransactionCount`
- `eth_getCode`
- `eth_call`
- `eth_getStorageAt`
- `eth_getProof`

`eth_getBlockReceipts` is especially important because it returns the receipts for a whole block in one call. If the chosen endpoint does not support it, the fallback is per-transaction receipt fetches.

The execution API also gives meaningful state tags:

- `latest`
- `safe`
- `finalized`

Those tags should drive finality semantics in the visualization instead of inventing a separate certainty model.

Sources:

- [Ethereum `eth_getBlockReceipts`](https://ethereum.github.io/execution-apis/api/methods/eth_getBlockReceipts)
- [Ethereum Execution APIs](https://ethereum.github.io/execution-apis/)

### 3. The current Fabric server stack is viable as a publication target, not as the indexing core

`MSF_Map_Svc` and `MSF_Map_Db` already solve several valuable problems:

- an existing hierarchical world/object model
- live client compatibility through the RP1 stack
- object CRUD and realtime refresh behavior
- an installable MySQL or SQL Server backend
- scene-assembler compatibility

But the current local `spatial-fabric-service` is only a thin Docker wrapper around upstream code. Operationally, it has important limitations:

- it clones `MSF_Map_Svc` at image build time instead of pinning a local source tree
- it is optimized for local bring-up, not for a production-owned extension surface
- it reruns install/sample logic on startup
- it is not a blockchain-aware sync engine
- it has no native notion of checkpoints, reorg windows, finality, or idempotent replay

Conclusion:

- **yes**: it is viable to publish into the existing server
- **no**: it is not the right place to embed the core blockchain indexer as-is
- **best path**: keep a separate sync service, and fork upstream server code only when the publication boundary proves insufficient

Sources:

- [MSF Map Service](https://github.com/MetaversalCorp/MSF_Map_Svc)
- [MSF Map Database](https://github.com/MetaversalCorp/MSF_Map_Db?tab=readme-ov-file)

### 4. The map-service SQL track strongly supports a cache-and-projection architecture

The OMB hackathon write-up explicitly frames the map service as a queryable world backed by a database, and suggests caching precomputed results when query demand is high and data changes relatively infrequently.

That aligns almost perfectly with a blockchain visualization backend:

- raw chain data should be journaled first
- spatial projections should be materialized separately
- publication should read from durable projected state
- clients should consume spatial objects, not raw RPC payloads

Source:

- [Map Service Prospective Features](https://omb.wiki/hackathon/tracks/tools/Map-Service-SQL)

## Recommended System Shape

```text
Ethereum JSON-RPC
  -> blockhead ingest service
  -> chain journal
  -> projection engine
  -> Fabric publication service
  -> MSF_Map_Svc / MSF_Map_Db
  -> Fabric clients and Scene Assembler
```

## RPC Strategy

### Required endpoint

Initial prototype endpoint:

- `RPC_WSS_URL`

### Required provider shape

Voltaire expects an EIP-1193-style provider.

That means the project should expose a provider object with at least:

- `request({ method, params })`

Recommended implementation:

1. create a project-owned WebSocket EIP-1193 adapter for `RPC_WSS_URL`
2. pass that provider into Voltaire `BlockStream` and any direct request builders
3. if later needed, add a second provider for HTTP bulk reads and keep the same ingest architecture

### Capability probe at startup

On process boot, probe:

- `eth_chainId`
- `eth_blockNumber`
- `eth_getBlockByNumber`
- `eth_getBlockReceipts`
- `eth_getLogs` with block-hash filtering
- `eth_getBalance`
- `eth_getCode`

Startup policy:

- if `eth_getBlockReceipts` is unsupported, switch to per-tx receipt fallback
- if `eth_getLogs` by `blockHash` is unsupported, degrade carefully and mark recovery guarantees as weaker

### Important transport note

Because `BlockStream.watch()` is polling-based, the system does not need `eth_subscribe` to function.

That means:

- the given `wss://` endpoint is sufficient if the adapter can perform ordinary JSON-RPC requests over WebSocket
- a raw pubsub-first architecture is not required
- optional `eth_subscribe('newHeads')` can be added later as a trigger-plane optimization, not as the source of truth

## Canonical Data Model

The system should maintain a journal before it projects anything spatially.

### Journal tables

- `blocks`
- `transactions`
- `receipts`
- `logs`
- `reorg_events`
- `accounts`
- `contracts`
- `state_snapshots`
- `publication_checkpoints`

### Canonical keys

- block: `(chain_id, block_hash)`
- transaction: `(chain_id, tx_hash)`
- receipt: `(chain_id, tx_hash, block_hash)`
- log: `(chain_id, tx_hash, log_index, block_hash)`
- account snapshot: `(chain_id, address, block_hash)`
- contract snapshot: `(chain_id, address, block_hash)`

### Required fields

Every chain-derived row should keep:

- `chain_id`
- `block_number`
- `block_hash`
- `parent_hash` where relevant
- `canonical`
- `finality_state`

## Spatial Mapping

The spatial model should preserve protocol meaning, not just visual novelty.

### Mapping principles

- stable identity should map to stable place
- transient events should map to transient motion or local effects
- finality should be visible
- reorgs should be repairable and legible
- raw storage should not be mirrored as generic scene objects

### Recommended publication views

Use multiple Fabric entrypoints instead of forcing every blockchain concept into one scene:

- `latest-spine`
- `district-atlas`
- `protocol-landmarks`
- `inspect-attachments`

These entrypoints are blockhead-managed publication conventions, not documented upstream server primitives.

### Entity mapping table

| Blockchain entity | Canonical identity | Spatial role | Preferred MSF class | Notes |
| --- | --- | --- | --- | --- |
| Chain / network | `chainId` | world root | `RMRoot` | one root scope per chain |
| Era / checkpoint / long-range partition | block-range id | macro container | `RMCObject` | optional, for large-scale historical grouping |
| District / protocol neighborhood | cluster id | stable territorial region | `RMTObject` | should contain persistent anchors |
| Block | `blockHash` and `blockNumber` | parcel-like slice on the chain spine | `RMTObject` | best published as navigable surface/container |
| Transaction | `txHash` | pulse, route, or temporary actor | `RMPObject` or effect | usually ephemeral, not permanent geometry |
| Account / EOA | address | persistent anchor / parcel beacon | `RMPObject` | stable location derived from cluster + address hash |
| Contract | address + code hash | landmark / machine / building | `RMPObject` | primary semantic landmark type |
| Native ETH or token class | asset id or token address | material grammar / flow class / corridor color | resource or sidecar metadata, optional `RMPObject` | do not create one permanent object per coin globally |
| Log / protocol event | `(txHash, logIndex, blockHash)` | local emission or mutation | effect or child `RMPObject` | must retract cleanly on reorg |
| Named state field | `(address, field, blockHash)` | gauge / facade / deformation | desired-state metadata or sidecar info on `RMPObject` | state surfaces should be explicit and typed |
| Proof / storage snapshot | `(address, slot-set, blockHash)` | inspect attachment | attachment or resource | on-demand, not hot-path publication; attachment behavior is a compatible-client convention |

### Why blocks should be parcel-like containers

The OMB object hierarchy matters here. Individual transactions, log effects, and block-local annotations fit naturally as children of a block slice. That makes block slices a good fit for parcel-like `RMTObject` publication instead of publishing every block as only a floating physical object.

### Why contracts and accounts should be physical anchors

Accounts and contracts are the stable user-inspectable identities of the chain. They should behave like landmarks, terminals, machines, or parcels, not like anonymous graph points that jump around every block.

### Why tokens should mostly be flow semantics, not static objects

A token is usually most legible as:

- corridor color
- traffic width
- district style
- local contract surface state

Instead of:

- one permanent scene object per token everywhere

Permanent token landmarks still make sense in selected views such as:

- major asset hubs
- stablecoin districts
- protocol-specific worlds

## World Structure

### 1. Latest Spine

Purpose:

- show the canonical chain as a traversable sequence of nearby blocks

Publication shape:

- one `RMCObject` for the spine container
- child `RMTObject` block slices for recent canonical blocks
- child `RMPObject` transaction pulses and event effects

Visual semantics:

- position on spine = block order
- material state = `latest` / `safe` / `finalized`
- width or ornament = gas / receipt density

### 2. District Atlas

Purpose:

- show stable neighborhoods of accounts and contracts

Publication shape:

- one `RMCObject` district container
- child `RMTObject` district parcels
- child `RMPObject` anchors for contracts and EOAs

Visual semantics:

- cluster membership determines district placement
- landmark prominence follows long-window centrality and activity

### 3. Protocol Landmarks

Purpose:

- highlight well-known protocols and semantically rich contracts

Publication shape:

- curated landmark hierarchy
- optional attachment points into protocol-specific child fabrics

These attachment-like deep dives should be treated as project conventions over Fabric resource references, not assumed upstream primitives.

### 4. Inspect Attachments

Purpose:

- expose deeper per-object state without bloating the main world

Publication shape:

- attachment points on important contracts, accounts, or block slices
- child fabrics for traces, storage surfaces, NFT inventories, governance state, and similar deep dives

Current upstream docs/source support resource references and explicit descriptor routes more strongly than they support a first-class attachment standard.

## Sync Architecture

### Core services

#### 1. Ingest service

Responsibilities:

- connect to `RPC_WSS_URL`
- create a Voltaire-compatible provider
- run `BlockStream.backfill()` on cold start or repair
- run `BlockStream.watch()` for live updates
- normalize blocks, transactions, receipts, and logs
- emit reorg-aware journal writes

#### 2. Projection service

Responsibilities:

- build stable districts and anchors
- derive block-spine slices
- classify contracts and flows
- translate chain facts into desired Fabric state

#### 3. Fabric publication service

Responsibilities:

- diff desired Fabric state against published Fabric state
- create, update, move, and delete Fabric objects
- manage attachment links and resource references
- checkpoint publication progress

#### 4. Fabric server

Responsibilities:

- serve `.msf`
- expose live object graph to current clients
- remain the public world contract

## Live Block Sync Loop

Recommended ingest loop:

1. load the last published or journaled checkpoint
2. call `BlockStream.backfill({ fromBlock, toBlock, include: 'receipts' })` until caught up
3. switch to `BlockStream.watch({ fromBlock: lastSeen + 1n, include: 'receipts' })`
4. for `blocks` events:
   - write journal rows
   - update projections
   - publish Fabric mutations
5. for `reorg` events:
   - mark removed rows non-canonical
   - rollback affected projections
   - apply replacement canonical blocks
   - republish affected Fabric regions

### Minimal reference shape

```ts
const provider = createWsProvider({ url: config.rpcWssUrl, ... })
const stream = BlockStream({ provider })

for await (const batch of stream.backfill({
	fromBlock,
	toBlock,
	include: 'receipts',
})) {
	await applyCanonicalBlocks(batch.blocks)
}

for await (const event of stream.watch({
	fromBlock: startFrom,
	include: 'receipts',
})) {
	if (event.type === 'reorg') {
		await rollbackBlocks(event.removed)
		await applyCanonicalBlocks(event.added)
		continue
	}

	await applyCanonicalBlocks(event.blocks)
}
```

### What happens after a few `BlockStream` rounds

Assume the system has already started, backfilled to near-head, and entered `BlockStream.watch()`.

#### Round 1: normal canonical advance

Voltaire emits:

- `type = 'blocks'`
- `blocks = [block_n]`

Backend behavior:

1. `ingest-service` writes the canonical block, transactions, receipts, logs, touched accounts, and touched contracts into the chain journal
2. `projection-service` derives any newly required block slices, anchor updates, corridor updates, and state-surface changes
3. `publication-service` diffs desired Fabric state against remote Fabric state
4. the Fabric server receives the minimal object mutations needed to converge

#### Round 2 and later: more canonical advance

As more `blocks` events arrive:

- the chain journal grows monotonically
- recent windows such as corridors and local state surfaces roll forward
- the live edge of the chain spine extends
- old world structure remains stable while local activity changes

This is important: the world should look like a persistent place that is updating, not like a graph being recomputed from scratch every second.

#### Reorg round

If Voltaire emits a `reorg` event:

- removed blocks are marked non-canonical in the journal
- replacement blocks are inserted as canonical
- projection recomputes only the affected range
- publication sends compensating object mutations so the world repairs itself near the live edge

That means the published world is always a converged view of the current canonical chain, not a direct reflection of the last transport event.

### Receipt policy

Preferred:

- `include: 'receipts'`
- direct `eth_getBlockReceipts` support where available

Fallback:

- full block with transactions
- batched `eth_getTransactionReceipt` per transaction

### Finality policy

Track a configurable finality window and publish it visibly:

- `latest` = volatile
- `safe` = mostly stable
- `finalized` = settled

## State-Enrichment Policy

### Tier 1: block and receipt truth

Always ingest:

- blocks
- transactions
- receipts
- logs

### Tier 2: account and contract identity

Read selectively:

- `eth_getBalance`
- `eth_getTransactionCount`
- `eth_getCode`

Use this tier to classify:

- EOA vs contract
- active vs dormant
- high-value anchors
- deployment events

### Tier 3: protocol overlays

Use Voltaire `EventStream` and typed contract calls for curated protocols:

- ERC-20 transfer corridors
- NFT ownership districts
- AMM reserve surfaces
- governance landmarks

### Tier 4: proof and storage inspection

Use only on demand:

- `eth_getProof`
- `eth_getStorageAt`
- selected traces

This should power inspect-mode child fabrics, not the hot publication path.

## Reorg Semantics In The World

Reorg handling should be visible but localized.

Recommended publication behavior:

- removed blocks detach or fade from the spine
- affected transaction pulses retract
- contract-local event effects reverse
- replacement blocks stitch into the same neighborhood when possible

Do not:

- silently mutate the world with no visible repair behavior
- delete history with no retained audit trail

## Fabric Client Perspective

From a Fabric client's point of view, none of the blockchain-specific machinery is visible directly.

The client does **not** talk to:

- Ethereum JSON-RPC
- Voltaire
- Postgres

The client only talks to the Fabric world:

1. open the `.msf` root
2. connect to the Fabric server
3. load the current object hierarchy for the chosen entrypoint
4. receive live updates according to current client/server transport behavior
5. render object changes as the world converges

### Client sync model

Client sync is publication-driven, not RPC-driven.

That means:

- on first open, the user gets the latest already-published canonical world state
- after that, the client receives incremental object updates
- the client does not replay Ethereum history itself
- the client does not need to know whether backend updates came from backfill, watch mode, or reorg repair

Important boundary:

- current upstream docs/source clearly support ordinary object traversal and live refresh behavior
- they do not clearly guarantee first-class mutable blockchain metadata on object rows
- they also do not clearly guarantee that every compatible client follows deep-dive links through the same attachment convention

### What the user should see visually

On initial load:

- a coherent world already exists
- recent block slices are already laid out on the chain spine
- stable districts and landmarks are already present
- the scene should feel like entering a persistent place, not watching a bootstrap process

As new canonical blocks arrive:

- new slices appear at the live edge of the spine
- transaction pulses and event effects animate locally
- contract surfaces, gauges, and nearby flow corridors update
- the rest of the world stays spatially stable

During reorgs:

- only the recent affected region should visibly repair
- removed blocks and their effects retract
- replacement blocks and effects stitch back in nearby
- the world should not globally reset or jump

### Product implication

The correct user experience is:

- "I am exploring a live blockchain world"

not:

- "I am watching an indexer stream raw chain events"

## Viability Assessment: Current Server vs Fork vs Rewrite

### Option A: build directly on top of the current `spatial-fabric-service` wrapper

Assessment:

- good for local testing
- poor as the main owned codebase

Why:

- it is a thin Docker wrapper, not the actual service source
- it clones upstream on build
- it is not pinned or structured as a project-owned extension point
- it has no blockchain-specific persistence or replay model

Decision:

- **not recommended**

### Option B: use the current local server as a dev publication target while building a separate sync service

Assessment:

- immediately useful

Why:

- it already runs at `localhost:2000`
- it lets the project validate object publication and client compatibility quickly
- it keeps blockchain indexing concerns out of the server runtime

Decision:

- **recommended now**

### Option C: fork upstream `MSF_Map_Svc` / `MSF_Map_Db`

Assessment:

- best long-term path if publication needs server-side changes

Why:

- preserves compatibility with OMB tooling
- gives project ownership over versioning and extension points
- avoids depending on an unpinned Docker clone flow
- still reuses the existing spatial/fabric contract

Decision:

- **recommended when server customization becomes necessary**

### Option D: write a new Fabric server from scratch

Assessment:

- technically possible, strategically premature

Why:

- it discards working compatibility with existing clients and tooling
- it forces the project to solve both blockchain sync and Fabric server semantics at once
- it is not required to validate the product idea

Decision:

- **not recommended for v1**

## Recommended Implementation Plan

### Phase 1: canonical spine MVP

Deliver:

- Voltaire provider against `RPC_WSS_URL`
- reorg-aware block and receipt journal
- `latest-spine` publication into the local Fabric server
- visible `latest` / `safe` / `finalized` states

Success criteria:

- head lag under 2 seconds in normal conditions
- clean restart from checkpoint
- clean repair of at least 6-block reorgs
- opening the Fabric root shows a coherent already-published `latest-spine` view
- a client sees recent canonical blocks extend without global scene re-layout
- a recent reorg is visible as local repair near the live edge, not a full world reset

### Phase 2: district atlas

Deliver:

- account and contract identity model
- stable clustering into districts
- persistent anchors for EOAs and contracts
- basic ETH and ERC-20 flow corridors

### Phase 3: protocol overlays

Deliver:

- Voltaire `EventStream` overlays for selected protocols
- named state surfaces via `eth_call`
- attachment-driven inspect views

### Phase 4: server hardening

Deliver:

- forked and pinned upstream Fabric server if required
- productionized publication checkpoints
- capability-tested fallback policies

## Immediate Engineering Tasks

- [x] implement `createWsProvider()` as a project-owned EIP-1193 adapter
- [x] probe endpoint support for `eth_getBlockReceipts` (probeCapabilities + rpc_capabilities + ingest receipt mode)
- [ ] build canonical journal schema
- [ ] implement Voltaire `BlockStream` backfill and watch runner
- [ ] publish one `latest-spine` entrypoint into `localhost:2000`
- [ ] validate object traversal from an existing Fabric client
- [x] add `EventStream` for one protocol overlay (USDC Transfer via EVENT_STREAM_ERC20_ENABLED)
- [ ] decide whether upstream server changes require a fork immediately or can wait until publication pressure appears

## Cross-Spec Acceptance Criteria

The design work in `001` should be considered validated when all of the following are true:

- backend data flow is explicitly split into ingest, journal, projection, publication, and Fabric serving
- the reason Postgres is the canonical source of truth is explicit
- round-by-round `BlockStream` behavior is described for both normal canonical advance and reorg repair
- Fabric-client sync behavior is described independently from backend ingest behavior
- the user-visible world behavior is specified for initial load, live updates, and reorgs
- success criteria measure both backend correctness and client-visible continuity

## Final Recommendation

The project should be built as a **separate Ethereum sync and projection service** that uses Voltaire for chain ingestion and publishes into an RP1-compatible Fabric server.

The local `spatial-fabric-service` is viable as a dev target and compatibility reference, but not as the long-term owned codebase for the blockchain sync logic. The correct balance is:

- keep the sync engine outside the Fabric server
- keep the Fabric server as the public world boundary
- fork upstream `MSF_Map_Svc` and `MSF_Map_Db` only when server-side control is needed
- avoid a ground-up Fabric-server rewrite until the existing publication model is proven insufficient

That gives the fastest path to a truthful, standards-aligned prototype while preserving a realistic upgrade path to a production-owned stack.
