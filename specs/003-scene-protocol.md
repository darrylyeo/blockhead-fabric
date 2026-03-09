# Blockhead Fabric Scene Protocol

## Goal

Define the concrete publication contract for `blockhead-fabric` as a Fabric-native world.

This spec answers:

- what the public world structure is
- which entrypoints and object hierarchies are published
- how blockchain entities map to published objects
- how IDs, names, metadata, attachments, and resources are encoded
- what a Fabric client should rely on
- what live updates mean from the client's perspective

This spec does **not** define internal ingest or projection mechanics. Those are owned by `001` and `002`. This file defines the client-facing world model produced by those systems.

## Core Rule

The public product boundary is:

```text
.msf
  -> Fabric root
  -> object hierarchy
  -> attachment points
  -> resource references
  -> live object updates
```

It is **not**:

- a custom blockchain scene transport
- a custom `/worlds/:id` API
- a custom history or rollback protocol
- a blockhead-specific websocket protocol

## Design Principles

- existing Fabric clients must be able to browse the world
- object hierarchy is the primary navigation surface
- entrypoints are blockhead-managed root-child conventions, not a replacement protocol
- stable blockchain identity must map to stable object identity
- client-visible changes should be local and incremental
- deep dives should use attachments before inventing new public primitives

## Standards Boundary

This spec intentionally mixes two layers:

- standards-backed Fabric behavior
- blockhead publication conventions layered on top

Standards-backed in current upstream docs/source:

- `.msf`-style descriptor discovery
- the `RMRoot` / `RMCObject` / `RMTObject` / `RMPObject` hierarchy
- ordinary object traversal and mutation

Blockhead conventions in this spec:

- named entrypoints like `latest-spine`
- semantic `object_id` strings
- rich blockchain metadata payloads
- deep-dive attachment conventions

If a convention is not supported directly by the current upstream server, it must be realized through:

- adapter behavior
- sidecar info payloads
- or a future upstream fork

## Public Stack

The expected public stack is:

```text
.msf root
  -> MSF_Map_Svc-compatible Fabric server
  -> live object graph
  -> MVMF-compatible client behavior
```

For v1 this means:

- discovery starts from `.msf`
- clients open the root and traverse published objects
- blockhead-specific semantics live in object naming, placement, metadata, and attachments

## Client Contract

Clients should be able to:

1. open the `.msf` root
2. locate top-level entrypoint objects
3. traverse objects through the normal hierarchy
4. inspect stable object fields and blockhead metadata where available
5. follow deep-dive links into child fabrics when compatible clients support them
6. receive live updates as ordinary Fabric object changes

Clients should **not** need to know:

- Ethereum RPC details
- Voltaire event shapes
- Postgres schemas
- internal projection job boundaries

## Scope Strategy

### V1 scope model

Use one chain-wide scope per chain.

For Ethereum mainnet:

- `scope_id = scope_eth_mainnet`

This scope contains the main published world for:

- `latest-spine`
- `district-atlas`
- `protocol-landmarks`

### Child scopes

Use child scopes only when one of these is true:

- a district becomes too large or noisy
- a protocol deserves a dedicated explorable subfabric
- a historical slice needs isolated presentation
- an inspect-mode deep dive is too dense for the main scope

## Entrypoint Strategy

Entrypoints are top-level root-child navigation objects managed by blockhead.

They are not assumed to be first-class server primitives.

### Required v1 entrypoints

- `latest-spine`
- `district-atlas`
- `protocol-landmarks`

### Optional entrypoints

- `inspect-attachments`
- curated protocol hubs
- historical replay anchors

### Entrypoint object rules

Each entrypoint:

- is a root child object
- has a stable `object_id`
- owns a subtree
- can be shared through an explicit Fabric descriptor path

Recommended IDs:

- `entry_latest_spine`
- `entry_district_atlas`
- `entry_protocol_landmarks`

Recommended names:

- `Latest Spine`
- `District Atlas`
- `Protocol Landmarks`

## Object Classes

Use the RP1 object classes as follows:

- `70` = root
- `71` = celestial container
- `72` = terrestrial place/container
- `73` = physical object / landmark / effect

### Publication rules

- chain root is `70`
- large structural containers like the spine container are `71`
- districts, parcels, and block slices are primarily `72`
- accounts, contracts, transaction pulses, event effects, and attachment points are `73`

### Why block slices are `72`

Blocks are published as parcel-like spatial slices because they own local children:

- transaction pulses
- block-local summaries
- local event effects

That makes them better containers than free-floating physical objects.

## Object Identity

### Requirements

Object IDs must be:

