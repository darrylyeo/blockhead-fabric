# Blockhead Fabric Projection Algorithms

## Goal

Define the concrete algorithms that map canonical chain facts into the published Fabric world.

This spec covers:

- block spine projection
- district assignment
- anchor placement
- corridor aggregation
- state surface derivation
- event-effect projection
- partitioning into attachments and child scopes

This spec is intentionally implementation-first. V1 algorithms are the default. More advanced graph or ML-driven approaches are explicitly treated as later revisions.

## Standards Boundary

This spec defines blockhead projection outputs, not a claim about which fields are first-class in current upstream Fabric servers.

That means:

- projection always computes full desired-state metadata and attachment intent
- publication may expose those outputs through core object fields, sidecar info payloads, or a future upstream fork
- conventions such as attachment subtype `255` remain blockhead / compatible-client conventions unless the integration contract validates them upstream

## Design Principles

- deterministic first
- stable places over locally optimal layouts
- bounded local updates over global redraws
- aggregate when exact rendering destroys legibility
- every published object must trace back to canonical chain facts or explicit config
- the same canonical history and config must produce the same desired Fabric state

## Inputs

Primary inputs from Postgres:

- canonical `blocks`
- canonical `transactions`
- canonical `receipts`
- canonical `logs`
- `accounts`
- `contracts`
- `reorg_events`

Secondary inputs:

- projection config
- protocol label registry
- token label registry
- optional contract adapter outputs

## Output Tables

Projection writes:

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

## Projection Versions

Use explicit versions for any algorithm that affects object placement or identity.

Required version fields:

- `projectionVersion`
- `districtAlgorithmVersion`
- `anchorAlgorithmVersion`
- `corridorAlgorithmVersion`
- `surfaceAlgorithmVersion`

### V1 versions

- `projectionVersion = 1`
- `districtAlgorithmVersion = 1`
- `anchorAlgorithmVersion = 1`
- `corridorAlgorithmVersion = 1`
- `surfaceAlgorithmVersion = 1`

## Projection Pass Order

For each projection job range:

1. resolve canonical block window
2. materialize `latest-spine`
3. materialize district assignments
4. materialize entity anchors
5. aggregate corridors
6. derive state surfaces
7. derive event effects
8. emit desired Fabric scopes, entrypoints, objects, and attachments
9. advance `projection_checkpoints`

Rule:

- all projection output for a job range must commit atomically

## Block Spine Projection

### Purpose

Represent canonical block order as a navigable spatial spine.

### Published objects

- `entry:latest-spine`
- `container:spine`
- `block:<chainId>:<blockNumber>` for recent canonical blocks

### Window

V1 only publishes a rolling recent window.

Recommended default:

- `SPINE_RECENT_BLOCK_COUNT = 256`

If the head is `H`, publish blocks:

```text
[max(0, H - 255), H]
```

### Transform formula

Let:

- `blockSpacing = 24`
- `windowStart = oldest block number in the published spine window`

For block `n`:

```text
x = 0
y = finalityBand(finalityState)
z = (n - windowStart) * blockSpacing
```

Recommended finality bands:

- `latest -> 0`
- `safe -> 2`
- `finalized -> 4`

### Bounds

Use deterministic bounds derived from chain activity:

```text
bound.x = widthBucket(logCount, gasUsed)
bound.y = 4
bound.z = depthBucket(txCount)
```

Recommended V1 buckets:

```text
depthBucket(txCount):
  0..24      -> 12
  25..99     -> 18
  100..249   -> 24
  250..499   -> 30
  500+       -> 36

widthBucket(logCount, gasUsed):
  low        -> 8
  medium     -> 12
  high       -> 16
  extreme    -> 20
```

### Metadata

Each block object must include:

- `blockNumber`
- `blockHash`
- `timestamp`
- `txCount`
- `logCount`
- `gasUsed`
- `canonical`
- `finalityState`

### Reorg behavior

If block number `n` changes hash during a reorg:

- keep `object_id = block:<chainId>:<n>`
- replace desired-state metadata with the new canonical block hash and related metrics
- retract or replace child event and pulse objects under that block slice

