# Blockhead Fabric Server Integration Contract

## Goal

Define the exact integration boundary between the `publication-service` and the upstream Fabric server.

This spec answers:

- which upstream surface we target in v1
- how the publisher authenticates and discovers the world
- how generic desired-state mutations map onto upstream class-specific actions
- which parts of the blockhead scene contract fit the current server cleanly
- which parts require an adapter, sidecar metadata, or future fork

This spec is derived from:

- `008-publisher-implementation-plan.md`
- current upstream docs and source for `MSF_Map_Svc`
- current upstream docs for `MSF_Map_Db`
- current Voltaire and EIP-1193 docs

## Research Basis

The main online sources used for this spec:

- `https://raw.githubusercontent.com/MetaversalCorp/MSF_Map_Svc/master/README.md`
- `https://raw.githubusercontent.com/MetaversalCorp/MSF_Map_Svc/master/svc/mapbase.js`
- `https://raw.githubusercontent.com/MetaversalCorp/MSF_Map_Svc/master/svc/handler.json`
- `https://raw.githubusercontent.com/MetaversalCorp/MSF_Map_Svc/master/svc/Handlers/RMRoot.js`
- `https://raw.githubusercontent.com/MetaversalCorp/MSF_Map_Svc/master/svc/Handlers/RMCObject.js`
- `https://raw.githubusercontent.com/MetaversalCorp/MSF_Map_Svc/master/svc/Handlers/RMTObject.js`
- `https://raw.githubusercontent.com/MetaversalCorp/MSF_Map_Svc/master/svc/Handlers/RMPObject.js`
- `https://raw.githubusercontent.com/MetaversalCorp/MSF_Map_Svc/master/svc/utils.js`
- `https://raw.githubusercontent.com/MetaversalCorp/MSF_Map_Db/master/README.md`
- `https://omb.wiki/en/MSF_Map_Db/Core-Concepts`
- `https://omb.wiki/en/MSF_Map_Db/Event-System`
- `https://omb.wiki/en/MSF_Map_Db/RMRoot`
- `https://omb.wiki/en/MSF_Map_Db/RMPObject`
- `https://voltaire.tevm.sh/primitives/block-stream`
- `https://voltaire.tevm.sh/examples/indexing/blockstream-indexer?search=blockstream`
- `https://voltaire.tevm.sh/jsonrpc-provider/getting-started`
- `https://eips.ethereum.org/EIPS/eip-1193`

## Main Conclusion

The current upstream Fabric stack is viable as a **publication target** for v1, but not as a complete blockhead-native source of truth.

Reason:

- it exposes a working read/write object surface
- it already publishes `.msf` descriptors
- it already pushes live change events
- it models the same root/container/place/physical hierarchy we want

But:

- the mutation API is class-specific and transport-specific
- remote identity is numeric and server-assigned
- arbitrary blockhead metadata is not part of the core mutable object surface
- some mutations are only exposed for specific classes

So v1 should use a **project-owned Fabric adapter** in front of `MSF_Map_Svc`, not call the server ad hoc from the publisher core.

## Upstream Reality

### Public server shape

From the current upstream README and source:

- `MSF_Map_Svc` exposes both `REST` and `Socket.IO`
- `.msf` descriptors are served from `/fabric/` and `/fabric/:class/:objectIx/`
- the server is backed by `MSF_Map_Db`
- object reads and writes ultimately go through `get_*` and `set_*` procedures

### Event model

`MSF_Map_Db` documents an event-driven sync model:

- every write generates an `RMEvent`
- events are ordered
- clients subscribe selectively
- clients should update idempotently

This matters because it means the publisher should mutate state through the sanctioned object APIs rather than writing into MySQL tables directly.

### Local dev target status

The local `spatial-fabric-service` remains a valid dev target.

Current observed behavior:

- server starts on `http://localhost:2000`
- `.msf` is served from `/fabric/`
- login and object update actions are visible in runtime logs
- the server is tightly coupled to DB procedures and event ETL

That reinforces the earlier decision:

- keep blockchain ingest/projection in Postgres outside the upstream server
- use the upstream server only as the published world target

## Chosen V1 Transport

Use:

- `.msf` HTTP routes for discovery and attachment URLs
- `Socket.IO` actions for reads and writes

Do not rely on:

- undocumented direct SQL writes
- undocumented stored procedure calls from blockhead code
- REST mutation routes whose exact shape is less explicit than the handler action surface

