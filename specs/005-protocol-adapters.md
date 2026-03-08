# Blockhead Fabric Protocol Adapters

## Goal

Define the concrete adapter layer that turns low-level EVM facts into protocol-aware semantic outputs for projection.

Adapters are where the system learns things like:

- this contract is an ERC-20 token
- this address is an AMM pool
- this event means "swap activity"
- this contract should be a landmark
- this state field should become a surface
- this protocol deserves a deep-dive attachment

This spec defines:

- adapter responsibilities
- adapter input and output contracts
- detection and confidence rules
- surface and hint schemas
- scheduling rules
- persistence rules
- the initial adapter families for v1

## Design Principles

- adapters are curated, not universal
- logs first, reads second, storage or traces third
- adapters produce typed semantics, not raw blockchain dumps
- adapters should improve projection without changing the public scene contract
- adapter outputs must be deterministic and versioned
- clients must not need ABI awareness

## Adapter Position In The Stack

```text
canonical chain journal
  -> adapter layer
  -> typed semantic outputs
  -> projection algorithms
  -> desired Fabric state
```

Adapters sit between canonical facts and projection.

They do **not**:

- replace the generic ingest path
- write directly to the Fabric server
- define a custom client protocol

## Responsibilities

An adapter may:

- detect protocol family
- decode relevant logs
- define semantic state surfaces
- contribute landmark scores
- contribute district hints
- contribute publication hints
- request event-triggered or scheduled reads
- request optional deep-dive attachment candidates

An adapter must not:

- continuously mirror arbitrary storage
- invent meanings without explicit detection logic
- bypass deterministic projection rules
- require clients to understand ABI fragments

## Publication Boundary

Adapters produce blockhead semantic outputs and desired-state hints.

They do **not** define new guaranteed upstream Fabric primitives.

That means:

- adapter metadata is blockhead-side semantic data
- attachment hints are candidates for deep-dive links, not proof of a first-class upstream attachment standard
- publication hints may be partially realizable on current upstream Fabric targets depending on adapter, sidecar, and fork strategy

## Adapter Lifecycle

### 1. Detection

Determine whether an entity belongs to a supported protocol family.

### 2. Registration

If detected, register protocol semantic metadata and required semantic definitions.

### 3. Enrichment

On logs, scheduled reads, or inspect requests, derive typed semantic outputs.

### 4. Projection handoff

Write outputs into adapter-backed tables consumed by projection.

## Adapter Runtime Model

### Where adapters run

V1 adapters run inside the `projection-service` process as a library layer.

Reason:

- keeps deployment simple
- avoids extra queues and services
- keeps adapter outputs close to projection logic

Future extraction into a separate service is allowed only if throughput or isolation requires it.

### When adapters run

Adapters may run in three modes:

- `on_log`
- `scheduled_read`
- `on_inspect`

V1 default:

- prefer `on_log`
- allow selective `scheduled_read`
- use `on_inspect` for expensive proof or trace work

## Adapter Interface

Recommended TypeScript contract:

```ts
export type AdapterConfidence =
	| 'exact'
	| 'high'
	| 'medium'
	| 'low'

export type ProtocolAdapter = {
	id: string
	version: number
	family: string
	canHandle: (input: DetectionInput) => DetectionResult | null
	register: (input: RegistrationInput) => RegistrationOutput
	handleLog?: (input: AdapterLogInput) => AdapterEvent[]
	readSurfaces?: (input: SurfaceReadInput) => Promise<StateSurface[]>
	landmarkScore?: (input: LandmarkScoreInput) => number
	districtHints?: (input: DistrictHintInput) => DistrictHint[]
	publicationHints?: (input: PublicationHintInput) => PublicationHint[]
	attachmentHints?: (input: AttachmentHintInput) => AttachmentHint[]
}
```

### Detection input

```ts
type DetectionInput = {
	chainId: number
	address: string
	codeHash: string | null
	bytecodeSize: number | null
	knownSelectors: string[]
	knownTopic0s: string[]
	creatorAddress?: string | null
}
```

### Detection result

```ts
type DetectionResult = {
	protocolId: string
	family: string
	confidence: AdapterConfidence
	reasons: string[]
}
```

### Registration output

