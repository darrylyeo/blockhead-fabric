import type { DbQuery } from '../shared/types.js'

export type PublisherConfig = {
	databaseUrl: string
	fabricUrl: string
	fabricAdminKey?: string
	publisherPollIntervalMs: number
	publisherConnectTimeoutMs: number
	publisherScopeConcurrency: number
	publisherObjectBatchSize: number
}

export type PublicationCheckpointStatus =
	| 'idle'
	| 'running'
	| 'failed'
	| 'degraded'

export type FabricScopeRow = {
	scopeId: string
	chainId: bigint
	name: string
	entryMsfPath: string
	desiredRevision: bigint
	publishedRevision: bigint
	status: string
}

export type FabricEntrypointRow = {
	scopeId: string
	entrypointId: string
	name: string
	rootObjectId: string
	desiredRevision: bigint
	publishedRevision: bigint
}

export type FabricObjectRow = {
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
	publishedRevision: bigint
	updatedAtBlock: bigint
}

export type FabricAttachmentRow = {
	scopeId: string
	objectId: string
	childScopeId: string
	resourceReference: string
	desiredRevision: bigint
}

export type PublicationCheckpointRow = {
	scopeId: string
	lastAttemptedRevision: bigint
	lastPublishedRevision: bigint
	status: PublicationCheckpointStatus
	lastError: string | null
	updatedAt: Date
}

export type PublishableScopeRow = FabricScopeRow & {
	checkpoint: PublicationCheckpointRow | null
}

export type ScopeSnapshot = {
	scope: FabricScopeRow
	entrypoints: FabricEntrypointRow[]
	objects: FabricObjectRow[]
	attachments: FabricAttachmentRow[]
	checkpoint: PublicationCheckpointRow | null
	knownScopeIds: string[]
}

export type ConnectRootResult = {
	scopeId: string
	rootObjectId: string
}

export type FabricObject = {
	objectId: string
	parentObjectId: string | null
	name: string
	classId: number
	type: number
	subtype: number
	resourceReference: string | null
	resourceName: string | null
	transform: Record<string, unknown>
	bounds: Record<string, unknown> | null
}

export type RemoteScopeState = {
	scopeId: string
	rootObjectId: string
	rootObject: FabricObject | null
	rootChildren: FabricObject[]
	managedObjects: FabricObject[]
}

export type CreateObjectArgs = {
	scopeId: string
	parentId: string
	objectId: string
	name: string
	classId: number
	type: number
	subtype: number
	resourceReference?: string | null
	resourceName?: string | null
	transform?: Record<string, unknown>
	bounds?: Record<string, unknown> | null
}

export type UpdateObjectArgs = CreateObjectArgs

export type MoveObjectArgs = {
	scopeId: string
	objectId: string
	parentId: string
}

export type DesiredObject = FabricObjectRow & {
	resourceReference: string | null
}

export type ObjectMutation = {
	objectId: string
	parentId: string
	name: string
	classId: number
	type: number
	subtype: number
	resourceReference: string | null
	resourceName: string | null
	transform: Record<string, unknown>
	bounds: Record<string, unknown> | null
}

export type MoveMutation = {
	objectId: string
	parentId: string
}

export type DeleteMutation = {
	objectId: string
}

export type MutationPlan = {
	creates: ObjectMutation[]
	updates: ObjectMutation[]
	attachmentUpdates: ObjectMutation[]
	moves: MoveMutation[]
	deletes: DeleteMutation[]
}

export type FabricClient = {
	connectRoot(args: {
		fabricUrl: string
		adminKey?: string
		timeoutMs?: number
	}): Promise<ConnectRootResult>
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

export type PublisherDb = DbQuery