This keeps the spine spatially stable while remaining canonically honest.

## District Assignment

### Purpose

Give accounts and contracts persistent neighborhoods.

### V1 algorithm

Use deterministic hash-based districting, not graph clustering.

Formula:

```text
districtKey = hexPrefix(keccak(lowercaseAddress), 2)
districtId = 'd_' + districtKey
```

That yields up to `256` stable districts.

### Why V1 uses hashing

- deterministic
- cheap
- reorg-insensitive
- stable across rebuild
- enough to validate the world model before investing in dynamic communities

### Published district set

Only publish districts that currently have visible entities or corridor activity.

District object ID:

```text
district:<chainId>:<districtId>
```

District desired-state metadata:

- `districtId`
- `entityCount`
- `contractCount`
- `accountCount`
- `activityWindow32`

### V2 direction

Future versions may replace hash districts with graph communities, but only if:

- object IDs remain stable enough for migration
- anchor churn stays low
- publication remains incremental

That is explicitly out of scope for V1.

## Anchor Placement

### Purpose

Place persistent entities inside districts with stable positions.

### Inputs

- `districtId`
- `address`
- `isContract`
- optional protocol label

### V1 district grid

Map district IDs onto a coarse 16x16 world grid.

Formula:

```text
districtX = parseHex(districtKey[0]) * DISTRICT_SPACING
districtZ = parseHex(districtKey[1]) * DISTRICT_SPACING
districtOrigin = (districtX, 0, districtZ)
```

Recommended:

- `DISTRICT_SPACING = 256`

### V1 local slot placement

Within a district, compute a deterministic local slot from the full address hash.

Formula:

```text
slotHash = keccak(lowercaseAddress)
localX = (slotHash[2..3] mod 16) * SLOT_SPACING
localZ = (slotHash[4..5] mod 16) * SLOT_SPACING
localY = 0
```

Recommended:

- `SLOT_SPACING = 12`

Final position:

```text
anchor.position = districtOrigin + (localX, localY, localZ)
```

### Contract landmark override

Contracts get a small centrality bias so they appear more prominent.

V1 rule:

- if `isContract`, subtract `24` from both `localX` and `localZ` if doing so keeps them inside district bounds
- if labeled as a major known protocol landmark, reserve one of a small set of central slots

### Collision handling

V1 collision resolution is deterministic and bounded.

If two entities map to the same slot:

1. sort colliding entities by `entityId`
2. assign offsets from a fixed spiral table
3. never move entities outside the owning district

Recommended spiral offsets:

```text
(0, 0)
(6, 0)
(-6, 0)
(0, 6)
(0, -6)
(6, 6)
(-6, 6)
(6, -6)
(-6, -6)
```

### Stability rule

An anchor must never move unless one of these is true:

- its district algorithm version changed
- its anchor algorithm version changed
- its deterministic collision group changed
- its explicit landmark override changed

Normal chain activity alone should not move an existing anchor.

## Parcel Assignment

### Purpose

Add one more layer between districts and dense entities when needed.

### V1 rule

V1 does not require explicit parcel objects everywhere.

Use parcel containers only when:

- a district exceeds `DISTRICT_DIRECT_CHILD_LIMIT`
- a protocol adapter wants to group multiple addresses as one local site

Recommended:

- `DISTRICT_DIRECT_CHILD_LIMIT = 128`

Parcel ID:

```text
parcel:<chainId>:<districtId>:<parcelKey>
```

Parcel key in V1:

- top nibble pair from the address hash after the district bytes

## Corridor Aggregation

### Purpose

Represent repeated traffic as district-to-district flow rather than raw edge clouds.

### Input events

V1 corridor inputs:

- ETH value transfers
- ERC-20 `Transfer` logs
- contract calls between known sender and receiver addresses

### District resolution

For each event:

1. resolve source entity
2. resolve target entity
3. map each to its district

If source or target is missing:

- drop the event from corridor aggregation
- keep it available in lower-level block-local views if needed

### Flow classes

Use these V1 classes:

- `native_transfer`
- `erc20_transfer`
- `contract_call`

### Token classes

Use:

- `eth` for native transfer
- known token symbol slug for labeled ERC-20s
- `unknown-token` otherwise
- `none` for plain contract calls

### Corridor key

```text
<sourceDistrictId>|<targetDistrictId>|<flowClass>|<tokenClass>|<window>
```

### Windows

Compute separate corridor aggregates for:

- `8`
- `32`
- `128`

### V1 metrics

For each corridor:

- `eventCount`
- `distinctTxCount`
- `totalValueWei` for native transfers
- `tokenTransferCount` for ERC-20 transfers
- `lastSeenBlock`

### Publication threshold

A corridor becomes a published object only if at least one is true:

- `eventCount >= 8` in window `32`
- `distinctTxCount >= 4` in window `8`
- it is in the top `20` outbound or inbound corridors for either district in window `32`

Otherwise:

- keep it as internal aggregate data only

### Corridor placement

Corridor owner:

- attach corridor objects under the source district root in V1

Corridor transform:

- midpoint between source and target district origins
- slight `y` elevation by flow class

Recommended `y`:

- `native_transfer -> 2`
- `erc20_transfer -> 4`
- `contract_call -> 6`

Corridor bounds:

- proportional to district-to-district distance and activity bucket

## State Surface Derivation

### Purpose

Expose semantic local state without mirroring arbitrary storage.

### V1 surfaces

For every published contract landmark:

- `activity_32`
- `incoming_value_32`
- `outgoing_value_32`
- `event_count_32`

For optionally published accounts:

- `activity_32`
- `incoming_value_32`
- `outgoing_value_32`

### Surface formulas

For entity `E` at head `H`:

```text
activity_32 = count(transactions touching E in [H-31, H])
incoming_value_32 = sum(native value into E in [H-31, H])
outgoing_value_32 = sum(native value out of E in [H-31, H])
event_count_32 = count(logs emitted by E in [H-31, H])
```

### Visual channels

Recommended default mapping:

- `activity_32 -> emissiveIntensity`
- `incoming_value_32 -> height`
- `outgoing_value_32 -> width`
- `event_count_32 -> particleDensity`

### Publication form

V1 records surfaces in desired state as metadata or sidecar-compatible semantic payloads on the owning object.

Current upstream note:

- this does not imply current `MSF_Map_Svc` can write all surface data into first-class core object rows
- publication may expose only a subset through current upstream fields unless sidecars or a fork are used

Optional later extension:

- child surface objects for especially important landmarks

## Event Effect Projection

### Purpose

Turn logs into local, reversible scene changes.

### V1 supported event families

- ERC-20 `Transfer`
- ERC-721 `Transfer`
- ERC-1155 transfer events
- contract-specific curated events only after adapter support exists

### Default behavior

Event effects are block-local children under the owning block slice, not permanent global objects.

Object ID:

```text
event:<chainId>:<txHash>:<logIndex>
```

Parent:

- the corresponding `block:<chainId>:<blockNumber>` slice

Metadata:

- `emitterAddress`
- `topic0`
- `eventFamily`
- `txHash`
- `logIndex`

### Reorg rule

If a log becomes removed:

- delete or replace the corresponding event object under the affected block slice

## Transaction Pulse Projection

### Purpose

Represent block-local activity without keeping every tx as permanent global geometry.

### V1 rule

Publish tx pulse objects only inside recent block slices.

Window:

- only for the most recent `32` blocks

Threshold:

- either top `N` transactions by value or gas within the block
- or sampled transactions if block density is too high

Recommended:

- `MAX_TX_PULSES_PER_BLOCK = 24`

Object ID:

```text
tx:<chainId>:<txHash>
```

Parent:

- `block:<chainId>:<blockNumber>`

### Selection order

Sort by:

1. native value descending
2. gas used descending
3. tx index ascending

Then keep the first `MAX_TX_PULSES_PER_BLOCK`.

## Protocol Landmark Promotion

### Purpose

Choose which contracts become especially visible landmarks.

### V1 promotion rule