- deterministic
- stable across republish
- derived from canonical semantic identity
- unique within a scope

### Object ID scheme

Use string IDs with semantic prefixes:

```text
entry:<name>
container:<name>
block:<chainId>:<blockNumber>
district:<chainId>:<districtId>
account:<chainId>:<address>
contract:<chainId>:<address>
corridor:<chainId>:<corridorKey>
surface:<entityId>:<surfaceId>
attachment:<chainId>:<kind>:<stableKey>
```

Recommended concrete examples:

- `entry:latest-spine`
- `container:spine`
- `block:1:23100001`
- `district:1:d_ab`
- `account:1:0x742d35cc6634c0532925a3b844bc9e7595f0beb0`
- `contract:1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`
- `corridor:1:d_ab|d_f4|erc20_transfer|usdc`
- `attachment:1:contract-inspect:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`

### Entity ID vs object ID

Keep both:

- `object_id` = blockhead desired-state identity
- `entity_id` = semantic blockchain identity stored in desired-state tables and optional metadata

Rule:

- one semantic entity can own multiple published objects
- one published object should point back to one primary `entity_id`

Important upstream note:

- current upstream Fabric servers identify objects by numeric `(wClass, twObjectIx)`
- `object_id` is therefore a blockhead identity that must be carried through adapter resolution, not a native upstream key

## Object Naming

Blockhead distinguishes between:

- a stable machine identity
- a user-facing label

In desired state, `name` should be user-facing and concise.

Recommended naming:

- block slice: `Block 23100001`
- district: `District d_ab`
- account anchor: shortened address or label
- contract landmark: protocol label or shortened address
- corridor: `USDC Flow d_ab -> d_f4`
- attachment: `Inspect Contract`

Rules:

- prefer known labels over raw addresses when confidence is high
- fall back to checksummed shortened addresses
- avoid names that depend on unstable metrics

Important upstream note:

- current upstream `MSF_Map_Svc` may need to use the core `Name_*` field as a stable machine identity for reconciliation
- when that path is used, user-facing labels may need to live in sidecar metadata or compatible client presentation logic
- do not assume the current upstream target always preserves separate friendly-name and stable-ID fields

## World Hierarchy

### Root structure

```text
root
  -> entry:latest-spine
  -> entry:district-atlas
  -> entry:protocol-landmarks
```

### `latest-spine` subtree

```text
entry:latest-spine
  -> container:spine
    -> block:1:<blockNumber>
      -> tx-pulse objects
      -> event-effect objects
      -> optional summaries
```

### `district-atlas` subtree

```text
entry:district-atlas
  -> district:1:<districtId>
    -> parcel or local containers
      -> account:1:<address>
      -> contract:1:<address>
      -> corridor or local flow objects
```

### `protocol-landmarks` subtree

```text
entry:protocol-landmarks
  -> protocol containers
    -> landmark contracts
    -> optional attachment points
```

## Transforms And Bounds

### Required transform schema

All objects should materialize to a Fabric transform with:

- `position`
- `rotation`
- `scale`

Recommended JSON shape in desired-state tables:

```json
{
  "position": { "x": 0, "y": 0, "z": 0 },
  "rotation": { "x": 0, "y": 0, "z": 0, "w": 1 },
  "scale": { "x": 1, "y": 1, "z": 1 }
}
```

### Bounds

Use bounds for all major navigable objects:

- districts
- parcels
- block slices
- large landmarks
- attachment anchors

Bounds are important for:

- client navigation
- culling
- future interest-management behavior

## Metadata Contract

`metadata_json` is part of the blockhead desired-state contract.

It is **not** currently a documented first-class mutable field in upstream `MSF_Map_Svc` / `MSF_Map_Db`.

That means:

- desired-state rows should always carry `metadata_json`
- publication adapters may only be able to expose a subset of that metadata through current upstream fields
- rich metadata may require sidecar `info` payloads or a future upstream fork

### Required metadata fields

```json
{
  "schemaVersion": 1,
  "entityId": "block:1:23100001",
  "entityKind": "block",
  "chainId": 1,
  "canonical": true,
  "finalityState": "latest",
  "updatedAtBlock": 23100001
}
```

### Additional metadata by object kind

#### Block slice

```json
{
  "entityKind": "block",
  "blockNumber": 23100001,
  "blockHash": "0x...",
  "timestamp": "2026-03-07T00:00:00Z",
  "txCount": 214,
  "logCount": 983,
  "gasUsed": "12345678",
  "finalityState": "safe"
}
```

#### Account anchor