Reason:

- the upstream handler source makes the `Socket.IO` action names concrete
- the runtime logs show those actions in use
- the upstream event/subscription model is Socket.IO-native

## Discovery Contract

### Root descriptor

The current server exposes:

- `GET /fabric/`
- `GET /fabric/:class/:objectIx/`

The generated descriptor contains:

- `sRequire`
- `sNamespace`
- `sService`
- `sConnect`
- `bAuth`
- `sRootUrl`
- `wClass`
- `twObjectIx`

### Important rule

Do **not** assume bare `/fabric/` points at the blockhead world root we want.

Current upstream source hardcodes `/fabric/` to one specific object.

For blockhead-managed deep links and attachments, always publish explicit paths:

```text
/fabric/<remoteClass>/<remoteObjectIx>/
```

## Auth And Session Contract

### Login action

Current upstream source uses a simple login action:

```text
login
  acToken64U_RP1
```

The current local server logs show this action being used.

### V1 auth rule

The adapter must:

1. open the Socket.IO connection described by `.msf`
2. send `login`
3. pass the configured admin token
4. wait for success before any read or write action

### Important nuance

The `.msf` descriptor currently emits `bAuth: false`.

Do **not** interpret that as "no login action exists".

For blockhead publication, treat login as required whenever the server configuration provides a key.

## Core Upstream Object Model

The upstream class model matches our scene model well:

- `70` = `RMRoot`
- `71` = `RMCObject`
- `72` = `RMTObject`
- `73` = `RMPObject`

This aligns with:

- `003-scene-protocol.md`
- `MSF_Map_Db` root/container/place/physical hierarchy

## Read Contract

### Generic read shape

The upstream handlers expose `update` reads for:

- `RMRoot:update`
- `RMCObject:update`
- `RMTObject:update`
- `RMPObject:update`

Those reads are enough to support:

- root discovery
- subtree discovery
- remote child enumeration
- remote state comparison before diffing

### Subscription surface

The upstream base handler exposes:

- `subscribe`
- `unsubscribe`

The publisher does not need continuous subscriptions in v1.

Rule:

- the publisher is poll-and-reconcile driven from Postgres
- live subscriptions remain client-facing behavior, not publisher control flow

## Write Contract

### Root cause

The upstream server does not expose one generic `createObject()` or `deleteObject()` API.

Instead, creation and deletion are parent-class and child-class specific.

### Generic adapter API

Blockhead should standardize on this internal adapter contract:

```ts
type FabricAdapter = {
	connect(): Promise<void>
	getDescriptor(args: {
		classId: number
		objectIx: bigint
	}): Promise<FabricDescriptor>
	readObject(args: {
		classId: number
		objectIx: bigint
	}): Promise<RemoteObjectTree>
	createChild(args: {
		parentClassId: number
		parentObjectIx: bigint
		childClassId: number
		stableObjectId: string
		type: number
		subtype: number
		resourceName: string | null
		resourceReference: string | null
		transform: FabricTransform
		bound: FabricBound | null
	}): Promise<{
		classId: number
		objectIx: bigint
	}>
	updateName(args: {
		classId: number
		objectIx: bigint
		stableObjectId: string
	}): Promise<void>
	updateType(args: {
		classId: number
		objectIx: bigint
		type: number
		subtype: number
	}): Promise<void>
	updateTransform(args: {
		classId: number
		objectIx: bigint
		transform: FabricTransform
	}): Promise<void>
	updateBound(args: {
		classId: number
		objectIx: bigint
		bound: FabricBound
	}): Promise<void>
	updateResource(args: {
		classId: number
		objectIx: bigint
		resourceName: string | null
		resourceReference: string | null
	}): Promise<void>
	movePhysicalObject(args: {
		objectIx: bigint
		parentClassId: number
		parentObjectIx: bigint
	}): Promise<void>
	deleteChild(args: {
		parentClassId: number
		parentObjectIx: bigint
		childClassId: number
		childObjectIx: bigint
		deleteAll: boolean
	}): Promise<void>
	readInfo(args: {
		classId: number
		objectIx: bigint
	}): Promise<string | null>
}
```

This contract is blockhead-owned.

The upstream server is one implementation of it.

## Create Matrix

The adapter must map generic creates onto the upstream open actions.

### Allowed parent/child pairs