Promote a contract if any is true:

- it has a known protocol label
- it is in the top `N` contracts by `activity_32` in its district
- it is referenced by an attachment target

Recommended:

- `TOP_CONTRACT_LANDMARKS_PER_DISTRICT = 8`

### Landmark desired-state metadata

- `protocolLabel`
- `familyLabel`
- `landmarkRank`
- `districtId`

## Attachments And Partitioning

### Purpose

Break out dense or specialized views without bloating the main world.

### V1 attachment triggers

Create an attachment candidate if:

- a contract has curated inspect support
- a district exceeds `ATTACHMENT_DISTRICT_ENTITY_THRESHOLD`
- a protocol zone has `>= 3` known landmarks in one district

Recommended:

- `ATTACHMENT_DISTRICT_ENTITY_THRESHOLD = 256`

### Attachment publication

Publish as:

- `class = 73`
- `resourceReference = explicit child descriptor URL`

Compatibility note:

- subtype `255` may be added as a blockhead / compatible-client convention
- do not treat subtype `255` as an upstream Fabric standard guarantee

Attachment object ID:

```text
attachment:<chainId>:<kind>:<stableKey>
```

## Rebuild Behavior

Projection must support both:

- incremental recompute for a bounded block range
- full rebuild from canonical journal

### Incremental recompute

Use for:

- normal block advance
- recent reorg repair

Range:

- from the earliest affected block through head

### Full rebuild

Use for:

- algorithm version bump
- schema migration
- detected projection corruption

Rule:

- full rebuild must produce the same desired-state output for the same journal and config

## Pseudocode

### Main projection loop

```ts
for (const job of nextProjectionJobs()) {
	const canonicalWindow = loadCanonicalWindow(job.fromBlockNumber, job.toBlockNumber)
	const head = loadCanonicalHead()

	materializeSpine(head)
	materializeDistrictMemberships(head)
	materializeAnchors(head)
	materializeCorridors(head)
	materializeStateSurfaces(head)
	materializeEventEffects(head)
	materializeDesiredFabricState(head)
	commitProjectionCheckpoint(job, head)
}
```

### District assignment

```ts
const districtIdForAddress = (address: string) => (
	`d_${keccak(address.toLowerCase()).slice(2, 4)}`
)
```

### Anchor placement

```ts
const anchorForEntity = (districtId: string, entityKey: string) => {
	const districtKey = districtId.slice(2)
	const districtOrigin = {
		x: parseInt(districtKey[0], 16) * 256,
		y: 0,
		z: parseInt(districtKey[1], 16) * 256,
	}
	const hash = keccak(entityKey.toLowerCase())

	return {
		x: districtOrigin.x + ((parseInt(hash.slice(4, 6), 16) % 16) * 12),
		y: 0,
		z: districtOrigin.z + ((parseInt(hash.slice(6, 8), 16) % 16) * 12),
	}
}
```

## Anti-Patterns

Do not:

- recompute a global force layout every block
- move landmarks because short-window activity changed
- publish every transaction as a permanent world object
- expose arbitrary storage slots as scene protocol
- depend on non-deterministic placement
- let projection output depend on in-memory ordering accidents

## Acceptance Criteria

The projection layer is good enough for v1 when:

- the same journal and config always produce the same `fabric_objects`
- block slice placement is deterministic and ordered
- accounts and contracts remain spatially stable across normal updates
- district assignment is deterministic and rebuild-safe
- corridor aggregation reduces clutter while preserving major movement patterns
- event effects can be retracted cleanly after reorg
- recent block-local transaction activity is visible without flooding the world with permanent tx objects
- attachment creation is driven by explicit thresholds, not ad hoc judgement
- a full rebuild from Postgres yields the same desired Fabric state as incremental processing

## Implementation Status

- [ ] Block spine projection implemented
- [ ] District assignment implemented
- [ ] Anchor placement implemented
- [ ] Corridor aggregation implemented
- [ ] State surface derivation implemented
- [ ] Event-effect projection implemented
- [ ] Attachment partitioning implemented
- [ ] Full rebuild parity validated