```json
{
  "entityKind": "account",
  "address": "0x...",
  "isContract": false,
  "districtId": "d_ab",
  "label": "0x742d...beb0"
}
```

#### Contract landmark

```json
{
  "entityKind": "contract",
  "address": "0x...",
  "districtId": "d_f4",
  "familyLabel": "erc20",
  "protocolLabel": "USDC",
  "stateSurfaces": [
    "activity_32",
    "event_count_32"
  ]
}
```

#### Corridor

```json
{
  "entityKind": "corridor",
  "sourceDistrictId": "d_ab",
  "targetDistrictId": "d_f4",
  "flowClass": "erc20_transfer",
  "tokenClass": "usdc",
  "window": 32
}
```

### Metadata rules

- metadata must be machine-readable first
- metadata should avoid duplicating raw internal DB row structure
- fields should remain stable across republish
- clients may render richer UI from metadata, but the hierarchy remains primary
- compatibility with current upstream Fabric servers should not assume all metadata is writable into core object rows

## Resource References

Use `resourceReference` and `resourceName` for:

- simple geometry presets
- icons or labels
- generated corridor meshes
- attachment links to child descriptor URLs

### Current v1 visual asset strategy

The current local publication path uses generated static GLTF assets served by the Fabric server from:

- `action://objects/<asset>.gltf`

These assets are intentionally simple solids so the world reads as a physical blockchain even in generic Fabric clients.

Current visual families:

- finalized block slice -> green block solid
- safe block slice -> teal block solid
- latest block slice -> blue block solid
- district / large protocol pad -> dark slab
- account anchor -> cyan cube
- generic contract -> amber prism
- ERC-20 landmark -> token-colored prism
- NFT / multi-token landmark -> purple prism
- AMM pool landmark -> aqua prism
- native corridor -> gold beam
- ERC-20 corridor -> cyan beam
- contract-call corridor -> violet beam
- tx pulse -> orange pillar
- event effects -> family-colored small solids
- state surfaces -> metric-colored bars

Resource identity is therefore part of the client-visible scene contract for v1, not just optional decoration.

### Resource rules

- resources are expected for major published object families in v1
- metadata-only publication remains acceptable only for secondary objects or degraded targets
- generated assets should be deterministic and cheap to regenerate during local Fabric image build
- `action://objects/...` should remain stable so compatible clients can cache them aggressively

## Attachments

### Attachment semantics

Attachment points are normal physical objects with:

- class `73`
- `resourceReference` pointing to a child descriptor URL

Current support boundary:

- `RMPObject` resource references are standards-backed upstream behavior
- subtype `255` is a blockhead / compatible-client convention, not a current upstream standard guarantee
- attachment targets should prefer explicit `/fabric/<class>/<objectIx>/` URLs over assuming bare `/fabric/`

### When to publish an attachment

Publish an attachment when:

- a contract has a deep inspect view
- a protocol zone deserves a child scope
- a historical replay slice needs isolation
- a district is too dense for the main view

### Attachment object rules

- attachment objects must have stable IDs
- names must explain what the user is entering
- attachment targets must be resolvable Fabric descriptor URLs
- following an attachment should feel like entering a connected sub-place, not opening an arbitrary debug view

## Live Update Semantics

Live updates should be expressed as ordinary Fabric object changes as much as the current client/server pair allows.

### Allowed client-visible meanings

Clients may observe:

- new objects created
- existing objects updated
- some objects moved
- objects deleted
- attachment references changed

### What clients should infer

Clients should interpret these as:

- world extension
- local repair
- state change
- activity pulse

Clients should **not** need special rollback protocol awareness.

### Normal canonical advance

Client-visible behavior:

- a new block slice appears at the live edge
- local tx pulse objects appear or animate
- nearby contract landmarks update metadata or surfaces
- corridor visuals may intensify

### Reorg

Client-visible behavior:

- recent affected block slices retract or disappear
- replacement slices appear nearby
- local effects reverse and restitch

Rule:

- the world should repair locally, not globally reset

## Client Sync Semantics

From the client perspective, sync works like:

1. open root
2. fetch current published hierarchy
3. render current world
4. receive incremental updates according to current Fabric transport behavior

This implies:

- initial open should show a coherent already-published world
- clients are not expected to rebuild history from live events
- the published world is always a lagged, converged view of canonical chain state

## Entry View Requirements

### `latest-spine`

Required:

- recent canonical block slices
- clear ordering along the spine
- visible `latest` / `safe` / `finalized` distinction
- tx pulses placed on or just above the owning block surface
- event effects clustered around the tx pulse when that tx is materialized
- block size should encode recent activity so dense blocks read as larger physical slices

### `district-atlas`