```ts
type RegistrationOutput = {
	protocolId: string
	family: string
	confidence: AdapterConfidence
	styleFamily: string
	supportedLogFamilies: string[]
	supportedSurfaceIds: string[]
}
```

## Detection Strategy

### Preferred detection order

1. exact address registry
2. factory ancestry
3. bytecode hash or bytecode fingerprint
4. required event signature set
5. required function selector set

### Confidence policy

- `exact`: known registry or verified factory ancestry
- `high`: bytecode hash or full signature-set match
- `medium`: strong partial signature match
- `low`: weak heuristic only

V1 rule:

- only `exact` and `high` may automatically drive landmarking, publication hints, or attachment hints
- `medium` may produce labels and tentative surfaces
- `low` is diagnostic only

## Persistence Model

Adapters should persist typed outputs instead of keeping them only in memory.

### `adapter_entities`

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

### `adapter_events`

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

### `adapter_surfaces`

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

### `adapter_hints`

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

### Canonicality rule

If a source log becomes non-canonical:

- derived `adapter_events` from that log must become non-canonical too
- recomputed `adapter_surfaces` and `adapter_hints` must converge from canonical facts only

## Semantic Output Schemas

### State surface

```json
{
  "surfaceId": "reserve0",
  "surfaceKind": "gauge",
  "value": "123456789",
  "unit": "token",
  "visualChannel": "height",
  "sourceMode": "scheduled_read"
}
```

Rules:

- `surfaceId` must be stable
- `visualChannel` must match `004`
- one semantic field maps to one visual channel

### District hint

```json
{
  "hintType": "district_seed",
  "districtKey": "amm-uniswap-v2",
  "strength": 0.9,
  "reason": "known pool family"
}
```

V1 rule:

- district hints do not override the default hash-based district algorithm
- they are stored now so later projection versions can use them

### Publication hint

```json
{
  "hintType": "object_style",
  "payload": {
    "preferredEntrypoint": "protocol-landmarks",
    "preferredResourceName": "erc20-token",
    "preferredLabel": "USDC"
  }
}
```

V1 rule:

- publication hints may steer desired-state naming, desired-state metadata, and optional resources
- they do not override deterministic object IDs or hierarchy
- current upstream publication may expose only a subset of those hints through core object fields unless sidecars or a fork are used

### Attachment hint

```json
{
  "hintType": "attachment_candidate",
  "payload": {
    "kind": "contract-inspect",
    "title": "Inspect Contract",
    "priority": 0.85
  }
}
```

## Surface Tiers

### Tier 1: log-derived

Use when:

- event semantics are explicit
- update cost must stay low
- exact point-in-time reads are unnecessary

Examples:

- ERC-20 transfer velocity
- NFT mint activity
- governance vote count

### Tier 2: scheduled reads

Use when:

- a clean `eth_call` exists
- the resulting field is semantically meaningful
- polling cost is acceptable

Examples:

- `totalSupply`
- AMM reserves
- vault total assets
- proposal state

### Tier 3: storage or traces

Use only when:

- no clean log or read method exists
- the value is worth the complexity
- the feature is inspect-mode or protocol-specialized

Examples:

- router path topology
- internal settlement breakdown
- proof-backed inspection

## Read Scheduling

### Global scheduling policy

Adapters may request reads in three modes:

- `on_log`
- `every_n_blocks`
- `on_inspect`

### V1 defaults

- `on_log` for event-driven refresh
- `every_n_blocks` only for high-value landmarks
- `on_inspect` for proofs and traces

### Rate limiting

Each adapter must declare:

- `maxConcurrentReads`
- `minBlocksBetweenReads`
- `maxTargetsPerBlock`

V1 recommended defaults:

- `maxConcurrentReads = 8`
- `minBlocksBetweenReads = 4`
- `maxTargetsPerBlock = 32`

## ABI Management

Adapters should carry only the ABI fragments they actually use.

Do:

- keep ABI fragments small
- version adapter-local event and read definitions
- document required selectors and topic hashes

Do not:

- import giant full protocol ABIs if only a few methods are needed

## Initial V1 Adapter Families

### 1. ERC-20 adapter

Detection:

- `Transfer(address,address,uint256)` event
- optional `symbol()`, `decimals()`, `totalSupply()` reads

Outputs:

- `protocolId = erc20:<address>`
- family label `erc20`
- surfaces:
  - `total_supply`
  - `transfer_velocity_32`
- hints:
  - label from `symbol`
  - token corridor token class
  - token landmark candidate if activity is high

### 2. ERC-721 adapter

Detection:

- ERC-721 `Transfer` event
- optional `name()` and `symbol()` reads

Outputs:

- family label `erc721`
- surfaces:
  - `mint_activity_32`
  - `transfer_activity_32`
- hints:
  - collection label
  - collection landmark candidate

### 3. ERC-1155 adapter

Detection:

- `TransferSingle`
- `TransferBatch`

Outputs:

- family label `erc1155`
- surfaces:
  - `batch_activity_32`
  - `transfer_activity_32`
- hints:
  - multi-token collection landmark candidate

### 4. AMM pool adapter

V1 target:

- Uniswap V2-style pairs first

Detection:

- `Swap`, `Mint`, `Burn`, `Sync` event set
- optional reserve reads

Outputs:

- family label `amm_pool`
- surfaces:
  - `reserve0`
  - `reserve1`
  - `swap_intensity_32`
- hints:
  - landmark promotion
  - optional deep-dive attachment candidate for major pools

### 5. Governance adapter

Detection:

- proposal and vote event signatures
- optional proposal-state reads

Outputs:

- family label `governance`
- surfaces:
  - `active_proposals`
  - `vote_activity_32`
- hints:
  - governance landmark
  - inspect attachment candidate

## Landmark Scoring

Adapters may contribute a normalized landmark component in `[0, 1]`.

Suggested formula:

```text
adapterLandmarkScore =
  protocolImportanceWeight +
  usageWeight +
  explicitLabelWeight +
  stateMagnitudeWeight
```

Rule:

- adapters contribute only part of the final score
- projection owns the final landmark promotion decision

## Publication Hints

Allowed hint families in V1:

- preferred label
- preferred resource name
- preferred style family
- preferred entrypoint
- attachment candidate

Not allowed in V1:

- direct transform override
- object ID override
- hierarchy override

Those remain projection-owned.

## Deep-Dive Attachments

Adapters may nominate an entity for inspect-mode attachment creation.

Use when:

- a contract has rich state surfaces
- a protocol has obvious internal structure
- a human user would benefit from a specialized subfabric

Examples:

- AMM pool inspect view
- governance proposal view
- NFT collection inspect view

Rule:

- adapter may nominate
- projection decides
- publication materializes

Compatibility note:

- adapter attachment hints should be interpreted as candidates for resource-reference-based deep links
- conventions such as subtype `255` belong to the scene/integration layer, not to adapter truth

## Failure Policy

Unknown or partially matched contracts must fail safely.

Rules:

- detection failure never blocks generic projection
- read failures only suppress adapter enrichment for that target
- one broken adapter must not break projection globally
- low-confidence matches must not auto-promote important world structure

## Testing Strategy

Each adapter should have:

- detection tests
- log decoding tests
- surface derivation tests
- hint-generation tests
- reorg recomputation tests

Minimum invariants:

- same canonical inputs produce the same adapter outputs
- non-canonical source logs do not survive as canonical adapter events
- read scheduling respects configured limits
- publication hints remain compatible with `003`

## Acceptance Criteria

The adapter layer is good enough for v1 when:

- at least `3` protocol families are implemented end-to-end
- adapter outputs are persisted, versioned, and rebuild-safe
- adapter outputs improve labels, landmark selection, or surfaces without changing the core scene contract
- failed adapter reads do not break generic projection
- adapter-derived event and surface outputs converge correctly after a recent reorg
- attachment candidates are generated through explicit rules, not ad hoc code paths

## Implementation Status

- [x] Adapter registry implemented
- [x] Detection and registration persistence implemented
- [x] Adapter event persistence implemented
- [x] Adapter surface persistence implemented
- [x] ERC-20 adapter implemented
- [x] ERC-721 or ERC-1155 adapter implemented
- [x] AMM or governance adapter implemented
- [x] Reorg-safe adapter recompute validated
