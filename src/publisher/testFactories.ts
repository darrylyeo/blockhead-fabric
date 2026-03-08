import type {
	FabricAttachmentRow,
	FabricClient,
	FabricEntrypointRow,
	FabricObject,
	FabricObjectRow,
	FabricScopeRow,
	PublicationCheckpointRow,
	PublisherConfig,
	RemoteScopeState,
	ScopeSnapshot,
} from './types.js'

export const createPublisherConfig = (overrides: Partial<PublisherConfig> = {}): PublisherConfig => ({
	databaseUrl: 'postgres://blockhead:blockhead@localhost:5432/blockhead',
	fabricUrl: 'http://localhost:2000/fabric',
	publisherPollIntervalMs: 2000,
	publisherConnectTimeoutMs: 60000,
	publisherScopeConcurrency: 1,
	publisherObjectBatchSize: 50,
	...overrides,
})

export const createFabricScopeRow = (overrides: Partial<FabricScopeRow> = {}): FabricScopeRow => ({
	scopeId: 'scope_eth_mainnet',
	chainId: 1n,
	name: 'Ethereum Mainnet',
	entryMsfPath: '/fabric/70/1/',
	desiredRevision: 7n,
	publishedRevision: 6n,
	status: 'active',
	...overrides,
})

export const createPublicationCheckpointRow = (overrides: Partial<PublicationCheckpointRow> = {}): PublicationCheckpointRow => ({
	scopeId: 'scope_eth_mainnet',
	lastAttemptedRevision: 6n,
	lastPublishedRevision: 6n,
	status: 'idle',
	lastError: null,
	updatedAt: new Date('2026-03-07T00:00:00.000Z'),
	...overrides,
})

export const createFabricEntrypointRow = (overrides: Partial<FabricEntrypointRow> = {}): FabricEntrypointRow => ({
	scopeId: 'scope_eth_mainnet',
	entrypointId: 'entry_latest_spine',
	name: 'Latest Spine',
	rootObjectId: 'entry_latest_spine',
	desiredRevision: 7n,
	publishedRevision: 6n,
	...overrides,
})

export const createFabricObjectRow = (overrides: Partial<FabricObjectRow> = {}): FabricObjectRow => ({
	scopeId: 'scope_eth_mainnet',
	objectId: 'entry_latest_spine',
	entrypointId: 'entry_latest_spine',
	parentObjectId: 'root',
	entityId: null,
	classId: 72,
	type: 0,
	subtype: 0,
	name: 'Latest Spine',
	transformJson: {},
	boundJson: null,
	resourceReference: null,
	resourceName: null,
	metadataJson: {},
	deleted: false,
	desiredRevision: 7n,
	publishedRevision: 6n,
	updatedAtBlock: 100n,
	...overrides,
})

export const createFabricAttachmentRow = (overrides: Partial<FabricAttachmentRow> = {}): FabricAttachmentRow => ({
	scopeId: 'scope_eth_mainnet',
	objectId: 'attachment_1',
	childScopeId: 'scope_child',
	resourceReference: '/fabric/73/99/',
	desiredRevision: 7n,
	...overrides,
})

export const createRemoteObject = (overrides: Partial<FabricObject> = {}): FabricObject => ({
	objectId: 'entry_latest_spine',
	parentObjectId: '70:1',
	name: 'Latest Spine',
	classId: 72,
	type: 0,
	subtype: 0,
	resourceReference: null,
	resourceName: null,
	transform: {},
	bounds: null,
	...overrides,
})

export const createRemoteScopeState = (overrides: Partial<RemoteScopeState> = {}): RemoteScopeState => ({
	scopeId: 'root',
	rootObjectId: '70:1',
	rootObject: createRemoteObject({
		objectId: '70:1',
		parentObjectId: null,
		classId: 70,
		name: 'Root',
	}),
	rootChildren: [
		createRemoteObject(),
	],
	managedObjects: [
		createRemoteObject(),
	],
	...overrides,
})

export const createScopeSnapshot = (overrides: Partial<ScopeSnapshot> = {}): ScopeSnapshot => ({
	scope: createFabricScopeRow(),
	entrypoints: [
		createFabricEntrypointRow(),
	],
	objects: [
		createFabricObjectRow(),
	],
	attachments: [],
	checkpoint: createPublicationCheckpointRow(),
	knownScopeIds: [
		'scope_eth_mainnet',
		'scope_child',
	],
	...overrides,
})

export const createMockFabricClient = (overrides: Partial<FabricClient> = {}): FabricClient => ({
	connectRoot: async () => ({
		scopeId: 'root',
		rootObjectId: '70:1',
	}),
	listObjects: async () => ([]),
	getObject: async () => (null),
	createObject: async (args) => (
		createRemoteObject({
			objectId: args.objectId,
			parentObjectId: args.parentId,
			name: args.name,
			classId: args.classId,
			type: args.type,
			subtype: args.subtype,
			resourceReference: args.resourceReference ?? null,
			resourceName: args.resourceName ?? null,
			transform: args.transform ?? {},
			bounds: args.bounds ?? null,
		})
	),
	updateObject: async (args) => (
		createRemoteObject({
			objectId: args.objectId,
			parentObjectId: args.parentId,
			name: args.name,
			classId: args.classId,
			type: args.type,
			subtype: args.subtype,
			resourceReference: args.resourceReference ?? null,
			resourceName: args.resourceName ?? null,
			transform: args.transform ?? {},
			bounds: args.bounds ?? null,
		})
	),
	moveObject: async (args) => (
		createRemoteObject({
			objectId: args.objectId,
			parentObjectId: args.parentId,
		})
	),
	deleteObject: async () => {},
	...overrides,
})
