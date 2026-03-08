import type { DbQuery } from '../shared/types.js'

export type ProjectionConfig = {
	databaseUrl: string
	chainId: bigint
	projectionPollIntervalMs: number
	spineRecentBlockCount: number
	maxTxPulsesPerBlock: number
	spineBlockSpacing: number
	districtSpacing: number
	slotSpacing: number
	topContractLandmarksPerDistrict: number
	projectionVersion: bigint
	districtAlgorithmVersion: bigint
	anchorAlgorithmVersion: bigint
	corridorAlgorithmVersion: bigint
	surfaceAlgorithmVersion: bigint
}

export type ProjectionJob = {
	id: bigint
	chainId: bigint
	fromBlockNumber: bigint
	toBlockNumber: bigint
	status: string
	attemptCount: number
	lastError: string | null
}

export type SpineBlock = {
	blockNumber: bigint
	blockHash: string
	timestamp: Date
	gasUsed: string
	txCount: number
	logCount: number
	finalityState: string
}

export type ProjectedFabricScope = {
	scopeId: string
	chainId: bigint
	name: string
	entryMsfPath: string
	desiredRevision: bigint
	status: string
}

export type ProjectedFabricAttachment = {
	scopeId: string
	objectId: string
	childScopeId: string
	resourceReference: string
	desiredRevision: bigint
}

export type ProjectedFabricEntrypoint = {
	scopeId: string
	entrypointId: string
	name: string
	rootObjectId: string
	desiredRevision: bigint
}

export type ProjectedFabricObject = {
	scopeId: string
	objectId: string
	entrypointId: string
	parentObjectId: string
	entityId: string | null
	classId: number
	type: number
	subtype: number
	name: string
	transformJson: Record<string, unknown>
	boundJson: Record<string, unknown> | null
	resourceReference: string | null
	resourceName: string | null
	metadataJson: Record<string, unknown>
	deleted: boolean
	desiredRevision: bigint
	updatedAtBlock: bigint
}

export type ProjectedFabricState = {
	scope: ProjectedFabricScope | null
	entrypoints: ProjectedFabricEntrypoint[]
	objects: ProjectedFabricObject[]
	childScopes?: ProjectedFabricScope[]
	attachments?: ProjectedFabricAttachment[]
}

export type DistrictAtlasEntity = {
	address: string
	isContract: boolean
	lastSeenBlock: bigint
	familyLabel: string | null
}

export type DistrictRow = {
	chainId: bigint
	districtId: string
	districtKey: string
	originX: number
	originY: number
	originZ: number
	entityCount: number
	contractCount: number
	accountCount: number
	activityWindow32: number
	projectionVersion: bigint
	updatedAtBlock: bigint
}

export type DistrictMembershipRow = {
	chainId: bigint
	entityId: string
	entityKind: string
	districtId: string
	districtAlgorithmVersion: bigint
	updatedAtBlock: bigint
}

export type EntityAnchorRow = {
	chainId: bigint
	entityId: string
	entityKind: string
	districtId: string
	anchorX: number
	anchorY: number
	anchorZ: number
	slotKey: string
	collisionRank: number
	landmarkRank: number | null
	anchorAlgorithmVersion: bigint
	updatedAtBlock: bigint
}

export type StateSurfaceRow = {
	entityId: string
	surfaceId: string
	surfaceKind: string
	valueJson: string | number | boolean | Record<string, unknown> | null
	unit: string | null
	visualChannel: string
	updatedAtBlock: bigint
}

export type CorridorRow = {
	chainId: bigint
	corridorKey: string
	sourceDistrictId: string
	targetDistrictId: string
	flowClass: string
	tokenClass: string
	windowSize: number
	eventCount: number
	distinctTxCount: number
	totalValueWei: string | null
	tokenTransferCount: number | null
	lastSeenBlock: bigint
	published: boolean
	corridorAlgorithmVersion: bigint
	updatedAtBlock: bigint
}

export type EventEffectLog = {
	blockNumber: bigint
	txHash: string
	logIndex: number
	address: string
	topic0: string | null
	topic1: string | null
	topic2: string | null
	topic3: string | null
	data: string
}

export type AdapterEntityRow = {
	chainId: bigint
	address: string
	adapterId: string
	adapterVersion: number
	protocolId: string
	family: string
	confidence: string
	styleFamily: string
	metadataJson: Record<string, unknown>
	detectedAtBlock: bigint
	updatedAtBlock: bigint
}

export type AdapterEventRow = {
	chainId: bigint
	adapterId: string
	txHash: string
	blockHash: string
	logIndex: number
	targetAddress: string
	eventFamily: string
	payloadJson: Record<string, unknown>
	canonical: boolean
}

export type AdapterHintRow = {
	chainId: bigint
	address: string
	adapterId: string
	hintType: string
	payloadJson: Record<string, unknown>
	updatedAtBlock: bigint
}

export type AdapterSurfaceRow = {
	chainId: bigint
	address: string
	adapterId: string
	surfaceId: string
	surfaceKind: string
	valueJson: string | number | boolean | Record<string, unknown> | null
	unit: string | null
	visualChannel: string
	sourceMode: string
	updatedAtBlock: bigint
}

export type KnownTokenContract = {
	address: string
	entityId: string
	districtId: string | null
	anchorX: number | null
	anchorY: number | null
	anchorZ: number | null
	protocolLabel: string
	familyLabel: string
	activity32: number
	incomingValue32: string
	outgoingValue32: string
	eventCount32: number
	transferVelocity32: number
	totalSupply: string
}

export type KnownCollectionContract = {
	address: string
	entityId: string
	districtId: string | null
	anchorX: number | null
	anchorY: number | null
	anchorZ: number | null
	protocolLabel: string
	familyLabel: string
	activity32: number
	eventCount32: number
	mintActivity32: number
	transferActivity32: number
}

export type KnownMultiTokenContract = {
	address: string
	entityId: string
	districtId: string | null
	anchorX: number | null
	anchorY: number | null
	anchorZ: number | null
	protocolLabel: string
	familyLabel: string
	activity32: number
	eventCount32: number
	batchActivity32: number
	transferActivity32: number
}

export type KnownAmmPoolContract = {
	address: string
	entityId: string
	districtId: string | null
	anchorX: number | null
	anchorY: number | null
	anchorZ: number | null
	protocolLabel: string
	familyLabel: string
	activity32: number
	eventCount32: number
	swapIntensity32: number
	reserve0: string
	reserve1: string
}

export type ProjectionCheckpoint = {
	chainId: bigint
	projectionVersion: bigint
	districtAlgorithmVersion: bigint
	anchorAlgorithmVersion: bigint
	corridorAlgorithmVersion: bigint
	surfaceAlgorithmVersion: bigint
	lastProjectedBlockNumber: bigint
	lastProjectedBlockHash: string
	updatedAt: Date
}

export type ProjectionDb = DbQuery
