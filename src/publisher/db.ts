import type {
	FabricAttachmentRow,
	FabricEntrypointRow,
	FabricObjectRow,
	FabricScopeRow,
	PublicationCheckpointRow,
	PublicationCheckpointStatus,
	PublishableScopeRow,
	PublisherDb,
	ScopeSnapshot,
} from './types.js'

const parseBigInt = (value: unknown, field: string) => {
	if (typeof value === 'bigint') {
		return value
	}

	if (typeof value === 'number' || typeof value === 'string') {
		return BigInt(value)
	}

	throw new Error(`Invalid bigint field: ${field}`)
}

const parseNumber = (value: unknown, field: string) => {
	if (typeof value === 'number') {
		return value
	}

	if (typeof value === 'string') {
		return Number(value)
	}

	throw new Error(`Invalid number field: ${field}`)
}

const parseString = (value: unknown, field: string) => {
	if (typeof value !== 'string') {
		throw new Error(`Invalid string field: ${field}`)
	}

	return value
}

const parseBoolean = (value: unknown, field: string) => {
	if (typeof value !== 'boolean') {
		throw new Error(`Invalid boolean field: ${field}`)
	}

	return value
}

const parseJsonObject = (value: unknown, field: string) => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Invalid object field: ${field}`)
	}

	return Object.fromEntries(
		Object.entries(value),
	)
}

const parseDate = (value: unknown, field: string) => {
	if (value instanceof Date) {
		return value
	}

	if (typeof value === 'string' || typeof value === 'number') {
		return new Date(value)
	}

	throw new Error(`Invalid date field: ${field}`)
}

const parseCheckpointStatus = (value: unknown): PublicationCheckpointStatus => {
	if (value === 'idle' || value === 'running' || value === 'failed' || value === 'degraded') {
		return value
	}

	throw new Error('Invalid publication checkpoint status')
}

const parseScope = (row: Record<string, unknown>): FabricScopeRow => ({
	scopeId: parseString(row.scope_id, 'scope_id'),
	chainId: parseBigInt(row.chain_id, 'chain_id'),
	name: parseString(row.name, 'name'),
	entryMsfPath: parseString(row.entry_msf_path, 'entry_msf_path'),
	desiredRevision: parseBigInt(row.desired_revision, 'desired_revision'),
	publishedRevision: parseBigInt(row.published_revision, 'published_revision'),
	status: parseString(row.status, 'status'),
})

const parseCheckpoint = (row: Record<string, unknown> | undefined | null) => (
	!row || row.scope_id === undefined ?
		null
	: {
			scopeId: parseString(row.scope_id, 'scope_id'),
			lastAttemptedRevision: parseBigInt(row.last_attempted_revision, 'last_attempted_revision'),
			lastPublishedRevision: parseBigInt(row.last_published_revision, 'last_published_revision'),
			status: parseCheckpointStatus(row.checkpoint_status),
			lastError: row.last_error === null || row.last_error === undefined ?
				null
			: parseString(row.last_error, 'last_error'),
			updatedAt: parseDate(row.checkpoint_updated_at, 'checkpoint_updated_at'),
		}
)

const parseEntrypoint = (row: Record<string, unknown>): FabricEntrypointRow => ({
	scopeId: parseString(row.scope_id, 'scope_id'),
	entrypointId: parseString(row.entrypoint_id, 'entrypoint_id'),
	name: parseString(row.name, 'name'),
	rootObjectId: parseString(row.root_object_id, 'root_object_id'),
	desiredRevision: parseBigInt(row.desired_revision, 'desired_revision'),
	publishedRevision: parseBigInt(row.published_revision, 'published_revision'),
})

const parseObject = (row: Record<string, unknown>): FabricObjectRow => ({
	scopeId: parseString(row.scope_id, 'scope_id'),
	objectId: parseString(row.object_id, 'object_id'),
	entrypointId: parseString(row.entrypoint_id, 'entrypoint_id'),
	parentObjectId: parseString(row.parent_object_id, 'parent_object_id'),
	entityId: row.entity_id === null || row.entity_id === undefined ?
		null
	: parseString(row.entity_id, 'entity_id'),
	classId: parseNumber(row.class_id, 'class_id'),
	type: parseNumber(row.type, 'type'),
	subtype: parseNumber(row.subtype, 'subtype'),
	name: parseString(row.name, 'name'),
	transformJson: parseJsonObject(row.transform_json, 'transform_json'),
	boundJson: row.bound_json === null || row.bound_json === undefined ?
		null
	: parseJsonObject(row.bound_json, 'bound_json'),
	resourceReference: row.resource_reference === null || row.resource_reference === undefined ?
		null
	: parseString(row.resource_reference, 'resource_reference'),
	resourceName: row.resource_name === null || row.resource_name === undefined ?
		null
	: parseString(row.resource_name, 'resource_name'),
	metadataJson: parseJsonObject(row.metadata_json, 'metadata_json'),
	deleted: parseBoolean(row.deleted, 'deleted'),
	desiredRevision: parseBigInt(row.desired_revision, 'desired_revision'),
	publishedRevision: parseBigInt(row.published_revision, 'published_revision'),
	updatedAtBlock: parseBigInt(row.updated_at_block, 'updated_at_block'),
})

const parseAttachment = (row: Record<string, unknown>): FabricAttachmentRow => ({
	scopeId: parseString(row.scope_id, 'scope_id'),
	objectId: parseString(row.object_id, 'object_id'),
	childScopeId: parseString(row.child_scope_id, 'child_scope_id'),
	resourceReference: parseString(row.resource_reference, 'resource_reference'),
	desiredRevision: parseBigInt(row.desired_revision, 'desired_revision'),
})

export const listPublishableScopes = async (db: PublisherDb): Promise<PublishableScopeRow[]> => {
	const result = await db.query(
		`
			select
				s.scope_id,
				s.chain_id,
				s.name,
				s.entry_msf_path,
				s.desired_revision,
				s.published_revision,
				s.status,
				c.scope_id as checkpoint_scope_id,
				c.last_attempted_revision,
				c.last_published_revision,
				c.status as checkpoint_status,
				c.last_error,
				c.updated_at as checkpoint_updated_at
			from fabric_scopes s
			left join publication_checkpoints c
				on c.scope_id = s.scope_id
			where s.status = 'active'
			order by s.scope_id asc
		`,
	)

	return result.rows.map((row) => ({
		...parseScope(row),
		checkpoint: row.checkpoint_scope_id === undefined || row.checkpoint_scope_id === null ?
			null
		: parseCheckpoint({
				scope_id: row.checkpoint_scope_id,
				last_attempted_revision: row.last_attempted_revision,
				last_published_revision: row.last_published_revision,
				checkpoint_status: row.checkpoint_status,
				last_error: row.last_error,
				checkpoint_updated_at: row.checkpoint_updated_at,
			}),
	}))
}

export const loadScopeSnapshot = async (db: PublisherDb, scopeId: string): Promise<ScopeSnapshot | null> => {
	const [
		scopeResult,
		entrypointsResult,
		objectsResult,
		attachmentsResult,
		scopeIdsResult,
	] = await Promise.all([
		db.query(
			`
				select
					s.scope_id,
					s.chain_id,
					s.name,
					s.entry_msf_path,
					s.desired_revision,
					s.published_revision,
					s.status,
					c.scope_id as checkpoint_scope_id,
					c.last_attempted_revision,
					c.last_published_revision,
					c.status as checkpoint_status,
					c.last_error,
					c.updated_at as checkpoint_updated_at
				from fabric_scopes s
				left join publication_checkpoints c
					on c.scope_id = s.scope_id
				where s.scope_id = $1
			`,
			[
				scopeId,
			],
		),
		db.query(
			`
				select *
				from fabric_entrypoints
				where scope_id = $1
				order by entrypoint_id asc
			`,
			[
				scopeId,
			],
		),
		db.query(
			`
				select *
				from fabric_objects
				where scope_id = $1
				order by object_id asc
			`,
			[
				scopeId,
			],
		),
		db.query(
			`
				select *
				from fabric_attachments
				where scope_id = $1
				order by object_id asc
			`,
			[
				scopeId,
			],
		),
		db.query(
			`
				select scope_id
				from fabric_scopes
			`,
		),
	])

	const scopeRow = scopeResult.rows[0]

	if (!scopeRow) {
		return null
	}

	return {
		scope: parseScope(scopeRow),
		entrypoints: entrypointsResult.rows.map(parseEntrypoint),
		objects: objectsResult.rows.map(parseObject),
		attachments: attachmentsResult.rows.map(parseAttachment),
		checkpoint: parseCheckpoint({
			scope_id: scopeRow.checkpoint_scope_id,
			last_attempted_revision: scopeRow.last_attempted_revision,
			last_published_revision: scopeRow.last_published_revision,
			checkpoint_status: scopeRow.checkpoint_status,
			last_error: scopeRow.last_error,
			checkpoint_updated_at: scopeRow.checkpoint_updated_at,
		}),
		knownScopeIds: scopeIdsResult.rows.map((row) => (
			parseString(row.scope_id, 'scope_id')
		)),
	}
}

export const upsertPublicationCheckpoint = async (
	db: PublisherDb,
	args: {
		scopeId: string
		lastAttemptedRevision: bigint
		lastPublishedRevision: bigint
		status: PublicationCheckpointStatus
		lastError: string | null
	},
) => {
	await db.query(
		`
			insert into publication_checkpoints (
				scope_id,
				last_attempted_revision,
				last_published_revision,
				status,
				last_error,
				updated_at
			)
			values ($1, $2, $3, $4, $5, now())
			on conflict (scope_id) do update
			set
				last_attempted_revision = excluded.last_attempted_revision,
				last_published_revision = excluded.last_published_revision,
				status = excluded.status,
				last_error = excluded.last_error,
				updated_at = now()
		`,
		[
			args.scopeId,
			args.lastAttemptedRevision.toString(),
			args.lastPublishedRevision.toString(),
			args.status,
			args.lastError,
		],
	)
}

export const markScopePublished = async (
	db: PublisherDb,
	args: {
		scopeId: string
		desiredRevision: bigint
	},
) => {
	await Promise.all([
		db.query(
			`
				update fabric_scopes
				set published_revision = $2
				where scope_id = $1
			`,
			[
				args.scopeId,
				args.desiredRevision.toString(),
			],
		),
		db.query(
			`
				update fabric_entrypoints
				set published_revision = desired_revision
				where scope_id = $1
			`,
			[
				args.scopeId,
			],
		),
		db.query(
			`
				update fabric_objects
				set published_revision = desired_revision
				where scope_id = $1
			`,
			[
				args.scopeId,
			],
		),
		upsertPublicationCheckpoint(db, {
			scopeId: args.scopeId,
			lastAttemptedRevision: args.desiredRevision,
			lastPublishedRevision: args.desiredRevision,
			status: 'idle',
			lastError: null,
		}),
	])
}