Per current upstream docs and handlers:

- `RMRoot -> RMCObject`
- `RMRoot -> RMTObject`
- `RMRoot -> RMPObject`
- `RMCObject -> RMCObject`
- `RMCObject -> RMTObject`
- `RMTObject -> RMTObject`
- `RMTObject -> RMPObject`
- `RMPObject -> RMPObject`

### Create mapping table

```text
70 -> 71  => RMRoot:rmcobject_open
70 -> 72  => RMRoot:rmtobject_open
70 -> 73  => RMRoot:rmpobject_open
71 -> 71  => RMCObject:rmcobject_open
71 -> 72  => RMCObject:rmtobject_open
72 -> 72  => RMTObject:rmtobject_open
72 -> 73  => RMTObject:rmpobject_open
73 -> 73  => RMPObject:rmpobject_open
```

If the publisher asks for any other pair, that is a planning bug, not a runtime surprise.

## Update Mapping

### Supported property mutations

Current upstream handlers expose these stable mutation families:

- `*:name`
- `*:type`
- `*:transform`
- `*:bound`
- `*:resource`
- `*:owner`

Class-specific additions:

- `RMCObject:orbit_spin`
- `RMCObject:properties`
- `RMTObject:properties`

Blockhead v1 only relies on:

- `name`
- `type`
- `transform`
- `bound`
- `resource`

### Name rule

Use the upstream `Name_*` field as the **stable machine identity**, not as the friendly label.

Set it to:

- the blockhead `object_id`

Reason:

- the upstream server is indexed by numeric object IDs
- publisher reconciliation needs a stable remote-discoverable string
- there is no separate first-class immutable semantic ID field

This intentionally prioritizes deterministic sync over human-readable upstream names.

## Delete Mapping

Deletes are also parent-class and child-class specific.

### Delete mapping table

```text
70 -> 71  => RMRoot:rmcobject_close
70 -> 72  => RMRoot:rmtobject_close
70 -> 73  => RMRoot:rmpobject_close
71 -> 71  => RMCObject:rmcobject_close
71 -> 72  => RMCObject:rmtobject_close
72 -> 72  => RMTObject:rmtobject_close
72 -> 73  => RMTObject:rmpobject_close
73 -> 73  => RMPObject:rmpobject_close
```

Use:

- `bDeleteAll = true` only when removing an entire obsolete subtree
- `bDeleteAll = false` only when the subtree has already been drained

## Move Contract

### Important finding

The current upstream handlers clearly expose:

- `RMPObject:parent`

They do **not** clearly expose equivalent parent-reassignment actions for:

- `RMCObject`
- `RMTObject`

### V1 move rule

Treat moves as:

- supported for `RMPObject`
- unsupported as an in-place mutation for `RMCObject`
- unsupported as an in-place mutation for `RMTObject`

### Consequence

The publisher must follow these rules:

- `RMCObject` and `RMTObject` parents should be stable by design
- if one of those objects must change parent, use delete + recreate
- only use in-place move for `RMPObject`

This fits the current blockhead projection plan, where major structural containers are intended to remain stable.

## Remote Identity Contract

### Root cause

Blockhead desired state is keyed by semantic `object_id`.

The upstream server is keyed by:

- `wClass`
- `twObjectIx`

where `twObjectIx` is assigned remotely.

### Required adapter invariant

The adapter must always be able to resolve:

```text
(scope_id, object_id)
  -> (remote_class_id, remote_object_ix)
```

### V1 resolution strategy

Use this order:

1. discover the managed subtree from the remote root
2. match remote objects by `Name_* == object_id`
3. cache the numeric identity in memory for the current reconcile round

### Durable mapping

The publisher should eventually persist this binding in Postgres.

Recommended future table:

```text
fabric_remote_bindings
- scope_id text not null
- object_id text not null
- remote_class_id integer not null
- remote_object_ix bigint not null
- last_seen_revision bigint not null
- last_seen_at timestamptz not null
primary key (scope_id, object_id)
unique (scope_id, remote_class_id, remote_object_ix)
```

V1 can start without this table if subtree discovery is fast enough.

## Metadata Contract

### Important mismatch

The upstream core object model documents fields for:

- name
- type
- resource
- transform
- bound
- owner

It does **not** document a first-class mutable `metadata_json` field.

### Sidecar metadata path

Current upstream handlers expose:

- `RMCObject:info`
- `RMTObject:info`
- `RMPObject:info`

And the current server source reads that info from server-side JSON files.

### V1 metadata rule

Treat blockhead metadata as a **sidecar channel**, not part of the core object mutation path.

Priority order:

1. publish hierarchy, transforms, bounds, and resources through upstream object actions
2. publish rich blockhead metadata through info sidecars when configured
3. if info sidecars are unavailable, keep the world navigable and metadata-light

### Consequence for client contract

For the current upstream target:

- base Fabric clients can rely on hierarchy and live object updates
- rich blockchain metadata is adapter-dependent
- if we need strong metadata guarantees everywhere, we will need either a sidecar writer or an upstream fork

### V1 metadata sidecar strategy (chosen)

- **Publish**: hierarchy, name, type, transform, bound, resource only via upstream object actions. Do not write `*:info` sidecars in v1.
- **Store**: full `metadata_json` in desired state (Postgres); use for projection and future publication paths.
- **Expose**: when the target supports info sidecars or after an upstream fork, add an optional info-sidecar write path; until then, keep the world navigable and metadata-light per the spec priority order.

## Attachment Contract

### Attachment encoding

Our scene protocol may use attachment points as `RMPObject` subtype `255` in compatibility modes that expect it.

That still fits the upstream model because:

- `RMPObject` supports resource reference mutation
- `.msf` descriptors can point at explicit class/object paths

### V1 attachment rule

For an attachment object:

- publish as class `73`
- set subtype `255` only when the chosen target/client compatibility mode expects that convention
- set `resourceReference` to explicit `/fabric/<class>/<objectIx>/`

### Child scope rule

Because bare `/fabric/` is ambiguous, every attachment must reference the explicit child object descriptor URL.

## Capability Profile

The adapter should expose an explicit capability profile on startup.

### Required v1 capabilities

- `descriptor_routes = true`
- `socket_login = true`
- `socket_read_update = true`
- `create_delete_matrix = true`
- `update_name = true`
- `update_type = true`
- `update_transform = true`
- `update_bound = true`
- `update_resource = true`

### Optional v1 capabilities

- `move_rmpobject = true`
- `info_sidecar_read = true`
- `info_sidecar_write = environment-specific`
- `rest_mutation = unknown`

### Hard fail conditions

Do not run the publisher if:

- `.msf` descriptor fetch fails
- socket login fails
- root update read fails
- required create/delete action family is unavailable

## Why This Still Fits The Earlier Specs

This contract preserves the current architecture:

- Voltaire `BlockStream` still owns chain ingest
- Postgres still owns canonical truth and desired Fabric state
- publisher still diffs Postgres desired state against remote Fabric state
- the upstream Fabric server still remains an external world-serving target

What changes here is only the concrete adapter boundary:

- no fake generic upstream CRUD
- explicit mapping from generic publisher intent to upstream action families
- explicit recognition that metadata is not a first-class upstream mutable field

## Online Research Notes For Ethereum Side

The online docs continue to support the ingest decisions already made:

- EIP-1193 remains the minimal provider standard centered on `request()`
- Voltaire accepts standard EIP-1193 providers
- Voltaire `BlockStream.watch()` is polling-based
- `BlockStream` supports `include: 'receipts'`
- `BlockStream` emits `blocks` and `reorg` events
- finality remains consumer-managed rather than built into `BlockStream`

That means nothing in this Fabric integration contract changes the ingest plan.

## Acceptance Criteria

This spec is good enough for implementation when:

- the chosen upstream transport is explicit
- the `.msf` discovery routes are defined
- auth/login behavior is defined
- the create/delete parent-child matrix is defined
- the move limitation for `RMCObject` and `RMTObject` is explicit
- the numeric remote identity problem is explicitly addressed
- the metadata mismatch is explicitly addressed
- attachment URL rules are explicit
- the adapter capability profile is explicit

## Implementation Status

- [x] Project-owned `FabricAdapter` interface added
- [x] Socket.IO implementation for `MSF_Map_Svc` added
- [x] Explicit create/delete matrix encoded in adapter
- [x] Remote subtree discovery implemented
- [x] Stable `object_id -> remote numeric id` resolution implemented
- [x] `RMPObject` move path implemented
- [x] Metadata sidecar strategy chosen
- [x] Capability probe implemented
- [x] `fabric_remote_bindings` table and persist/read path implemented