Required:

- stable districts
- stable placement for accounts and contracts
- no frame-to-frame jitter under normal updates
- districts centered on a coarse world grid rather than anchored from one corner
- accounts and contracts spread across the full district footprint
- corridors should read as explicit directional beams between districts

### `protocol-landmarks`

Required:

- curated landmark hierarchy
- stronger labels
- meaningful deep-dive attachments where available
- visually distinct landmark families for fungible tokens, NFT collections, and AMM pools
- child surface bars or gauges that expose the current semantic state of important contracts

## Compatibility Targets

The scene protocol is acceptable only if existing Fabric tools can browse it.

Primary validation targets:

- `Manifolder`
- `ManifolderClient`
- `Scene Assembler`

Expected operations:

- `connectRoot()`
- object traversal from root children
- `listObjects()`
- `getObject()`
- attachment-following where supported by the client

## Versioning

Include protocol versioning in metadata and desired-state compilation.

### Required version fields

- `schemaVersion`
- `projectionVersion`
- `layoutVersion`

Reason:

- clients may not care immediately, but publishers and debugging tools will
- version bumps should allow deterministic republish and controlled migration

## Non-Goals

This spec does not define:

- custom AOI subscriptions
- generic history transport
- debug or analytics side-channel APIs
- user-authored edits to the blockchain world

Those can exist later as helper layers, not as the main scene protocol.

## Acceptance Criteria

The scene protocol is good enough when:

- the world opens through `.msf` with no blockhead-specific client adapter
- top-level entrypoints are ordinary root-child objects with stable IDs
- object IDs are deterministic and semantically derived
- accounts and contracts remain stable across normal updates
- block slices are traversable containers rather than anonymous floating nodes
- deep-dive links can be published through resource references, with subtype `255` treated as a compatible-client convention rather than a required upstream primitive
- desired-state metadata is sufficient to distinguish blocks, accounts, contracts, corridors, surfaces, and attachments, even if current upstream publication exposes only a subset without sidecars or a fork
- a recent reorg can be represented through ordinary object mutations without inventing a public rollback protocol
- initial client load shows a coherent world rather than a visibly bootstrapping scene
- the major world structures use stable visual resources so a generic client can read the blockchain scene without blockhead-specific rendering code

## Implementation Status

- [x] Scope and entrypoint IDs fixed
- [x] Object ID scheme fixed
- [x] Metadata schema fixed
- [x] Attachment contract fixed
- [x] `latest-spine` hierarchy validated
- [x] `district-atlas` hierarchy validated
- [x] Deterministic visual resource vocabulary wired into projected objects
- [x] Local Fabric wrapper emits generated `action://objects/*.gltf` assets for the blockhead scene
- [x] Client compatibility validated with existing Fabric tooling (e2e root-descriptor check; Manifolder at http://localhost:3000/app.html?msf=http://localhost:2000/fabric loads hierarchy)
- [x] Blockhead Fabric in Manifolder featured list (Blockhead Fabric (Local) → http://localhost:2000/fabric)
- [x] Automated Manifolder E2E: `pnpm service:test:e2e:manifolder` validates fabric descriptor + Manifolder page load

### Audit Notes (2026-03-08)

**Matches spec:**
- Scope: `scope_eth_mainnet` for chain 1
- Entrypoint IDs: `entry_latest_spine`, `entry_district_atlas`, `entry_protocol_landmarks`
- Object IDs: `block:chainId:blockNumber`, `district:chainId:districtId`, `account:chainId:address`, `contract:chainId:address`, `attachment:chainId:kind:address`, `surface:entityId:surfaceId`
- Metadata: `schemaVersion`, `entityId`, `entityKind`, `chainId`, `canonical`, `finalityState` (blocks), `updatedAtBlock`
- Attachments: subtype `255`, `resourceReference` to child scope descriptor
- Hierarchy: entry → container:spine → block → tx/event; entry → district → account/contract; corridors under source district; protocol-landmarks → containers (class 71) → contracts
- Visual resources: generated `action://objects/*.gltf` assets now assigned to major object families
- Landmark state: child `surface:*` objects now materialized for visible protocol landmarks and inspect scopes

**Deviations:**
- Corridor ID: impl uses `corridor:chainId:source:target:flowClass:tokenClass:window` (colons, includes window); spec example uses `corridor:1:d_ab|d_f4|erc20_transfer|usdc` (pipe in key)
- Class IDs: spine entry, container, blocks use 73; spec recommends 71 for spine container, 72 for blocks
- Versioning: `projectionVersion` and `layoutVersion` not in object metadata (schemaVersion present)
