import type { DbQuery } from '../shared/types.js'

import type {
	AdapterEntityRow,
	AdapterEventRow,
	AdapterHintRow,
	AdapterSurfaceRow,
	CorridorRow,
	DistrictAtlasEntity,
	DistrictMembershipRow,
	DistrictRow,
	EntityAnchorRow,
	EventEffectLog,
	KnownAmmPoolContract,
	KnownCollectionContract,
	KnownMultiTokenContract,
	KnownTokenContract,
	ProjectedFabricAttachment,
	ProjectedFabricEntrypoint,
	ProjectedFabricObject,
	ProjectedFabricScope,
	ProjectedFabricState,
	ProjectionCheckpoint,
	ProjectionConfig,
	ProjectionDb,
	ProjectionJob,
	SpineBlock,
	StateSurfaceRow,
} from './types.js'
import { __private__ as ammAdapterPrivate } from './ammAdapter.js'

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

const parseNullableNumber = (value: unknown, field: string) => (
	value === null || value === undefined ?
		null
	:
		parseNumber(value, field)
)

const parseString = (value: unknown, field: string) => {
	if (typeof value !== 'string') {
		throw new Error(`Invalid string field: ${field}`)
	}

	return value
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

const parseProjectionJob = (row: Record<string, unknown>): ProjectionJob => ({
	id: parseBigInt(row.id, 'id'),
	chainId: parseBigInt(row.chain_id, 'chain_id'),
	fromBlockNumber: parseBigInt(row.from_block_number, 'from_block_number'),
	toBlockNumber: parseBigInt(row.to_block_number, 'to_block_number'),
	status: parseString(row.status, 'status'),
	attemptCount: parseNumber(row.attempt_count, 'attempt_count'),
	lastError: row.last_error === null || row.last_error === undefined ?
		null
	:
		parseString(row.last_error, 'last_error'),
})

const parseSpineBlock = (row: Record<string, unknown>): SpineBlock => ({
	blockNumber: parseBigInt(row.block_number, 'block_number'),
	blockHash: parseString(row.block_hash, 'block_hash'),
	timestamp: parseDate(row.timestamp, 'timestamp'),
	gasUsed: parseString(row.gas_used, 'gas_used'),
	txCount: parseNumber(row.tx_count, 'tx_count'),
	logCount: parseNumber(row.log_count, 'log_count'),
	finalityState: parseString(row.finality_state, 'finality_state'),
})

export const claimNextProjectionJob = async (db: ProjectionDb, chainId: bigint) => {
	const { rows } = await db.query(
		`
			select *
			from projection_jobs
			where chain_id = $1
				and status = 'pending'
			order by from_block_number asc, id asc
			limit 1
		`,
		[
			chainId.toString(),
		],
	)
	const row = rows[0]

	if (!row) {
		return null
	}

	const job = parseProjectionJob(row)

	await db.query(
		`
			update projection_jobs
			set
				status = 'running',
				attempt_count = attempt_count + 1,
				last_error = null,
				started_at = now()
			where id = $1
		`,
		[
			job.id.toString(),
		],
	)

	return {
		...job,
		status: 'running',
		attemptCount: job.attemptCount + 1,
	}
}

export const completeProjectionJob = async (db: ProjectionDb, jobId: bigint) => {
	await db.query(
		`
			update projection_jobs
			set
				status = 'completed',
				finished_at = now(),
				last_error = null
			where id = $1
		`,
		[
			jobId.toString(),
		],
	)
}

export const failProjectionJob = async (db: ProjectionDb, jobId: bigint, error: string) => {
	await db.query(
		`
			update projection_jobs
			set
				status = 'failed',
				finished_at = now(),
				last_error = $2
			where id = $1
		`,
		[
			jobId.toString(),
			error,
		],
	)
}

export const loadSpineWindow = async (db: ProjectionDb, args: {
	chainId: bigint
	spineRecentBlockCount: number
}) => {
	const { rows } = await db.query(
		`
			select
				block_number,
				block_hash,
				timestamp,
				gas_used::text as gas_used,
				tx_count,
				log_count,
				finality_state
			from blocks
			where chain_id = $1
				and canonical = true
			order by block_number desc
			limit $2
		`,
		[
			args.chainId.toString(),
			args.spineRecentBlockCount,
		],
	)

	return rows
		.map(parseSpineBlock)
		.reverse()
}

export const upsertProjectionCheckpoint = async (db: ProjectionDb, args: {
	config: ProjectionConfig
	headBlock: SpineBlock
}) => {
	await db.query(
		`
			insert into projection_checkpoints (
				chain_id,
				projection_version,
				district_algorithm_version,
				anchor_algorithm_version,
				corridor_algorithm_version,
				surface_algorithm_version,
				last_projected_block_number,
				last_projected_block_hash,
				updated_at
			)
			values ($1, $2, $3, $4, $5, $6, $7, $8, now())
			on conflict (
				chain_id,
				projection_version,
				district_algorithm_version,
				anchor_algorithm_version,
				corridor_algorithm_version,
				surface_algorithm_version
			) do update
			set
				last_projected_block_number = excluded.last_projected_block_number,
				last_projected_block_hash = excluded.last_projected_block_hash,
				updated_at = now()
		`,
		[
			args.config.chainId.toString(),
			args.config.projectionVersion.toString(),
			args.config.districtAlgorithmVersion.toString(),
			args.config.anchorAlgorithmVersion.toString(),
			args.config.corridorAlgorithmVersion.toString(),
			args.config.surfaceAlgorithmVersion.toString(),
			args.headBlock.blockNumber.toString(),
			args.headBlock.blockHash,
		],
	)
}

const upsertFabricScope = async (db: ProjectionDb, scope: ProjectedFabricScope | null) => {
	if (!scope) {
		return
	}

	await db.query(
		`
			insert into fabric_scopes (
				scope_id,
				chain_id,
				name,
				entry_msf_path,
				desired_revision,
				published_revision,
				status
			)
			values ($1, $2, $3, $4, $5, coalesce((select published_revision from fabric_scopes where scope_id = $1), 0), $6)
			on conflict (scope_id) do update
			set
				chain_id = excluded.chain_id,
				name = excluded.name,
				entry_msf_path = excluded.entry_msf_path,
				desired_revision = excluded.desired_revision,
				status = excluded.status
		`,
		[
			scope.scopeId,
			scope.chainId.toString(),
			scope.name,
			scope.entryMsfPath,
			scope.desiredRevision.toString(),
			scope.status,
		],
	)
}

const upsertFabricAttachment = async (db: ProjectionDb, attachment: ProjectedFabricAttachment) => {
	await db.query(
		`
			insert into fabric_attachments (
				scope_id,
				object_id,
				child_scope_id,
				resource_reference,
				desired_revision
			)
			values ($1, $2, $3, $4, $5)
			on conflict (scope_id, object_id) do update
			set
				child_scope_id = excluded.child_scope_id,
				resource_reference = excluded.resource_reference,
				desired_revision = excluded.desired_revision
		`,
		[
			attachment.scopeId,
			attachment.objectId,
			attachment.childScopeId,
			attachment.resourceReference,
			attachment.desiredRevision.toString(),
		],
	)
}

const upsertFabricEntrypoint = async (db: ProjectionDb, entrypoint: ProjectedFabricEntrypoint) => {
	await db.query(
		`
			insert into fabric_entrypoints (
				scope_id,
				entrypoint_id,
				name,
				root_object_id,
				desired_revision,
				published_revision
			)
			values ($1, $2, $3, $4, $5, coalesce((select published_revision from fabric_entrypoints where scope_id = $1 and entrypoint_id = $2), 0))
			on conflict (scope_id, entrypoint_id) do update
			set
				name = excluded.name,
				root_object_id = excluded.root_object_id,
				desired_revision = excluded.desired_revision
		`,
		[
			entrypoint.scopeId,
			entrypoint.entrypointId,
			entrypoint.name,
			entrypoint.rootObjectId,
			entrypoint.desiredRevision.toString(),
		],
	)
}

const upsertFabricObject = async (db: ProjectionDb, object: ProjectedFabricObject) => {
		await db.query(
			`
				insert into fabric_objects (
					scope_id,
					object_id,
					entrypoint_id,
					parent_object_id,
					entity_id,
					class_id,
					type,
					subtype,
					name,
					transform_json,
					bound_json,
					resource_reference,
					resource_name,
					metadata_json,
					deleted,
					desired_revision,
					published_revision,
					updated_at_block
				)
				values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14::jsonb, $15, $16, coalesce((select published_revision from fabric_objects where scope_id = $1 and object_id = $2), 0), $17)
				on conflict (scope_id, object_id) do update
				set
					entrypoint_id = excluded.entrypoint_id,
					parent_object_id = excluded.parent_object_id,
					entity_id = excluded.entity_id,
					class_id = excluded.class_id,
					type = excluded.type,
					subtype = excluded.subtype,
					name = excluded.name,
					transform_json = excluded.transform_json,
					bound_json = excluded.bound_json,
					resource_reference = excluded.resource_reference,
					resource_name = excluded.resource_name,
					metadata_json = excluded.metadata_json,
					deleted = excluded.deleted,
					desired_revision = excluded.desired_revision,
					updated_at_block = excluded.updated_at_block
			`,
			[
				object.scopeId,
				object.objectId,
				object.entrypointId,
				object.parentObjectId,
				object.entityId,
				object.classId,
				object.type,
				object.subtype,
				object.name,
				JSON.stringify(object.transformJson),
				object.boundJson === null ?
					null
				:
					JSON.stringify(object.boundJson),
				object.resourceReference,
				object.resourceName,
				JSON.stringify(object.metadataJson),
				object.deleted,
				object.desiredRevision.toString(),
				object.updatedAtBlock.toString(),
			],
		)
}

const markDeletedFabricObjects = async (db: ProjectionDb, args: {
	scopeId: string
	entrypointId: string
	desiredRevision: bigint
	objectIds: string[]
}) => {
	if (args.objectIds.length === 0) {
		await db.query(
			`
				update fabric_objects
				set
					deleted = true,
					desired_revision = $3,
					updated_at_block = $3
				where scope_id = $1
					and entrypoint_id = $2
			`,
			[
				args.scopeId,
				args.entrypointId,
				args.desiredRevision.toString(),
			],
		)

		return
	}

	await db.query(
		`
			update fabric_objects
			set
				deleted = true,
				desired_revision = $3,
				updated_at_block = $3
			where scope_id = $1
				and entrypoint_id = $2
				and object_id <> all($4)
		`,
		[
			args.scopeId,
			args.entrypointId,
			args.desiredRevision.toString(),
			args.objectIds,
		],
	)
}

export const persistProjectedFabricState = async (db: ProjectionDb, state: ProjectedFabricState) => {
	if (!state.scope) {
		return
	}

	const childScopes = state.childScopes ?? []
	const scopes = [
		state.scope,
		...childScopes,
	]
	const scopeDesiredRevisions = new Map(
		scopes.map((scope) => (
			[
				scope.scopeId,
				scope.desiredRevision,
			]
		)),
	)

	for (const scope of scopes) {
		await upsertFabricScope(db, scope)
	}

	await db.query(
		`
			update fabric_scopes
			set status = 'inactive'
			where chain_id = $1
				and scope_id like $2
				and (
					cardinality($3::text[]) = 0
					or scope_id <> all($3)
				)
		`,
		[
			state.scope.chainId.toString(),
			`scope_attachment_${state.scope.chainId.toString()}_%`,
			childScopes.map(({ scopeId }) => (
				scopeId
			)),
		],
	)

	for (const entrypoint of state.entrypoints) {
		await upsertFabricEntrypoint(db, entrypoint)

		const objects = state.objects.filter((object) => (
			object.entrypointId === entrypoint.entrypointId
			&& object.scopeId === entrypoint.scopeId
		))

		for (const object of objects) {
			await upsertFabricObject(db, object)
		}

		await markDeletedFabricObjects(db, {
			scopeId: entrypoint.scopeId,
			entrypointId: entrypoint.entrypointId,
			desiredRevision: scopeDesiredRevisions.get(entrypoint.scopeId) ?? entrypoint.desiredRevision,
			objectIds: objects.map(({ objectId }) => (
				objectId
			)),
		})
	}

	const attachments = state.attachments ?? []

	for (const attachment of attachments) {
		await upsertFabricAttachment(db, attachment)
	}

	await db.query(
		`
			delete from fabric_attachments
			where scope_id = $1
				and (
					cardinality($2::text[]) = 0
					or object_id <> all($2)
				)
		`,
		[
			state.scope.scopeId,
			attachments.map(({ objectId }) => (
				objectId
			)),
		],
	)
}

export const loadDistrictAtlasEntities = async (db: ProjectionDb, chainId: bigint) => {
	const { rows } = await db.query(
		`
			select
				a.address,
				a.is_contract,
				a.last_seen_block,
				c.family_label
			from accounts a
			left join contracts c
				on c.chain_id = a.chain_id
				and c.address = a.address
			where a.chain_id = $1
			order by a.address asc
		`,
		[
			chainId.toString(),
		],
	)

	return rows.map((row): DistrictAtlasEntity => ({
		address: parseString(row.address, 'address'),
		isContract: row.is_contract === true,
		lastSeenBlock: parseBigInt(row.last_seen_block, 'last_seen_block'),
		familyLabel: row.family_label === null || row.family_label === undefined ?
			null
		:
			parseString(row.family_label, 'family_label'),
	}))
}

export const persistDistrictRows = async (db: ProjectionDb, rows: DistrictRow[]) => {
	for (const row of rows) {
		await db.query(
			`
				insert into districts (
					chain_id,
					district_id,
					district_key,
					origin_x,
					origin_y,
					origin_z,
					entity_count,
					contract_count,
					account_count,
					activity_window_32,
					projection_version,
					updated_at_block
				)
				values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
				on conflict (chain_id, district_id) do update
				set
					district_key = excluded.district_key,
					origin_x = excluded.origin_x,
					origin_y = excluded.origin_y,
					origin_z = excluded.origin_z,
					entity_count = excluded.entity_count,
					contract_count = excluded.contract_count,
					account_count = excluded.account_count,
					activity_window_32 = excluded.activity_window_32,
					projection_version = excluded.projection_version,
					updated_at_block = excluded.updated_at_block
			`,
			[
				row.chainId.toString(),
				row.districtId,
				row.districtKey,
				row.originX,
				row.originY,
				row.originZ,
				row.entityCount,
				row.contractCount,
				row.accountCount,
				row.activityWindow32,
				row.projectionVersion.toString(),
				row.updatedAtBlock.toString(),
			],
		)
	}
}

export const persistDistrictMemberships = async (db: ProjectionDb, rows: DistrictMembershipRow[]) => {
	for (const row of rows) {
		await db.query(
			`
				insert into district_memberships (
					chain_id,
					entity_id,
					entity_kind,
					district_id,
					district_algorithm_version,
					updated_at_block
				)
				values ($1, $2, $3, $4, $5, $6)
				on conflict (chain_id, entity_id) do update
				set
					entity_kind = excluded.entity_kind,
					district_id = excluded.district_id,
					district_algorithm_version = excluded.district_algorithm_version,
					updated_at_block = excluded.updated_at_block
			`,
			[
				row.chainId.toString(),
				row.entityId,
				row.entityKind,
				row.districtId,
				row.districtAlgorithmVersion.toString(),
				row.updatedAtBlock.toString(),
			],
		)
	}
}

export const persistEntityAnchors = async (db: ProjectionDb, rows: EntityAnchorRow[]) => {
	for (const row of rows) {
		await db.query(
			`
				insert into entity_anchors (
					chain_id,
					entity_id,
					entity_kind,
					district_id,
					anchor_x,
					anchor_y,
					anchor_z,
					slot_key,
					collision_rank,
					landmark_rank,
					anchor_algorithm_version,
					updated_at_block
				)
				values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
				on conflict (chain_id, entity_id) do update
				set
					entity_kind = excluded.entity_kind,
					district_id = excluded.district_id,
					anchor_x = excluded.anchor_x,
					anchor_y = excluded.anchor_y,
					anchor_z = excluded.anchor_z,
					slot_key = excluded.slot_key,
					collision_rank = excluded.collision_rank,
					landmark_rank = excluded.landmark_rank,
					anchor_algorithm_version = excluded.anchor_algorithm_version,
					updated_at_block = excluded.updated_at_block
			`,
			[
				row.chainId.toString(),
				row.entityId,
				row.entityKind,
				row.districtId,
				row.anchorX,
				row.anchorY,
				row.anchorZ,
				row.slotKey,
				row.collisionRank,
				row.landmarkRank,
				row.anchorAlgorithmVersion.toString(),
				row.updatedAtBlock.toString(),
			],
		)
	}
}

export const loadKnownErc20SourceContracts = async (db: ProjectionDb, args: {
	chainId: bigint
	addresses: string[]
}) => {
	if (args.addresses.length === 0) {
		return []
	}

	const { rows } = await db.query(
		`
			select address
			from contracts
			where chain_id = $1
				and lower(address) = any($2)
			order by address asc
		`,
		[
			args.chainId.toString(),
			args.addresses,
		],
	)

	return rows.map((row) => ({
		address: parseString(row.address, 'address').toLowerCase(),
	}))
}

export const loadKnownErc20TransferLogs = async (db: ProjectionDb, args: {
	chainId: bigint
	addresses: string[]
	topic0: string
}) => {
	if (args.addresses.length === 0) {
		return []
	}

	const { rows } = await db.query(
		`
			select
				block_number,
				block_hash,
				tx_hash,
				log_index,
				address,
				topic1,
				topic2,
				data
			from logs
			where chain_id = $1
				and canonical = true
				and removed = false
				and topic0 = $2
				and lower(address) = any($3)
			order by block_number asc, log_index asc
		`,
		[
			args.chainId.toString(),
			args.topic0,
			args.addresses,
		],
	)

	return rows.map((row) => ({
		blockNumber: parseBigInt(row.block_number, 'block_number'),
		blockHash: parseString(row.block_hash, 'block_hash'),
		txHash: parseString(row.tx_hash, 'tx_hash'),
		logIndex: parseNumber(row.log_index, 'log_index'),
		address: parseString(row.address, 'address').toLowerCase(),
		topic1: row.topic1 === null || row.topic1 === undefined ?
			null
		:
			parseString(row.topic1, 'topic1'),
		topic2: row.topic2 === null || row.topic2 === undefined ?
			null
		:
			parseString(row.topic2, 'topic2'),
		data: parseString(row.data, 'data'),
	}))
}

export const loadErc721TransferLogs = async (db: ProjectionDb, args: {
	chainId: bigint
	fromBlockNumber: bigint
}) => {
	const { rows } = await db.query(
		`
			select
				block_number,
				block_hash,
				tx_hash,
				log_index,
				address,
				topic1,
				topic2,
				topic3
			from logs
			where chain_id = $1
				and canonical = true
				and removed = false
				and topic0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
				and topic3 is not null
				and block_number >= $2
			order by block_number asc, log_index asc
		`,
		[
			args.chainId.toString(),
			args.fromBlockNumber.toString(),
		],
	)

	return rows.map((row) => ({
		blockNumber: parseBigInt(row.block_number, 'block_number'),
		blockHash: parseString(row.block_hash, 'block_hash'),
		txHash: parseString(row.tx_hash, 'tx_hash'),
		logIndex: parseNumber(row.log_index, 'log_index'),
		address: parseString(row.address, 'address').toLowerCase(),
		topic1: row.topic1 === null || row.topic1 === undefined ?
			null
		:
			parseString(row.topic1, 'topic1'),
		topic2: row.topic2 === null || row.topic2 === undefined ?
			null
		:
			parseString(row.topic2, 'topic2'),
		topic3: row.topic3 === null || row.topic3 === undefined ?
			null
		:
			parseString(row.topic3, 'topic3'),
	}))
}

export const loadErc1155TransferLogs = async (db: ProjectionDb, args: {
	chainId: bigint
	fromBlockNumber: bigint
}) => {
	const { rows } = await db.query(
		`
			select
				block_number,
				block_hash,
				tx_hash,
				log_index,
				address,
				topic0
			from logs
			where chain_id = $1
				and canonical = true
				and removed = false
				and topic0 = any($2)
				and block_number >= $3
			order by block_number asc, log_index asc
		`,
		[
			args.chainId.toString(),
			[
				'0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
				'0x4a39dc06d4c0dbc64b70e4cce6d6a4c41fbd64fd4281c3f1f9a6b20f7c2a2b9b',
			],
			args.fromBlockNumber.toString(),
		],
	)

	return rows.map((row) => ({
		blockNumber: parseBigInt(row.block_number, 'block_number'),
		blockHash: parseString(row.block_hash, 'block_hash'),
		txHash: parseString(row.tx_hash, 'tx_hash'),
		logIndex: parseNumber(row.log_index, 'log_index'),
		address: parseString(row.address, 'address').toLowerCase(),
		topic0: parseString(row.topic0, 'topic0'),
	}))
}

export const loadAmmPoolLogs = async (db: ProjectionDb, args: {
	chainId: bigint
	fromBlockNumber: bigint
}) => {
	const { rows } = await db.query(
		`
			select
				block_number,
				block_hash,
				tx_hash,
				log_index,
				address,
				topic0,
				data
			from logs
			where chain_id = $1
				and canonical = true
				and removed = false
				and topic0 = any($2)
				and block_number >= $3
			order by block_number asc, log_index asc
		`,
		[
			args.chainId.toString(),
			[
				ammAdapterPrivate.swapTopic0,
				ammAdapterPrivate.mintTopic0,
				ammAdapterPrivate.burnTopic0,
				ammAdapterPrivate.syncTopic0,
			],
			args.fromBlockNumber.toString(),
		],
	)

	return rows.map((row) => ({
		blockNumber: parseBigInt(row.block_number, 'block_number'),
		blockHash: parseString(row.block_hash, 'block_hash'),
		txHash: parseString(row.tx_hash, 'tx_hash'),
		logIndex: parseNumber(row.log_index, 'log_index'),
		address: parseString(row.address, 'address').toLowerCase(),
		topic0: parseString(row.topic0, 'topic0'),
		data: parseString(row.data, 'data'),
	}))
}

export const persistAdapterEntities = async (db: ProjectionDb, rows: AdapterEntityRow[], args: {
	chainId: bigint
	adapterId: string
}) => {
	await db.query(
		`
			delete from adapter_entities
			where chain_id = $1
				and adapter_id = $2
				and (
					cardinality($3::text[]) = 0
					or address <> all($3)
				)
		`,
		[
			args.chainId.toString(),
			args.adapterId,
			rows.map(({ address }) => (
				address
			)),
		],
	)

	for (const row of rows) {
		await db.query(
			`
				insert into adapter_entities (
					chain_id,
					address,
					adapter_id,
					adapter_version,
					protocol_id,
					family,
					confidence,
					style_family,
					metadata_json,
					detected_at_block,
					updated_at_block
				)
				values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
				on conflict (chain_id, address, adapter_id) do update
				set
					adapter_version = excluded.adapter_version,
					protocol_id = excluded.protocol_id,
					family = excluded.family,
					confidence = excluded.confidence,
					style_family = excluded.style_family,
					metadata_json = excluded.metadata_json,
					detected_at_block = excluded.detected_at_block,
					updated_at_block = excluded.updated_at_block
			`,
			[
				row.chainId.toString(),
				row.address,
				row.adapterId,
				row.adapterVersion,
				row.protocolId,
				row.family,
				row.confidence,
				row.styleFamily,
				JSON.stringify(row.metadataJson),
				row.detectedAtBlock.toString(),
				row.updatedAtBlock.toString(),
			],
		)
	}
}

export const persistAdapterEvents = async (db: ProjectionDb, rows: AdapterEventRow[], args: {
	chainId: bigint
	adapterId: string
}) => {
	await db.query(
		`
			update adapter_events
			set canonical = false
			where chain_id = $1
				and adapter_id = $2
		`,
		[
			args.chainId.toString(),
			args.adapterId,
		],
	)

	for (const row of rows) {
		await db.query(
			`
				insert into adapter_events (
					chain_id,
					adapter_id,
					tx_hash,
					block_hash,
					log_index,
					target_address,
					event_family,
					payload_json,
					canonical
				)
				values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
				on conflict (chain_id, adapter_id, tx_hash, log_index, block_hash) do update
				set
					target_address = excluded.target_address,
					event_family = excluded.event_family,
					payload_json = excluded.payload_json,
					canonical = excluded.canonical
			`,
			[
				row.chainId.toString(),
				row.adapterId,
				row.txHash,
				row.blockHash,
				row.logIndex,
				row.targetAddress,
				row.eventFamily,
				JSON.stringify(row.payloadJson),
				row.canonical,
			],
		)
	}
}

export const persistAdapterHints = async (db: ProjectionDb, rows: AdapterHintRow[], args: {
	chainId: bigint
	adapterId: string
}) => {
	await db.query(
		`
			delete from adapter_hints
			where chain_id = $1
				and adapter_id = $2
				and (
					cardinality($3::text[]) = 0
					or (address || '|' || hint_type) <> all($3)
				)
		`,
		[
			args.chainId.toString(),
			args.adapterId,
			rows.map(({ address, hintType }) => (
				`${address}|${hintType}`
			)),
		],
	)

	for (const row of rows) {
		await db.query(
			`
				insert into adapter_hints (
					chain_id,
					address,
					adapter_id,
					hint_type,
					payload_json,
					updated_at_block
				)
				values ($1, $2, $3, $4, $5::jsonb, $6)
				on conflict (chain_id, address, adapter_id, hint_type) do update
				set
					payload_json = excluded.payload_json,
					updated_at_block = excluded.updated_at_block
			`,
			[
				row.chainId.toString(),
				row.address,
				row.adapterId,
				row.hintType,
				JSON.stringify(row.payloadJson),
				row.updatedAtBlock.toString(),
			],
		)
	}
}

export const persistAdapterSurfaces = async (db: ProjectionDb, rows: AdapterSurfaceRow[], args?: {
	chainId: bigint
	adapterId: string
	sourceMode: string
	replaceExisting: boolean
}) => {
	if (args?.replaceExisting) {
		await db.query(
			`
				delete from adapter_surfaces
				where chain_id = $1
					and adapter_id = $2
					and source_mode = $3
					and (
						cardinality($4::text[]) = 0
						or (address || '|' || surface_id) <> all($4)
					)
			`,
			[
				args.chainId.toString(),
				args.adapterId,
				args.sourceMode,
				rows.map(({ address, surfaceId }) => (
					`${address}|${surfaceId}`
				)),
			],
		)
	}

	for (const row of rows) {
		await db.query(
			`
				insert into adapter_surfaces (
					chain_id,
					address,
					adapter_id,
					surface_id,
					surface_kind,
					value_json,
					unit,
					visual_channel,
					source_mode,
					updated_at_block
				)
				values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
				on conflict (chain_id, address, adapter_id, surface_id) do update
				set
					surface_kind = excluded.surface_kind,
					value_json = excluded.value_json,
					unit = excluded.unit,
					visual_channel = excluded.visual_channel,
					source_mode = excluded.source_mode,
					updated_at_block = excluded.updated_at_block
			`,
			[
				row.chainId.toString(),
				row.address,
				row.adapterId,
				row.surfaceId,
				row.surfaceKind,
				JSON.stringify(row.valueJson),
				row.unit,
				row.visualChannel,
				row.sourceMode,
				row.updatedAtBlock.toString(),
			],
		)
	}
}

export const loadDueErc20TotalSupplyTargets = async (db: ProjectionDb, args: {
	chainId: bigint
	headBlockNumber: bigint
	minBlocksBetweenReads: bigint
	maxTargetsPerBlock: number
}) => {
	const { rows } = await db.query(
		`
			select ae.address
			from adapter_entities ae
			left join adapter_surfaces asur
				on asur.chain_id = ae.chain_id
				and asur.address = ae.address
				and asur.adapter_id = ae.adapter_id
				and asur.surface_id = 'total_supply'
			where ae.chain_id = $1
				and ae.adapter_id = 'erc20'
				and ae.confidence = 'exact'
				and (
					asur.updated_at_block is null
					or asur.updated_at_block <= $2
				)
			order by ae.address asc
			limit $3
		`,
		[
			args.chainId.toString(),
			(args.headBlockNumber > args.minBlocksBetweenReads ?
				args.headBlockNumber - args.minBlocksBetweenReads
			:
				0n
			).toString(),
			args.maxTargetsPerBlock,
		],
	)

	return rows.map((row) => (
		parseString(row.address, 'address').toLowerCase()
	))
}

export const loadKnownTokenContracts = async (db: ProjectionDb, args: {
	chainId: bigint
	headBlockNumber: bigint
	limitPerDistrict: number
}) => {
	const fromBlockNumber = args.headBlockNumber > 31n ?
		args.headBlockNumber - 31n
	:
		0n
	const { rows } = await db.query(
		`
			with recent_activity as (
				select
					target_address,
					count(*)::int as event_count_32
				from adapter_events
				where chain_id = $1
					and adapter_id = 'erc20'
					and canonical = true
					and event_family = 'transfer'
					and (payload_json->>'blockNumber')::bigint >= $2
				group by target_address
			),
			ranked as (
				select
					ae.address,
					coalesce(dm.entity_id, concat('contract:', ae.chain_id::text, ':', ae.address)) as entity_id,
					dm.district_id,
					ea.anchor_x,
					ea.anchor_y,
					ea.anchor_z,
					(ae.metadata_json->>'protocolLabel') is not null as has_protocol_label,
					coalesce(ae.metadata_json->>'protocolLabel', upper(left(ae.address, 6))) as protocol_label,
					coalesce(ae.metadata_json->>'familyLabel', ae.family) as family_label,
					coalesce(ra.event_count_32, 0) as event_count_32,
					coalesce((velocity_surface.value_json)::text::int, 0) as transfer_velocity_32,
					coalesce(trim('"' from total_supply_surface.value_json::text), '0') as total_supply,
					row_number() over (
						partition by dm.district_id
						order by coalesce(ra.event_count_32, 0) desc, ae.address asc
					) as district_rank
				from adapter_entities ae
				left join district_memberships dm
					on dm.chain_id = ae.chain_id
					and dm.entity_id = concat('contract:', ae.chain_id::text, ':', ae.address)
				left join entity_anchors ea
					on ea.chain_id = dm.chain_id
					and ea.entity_id = dm.entity_id
				left join adapter_surfaces velocity_surface
					on velocity_surface.chain_id = ae.chain_id
					and velocity_surface.address = ae.address
					and velocity_surface.adapter_id = ae.adapter_id
					and velocity_surface.surface_id = 'transfer_velocity_32'
				left join adapter_surfaces total_supply_surface
					on total_supply_surface.chain_id = ae.chain_id
					and total_supply_surface.address = ae.address
					and total_supply_surface.adapter_id = ae.adapter_id
					and total_supply_surface.surface_id = 'total_supply'
				left join recent_activity ra
					on ra.target_address = ae.address
				where ae.chain_id = $1
					and ae.adapter_id = 'erc20'
					and ae.confidence in ('exact', 'high')
			)
			select
				address,
				entity_id,
				district_id,
				anchor_x,
				anchor_y,
				anchor_z,
				has_protocol_label,
				protocol_label,
				family_label,
				event_count_32,
				transfer_velocity_32,
				total_supply
			from ranked
			where has_protocol_label
				or district_id is null
				or district_rank <= $3
			order by event_count_32 desc, address asc
		`,
		[
			args.chainId.toString(),
			fromBlockNumber.toString(),
			args.limitPerDistrict,
		],
	)

	return rows.map((row): KnownTokenContract => ({
		address: parseString(row.address, 'address'),
		entityId: parseString(row.entity_id, 'entity_id'),
		districtId: row.district_id === null || row.district_id === undefined ?
			null
		:
			parseString(row.district_id, 'district_id'),
		anchorX: parseNullableNumber(row.anchor_x, 'anchor_x'),
		anchorY: parseNullableNumber(row.anchor_y, 'anchor_y'),
		anchorZ: parseNullableNumber(row.anchor_z, 'anchor_z'),
		protocolLabel: parseString(row.protocol_label, 'protocol_label'),
		familyLabel: parseString(row.family_label, 'family_label'),
		activity32: 0,
		incomingValue32: '0',
		outgoingValue32: '0',
		eventCount32: parseNumber(row.event_count_32, 'event_count_32'),
		transferVelocity32: parseNumber(row.transfer_velocity_32, 'transfer_velocity_32'),
		totalSupply: parseString(row.total_supply, 'total_supply'),
	}))
}

export const loadKnownCollectionContracts = async (db: ProjectionDb, args: {
	chainId: bigint
	headBlockNumber: bigint
	limitPerDistrict: number
}) => {
	const fromBlockNumber = args.headBlockNumber > 31n ?
		args.headBlockNumber - 31n
	:
		0n
	const { rows } = await db.query(
		`
			with recent_activity as (
				select
					target_address,
					count(*)::int as event_count_32
				from adapter_events
				where chain_id = $1
					and adapter_id = 'erc721'
					and canonical = true
					and event_family = 'transfer'
					and (payload_json->>'blockNumber')::bigint >= $2
				group by target_address
			),
			ranked as (
				select
					ae.address,
					coalesce(dm.entity_id, concat('contract:', ae.chain_id::text, ':', ae.address)) as entity_id,
					dm.district_id,
					ea.anchor_x,
					ea.anchor_y,
					ea.anchor_z,
					coalesce(ah.payload_json->>'preferredLabel', concat(left(ae.address, 8), '...', right(ae.address, 4))) as protocol_label,
					coalesce(ae.metadata_json->>'familyLabel', ae.family) as family_label,
					coalesce(ra.event_count_32, 0) as event_count_32,
					coalesce((mint_surface.value_json)::text::int, 0) as mint_activity_32,
					coalesce((transfer_surface.value_json)::text::int, 0) as transfer_activity_32,
					row_number() over (
						partition by dm.district_id
						order by coalesce(ra.event_count_32, 0) desc, ae.address asc
					) as district_rank
				from adapter_entities ae
				left join adapter_hints ah
					on ah.chain_id = ae.chain_id
					and ah.address = ae.address
					and ah.adapter_id = ae.adapter_id
					and ah.hint_type = 'object_style'
				left join adapter_surfaces mint_surface
					on mint_surface.chain_id = ae.chain_id
					and mint_surface.address = ae.address
					and mint_surface.adapter_id = ae.adapter_id
					and mint_surface.surface_id = 'mint_activity_32'
				left join adapter_surfaces transfer_surface
					on transfer_surface.chain_id = ae.chain_id
					and transfer_surface.address = ae.address
					and transfer_surface.adapter_id = ae.adapter_id
					and transfer_surface.surface_id = 'transfer_activity_32'
				left join district_memberships dm
					on dm.chain_id = ae.chain_id
					and dm.entity_id = concat('contract:', ae.chain_id::text, ':', ae.address)
				left join entity_anchors ea
					on ea.chain_id = dm.chain_id
					and ea.entity_id = dm.entity_id
				left join recent_activity ra
					on ra.target_address = ae.address
				where ae.chain_id = $1
					and ae.adapter_id = 'erc721'
					and ae.confidence in ('exact', 'high')
			)
			select
				address,
				entity_id,
				district_id,
				anchor_x,
				anchor_y,
				anchor_z,
				protocol_label,
				family_label,
				event_count_32,
				mint_activity_32,
				transfer_activity_32
			from ranked
			where district_id is null
				or district_rank <= $3
			order by transfer_activity_32 desc, address asc
		`,
		[
			args.chainId.toString(),
			fromBlockNumber.toString(),
			args.limitPerDistrict,
		],
	)

	return rows.map((row): KnownCollectionContract => ({
		address: parseString(row.address, 'address'),
		entityId: parseString(row.entity_id, 'entity_id'),
		districtId: row.district_id === null || row.district_id === undefined ?
			null
		:
			parseString(row.district_id, 'district_id'),
		anchorX: parseNullableNumber(row.anchor_x, 'anchor_x'),
		anchorY: parseNullableNumber(row.anchor_y, 'anchor_y'),
		anchorZ: parseNullableNumber(row.anchor_z, 'anchor_z'),
		protocolLabel: parseString(row.protocol_label, 'protocol_label'),
		familyLabel: parseString(row.family_label, 'family_label'),
		activity32: parseNumber(row.transfer_activity_32, 'transfer_activity_32'),
		eventCount32: parseNumber(row.event_count_32, 'event_count_32'),
		mintActivity32: parseNumber(row.mint_activity_32, 'mint_activity_32'),
		transferActivity32: parseNumber(row.transfer_activity_32, 'transfer_activity_32'),
	}))
}

export const loadKnownMultiTokenContracts = async (db: ProjectionDb, args: {
	chainId: bigint
	headBlockNumber: bigint
	limitPerDistrict: number
}) => {
	const fromBlockNumber = args.headBlockNumber > 31n ?
		args.headBlockNumber - 31n
	:
		0n
	const { rows } = await db.query(
		`
			with recent_activity as (
				select
					target_address,
					count(*)::int as event_count_32
				from adapter_events
				where chain_id = $1
					and adapter_id = 'erc1155'
					and canonical = true
					and event_family in ('transfer_single', 'transfer_batch')
					and (payload_json->>'blockNumber')::bigint >= $2
				group by target_address
			),
			ranked as (
				select
					ae.address,
					coalesce(dm.entity_id, concat('contract:', ae.chain_id::text, ':', ae.address)) as entity_id,
					dm.district_id,
					ea.anchor_x,
					ea.anchor_y,
					ea.anchor_z,
					coalesce(ah.payload_json->>'preferredLabel', concat(left(ae.address, 8), '...', right(ae.address, 4))) as protocol_label,
					coalesce(ae.metadata_json->>'familyLabel', ae.family) as family_label,
					coalesce(ra.event_count_32, 0) as event_count_32,
					coalesce((batch_surface.value_json)::text::int, 0) as batch_activity_32,
					coalesce((transfer_surface.value_json)::text::int, 0) as transfer_activity_32,
					row_number() over (
						partition by dm.district_id
						order by coalesce(ra.event_count_32, 0) desc, ae.address asc
					) as district_rank
				from adapter_entities ae
				left join adapter_hints ah
					on ah.chain_id = ae.chain_id
					and ah.address = ae.address
					and ah.adapter_id = ae.adapter_id
					and ah.hint_type = 'object_style'
				left join adapter_surfaces batch_surface
					on batch_surface.chain_id = ae.chain_id
					and batch_surface.address = ae.address
					and batch_surface.adapter_id = ae.adapter_id
					and batch_surface.surface_id = 'batch_activity_32'
				left join adapter_surfaces transfer_surface
					on transfer_surface.chain_id = ae.chain_id
					and transfer_surface.address = ae.address
					and transfer_surface.adapter_id = ae.adapter_id
					and transfer_surface.surface_id = 'transfer_activity_32'
				left join district_memberships dm
					on dm.chain_id = ae.chain_id
					and dm.entity_id = concat('contract:', ae.chain_id::text, ':', ae.address)
				left join entity_anchors ea
					on ea.chain_id = dm.chain_id
					and ea.entity_id = dm.entity_id
				left join recent_activity ra
					on ra.target_address = ae.address
				where ae.chain_id = $1
					and ae.adapter_id = 'erc1155'
					and ae.confidence in ('exact', 'high')
			)
			select
				address,
				entity_id,
				district_id,
				anchor_x,
				anchor_y,
				anchor_z,
				protocol_label,
				family_label,
				event_count_32,
				batch_activity_32,
				transfer_activity_32
			from ranked
			where district_id is null
				or district_rank <= $3
			order by transfer_activity_32 desc, address asc
		`,
		[
			args.chainId.toString(),
			fromBlockNumber.toString(),
			args.limitPerDistrict,
		],
	)

	return rows.map((row): KnownMultiTokenContract => ({
		address: parseString(row.address, 'address'),
		entityId: parseString(row.entity_id, 'entity_id'),
		districtId: row.district_id === null || row.district_id === undefined ?
			null
		:
			parseString(row.district_id, 'district_id'),
		anchorX: parseNullableNumber(row.anchor_x, 'anchor_x'),
		anchorY: parseNullableNumber(row.anchor_y, 'anchor_y'),
		anchorZ: parseNullableNumber(row.anchor_z, 'anchor_z'),
		protocolLabel: parseString(row.protocol_label, 'protocol_label'),
		familyLabel: parseString(row.family_label, 'family_label'),
		activity32: parseNumber(row.transfer_activity_32, 'transfer_activity_32'),
		eventCount32: parseNumber(row.event_count_32, 'event_count_32'),
		batchActivity32: parseNumber(row.batch_activity_32, 'batch_activity_32'),
		transferActivity32: parseNumber(row.transfer_activity_32, 'transfer_activity_32'),
	}))
}

export const loadKnownAmmPoolContracts = async (db: ProjectionDb, args: {
	chainId: bigint
	headBlockNumber: bigint
	limitPerDistrict: number
}) => {
	const fromBlockNumber = args.headBlockNumber > 31n ?
		args.headBlockNumber - 31n
	:
		0n
	const { rows } = await db.query(
		`
			with recent_activity as (
				select
					target_address,
					count(*)::int as event_count_32
				from adapter_events
				where chain_id = $1
					and adapter_id = 'amm_pool'
					and canonical = true
					and event_family in ('swap', 'mint', 'burn', 'sync')
					and (payload_json->>'blockNumber')::bigint >= $2
				group by target_address
			),
			ranked as (
				select
					ae.address,
					coalesce(dm.entity_id, concat('contract:', ae.chain_id::text, ':', ae.address)) as entity_id,
					dm.district_id,
					ea.anchor_x,
					ea.anchor_y,
					ea.anchor_z,
					coalesce(ah.payload_json->>'preferredLabel', concat(left(ae.address, 8), '...', right(ae.address, 4))) as protocol_label,
					coalesce(ae.metadata_json->>'familyLabel', ae.family) as family_label,
					coalesce(ra.event_count_32, 0) as event_count_32,
					coalesce((swap_surface.value_json)::text::int, 0) as swap_intensity_32,
					coalesce(trim('"' from reserve0_surface.value_json::text), '0') as reserve0,
					coalesce(trim('"' from reserve1_surface.value_json::text), '0') as reserve1,
					row_number() over (
						partition by dm.district_id
						order by coalesce((swap_surface.value_json)::text::int, 0) desc, ae.address asc
					) as district_rank
				from adapter_entities ae
				left join adapter_hints ah
					on ah.chain_id = ae.chain_id
					and ah.address = ae.address
					and ah.adapter_id = ae.adapter_id
					and ah.hint_type = 'object_style'
				left join adapter_surfaces swap_surface
					on swap_surface.chain_id = ae.chain_id
					and swap_surface.address = ae.address
					and swap_surface.adapter_id = ae.adapter_id
					and swap_surface.surface_id = 'swap_intensity_32'
				left join adapter_surfaces reserve0_surface
					on reserve0_surface.chain_id = ae.chain_id
					and reserve0_surface.address = ae.address
					and reserve0_surface.adapter_id = ae.adapter_id
					and reserve0_surface.surface_id = 'reserve0'
				left join adapter_surfaces reserve1_surface
					on reserve1_surface.chain_id = ae.chain_id
					and reserve1_surface.address = ae.address
					and reserve1_surface.adapter_id = ae.adapter_id
					and reserve1_surface.surface_id = 'reserve1'
				left join district_memberships dm
					on dm.chain_id = ae.chain_id
					and dm.entity_id = concat('contract:', ae.chain_id::text, ':', ae.address)
				left join entity_anchors ea
					on ea.chain_id = dm.chain_id
					and ea.entity_id = dm.entity_id
				left join recent_activity ra
					on ra.target_address = ae.address
				where ae.chain_id = $1
					and ae.adapter_id = 'amm_pool'
					and ae.confidence in ('exact', 'high')
			)
			select
				address,
				entity_id,
				district_id,
				anchor_x,
				anchor_y,
				anchor_z,
				protocol_label,
				family_label,
				event_count_32,
				swap_intensity_32,
				reserve0,
				reserve1
			from ranked
			where district_id is null
				or district_rank <= $3
			order by swap_intensity_32 desc, address asc
		`,
		[
			args.chainId.toString(),
			fromBlockNumber.toString(),
			args.limitPerDistrict,
		],
	)

	return rows.map((row): KnownAmmPoolContract => ({
		address: parseString(row.address, 'address'),
		entityId: parseString(row.entity_id, 'entity_id'),
		districtId: row.district_id === null || row.district_id === undefined ?
			null
		:
			parseString(row.district_id, 'district_id'),
		anchorX: parseNullableNumber(row.anchor_x, 'anchor_x'),
		anchorY: parseNullableNumber(row.anchor_y, 'anchor_y'),
		anchorZ: parseNullableNumber(row.anchor_z, 'anchor_z'),
		protocolLabel: parseString(row.protocol_label, 'protocol_label'),
		familyLabel: parseString(row.family_label, 'family_label'),
		activity32: parseNumber(row.swap_intensity_32, 'swap_intensity_32'),
		eventCount32: parseNumber(row.event_count_32, 'event_count_32'),
		swapIntensity32: parseNumber(row.swap_intensity_32, 'swap_intensity_32'),
		reserve0: parseString(row.reserve0, 'reserve0'),
		reserve1: parseString(row.reserve1, 'reserve1'),
	}))
}

export const loadAmmPoolAttachmentCandidates = async (db: ProjectionDb, args: {
	chainId: bigint
}) => {
	const { rows } = await db.query(
		`
			select
				address,
				payload_json->>'kind' as kind,
				payload_json->>'title' as title,
				coalesce((payload_json->>'priority')::numeric::text, '0') as priority
			from adapter_hints
			where chain_id = $1
				and adapter_id = 'amm_pool'
				and hint_type = 'attachment_candidate'
			order by address asc
		`,
		[
			args.chainId.toString(),
		],
	)

	return rows.map((row) => ({
		address: parseString(row.address, 'address'),
		kind: parseString(row.kind, 'kind'),
		title: parseString(row.title, 'title'),
		priority: parseString(row.priority, 'priority'),
	}))
}

export const loadContractSurfaceStats = async (db: ProjectionDb, args: {
	chainId: bigint
	headBlockNumber: bigint
	addresses: string[]
}) => {
	if (args.addresses.length === 0) {
		return []
	}

	const fromBlockNumber = args.headBlockNumber > 31n ?
		args.headBlockNumber - 31n
	:
		0n

	const { rows } = await db.query(
		`
			with targets as (
				select unnest($2::text[]) as address
			),
			tx_stats as (
				select
					t.address,
					count(*)::int as activity_32,
					coalesce(sum(
						case
							when lower(tx.to_address) = t.address or lower(coalesce(tx.contract_address_created, '')) = t.address then tx.value_wei
							else 0
						end
					), 0)::text as incoming_value_32,
					coalesce(sum(
						case
							when lower(tx.from_address) = t.address then tx.value_wei
							else 0
						end
					), 0)::text as outgoing_value_32
				from targets t
				left join transactions tx
					on tx.chain_id = $1
					and tx.canonical = true
					and tx.block_number between $3 and $4
					and (
						lower(tx.from_address) = t.address
						or lower(coalesce(tx.to_address, '')) = t.address
						or lower(coalesce(tx.contract_address_created, '')) = t.address
					)
				group by t.address
			),
			log_stats as (
				select
					t.address,
					count(*)::int as event_count_32
				from targets t
				left join logs l
					on l.chain_id = $1
					and l.canonical = true
					and l.removed = false
					and l.block_number between $3 and $4
					and lower(l.address) = t.address
				group by t.address
			)
			select
				t.address,
				concat('contract:', $1::text, ':', t.address) as entity_id,
				coalesce(tx_stats.activity_32, 0) as activity_32,
				coalesce(tx_stats.incoming_value_32, '0') as incoming_value_32,
				coalesce(tx_stats.outgoing_value_32, '0') as outgoing_value_32,
				coalesce(log_stats.event_count_32, 0) as event_count_32
			from targets t
			left join tx_stats
				on tx_stats.address = t.address
			left join log_stats
				on log_stats.address = t.address
			order by t.address asc
		`,
		[
			args.chainId.toString(),
			args.addresses,
			fromBlockNumber.toString(),
			args.headBlockNumber.toString(),
		],
	)

	return rows.map((row) => ({
		address: parseString(row.address, 'address'),
		entityId: parseString(row.entity_id, 'entity_id'),
		activity32: parseNumber(row.activity_32, 'activity_32'),
		incomingValue32: parseString(row.incoming_value_32, 'incoming_value_32'),
		outgoingValue32: parseString(row.outgoing_value_32, 'outgoing_value_32'),
		eventCount32: parseNumber(row.event_count_32, 'event_count_32'),
	}))
}

export const loadNativeTransfers = async (db: ProjectionDb, args: {
	chainId: bigint
	fromBlockNumber: bigint
}) => {
	const { rows } = await db.query(
		`
			select
				tx_hash,
				block_number,
				from_address,
				to_address,
				value_wei::text as value_wei
			from transactions
			where chain_id = $1
				and canonical = true
				and block_number >= $2
				and to_address is not null
				and value_wei > 0
			order by block_number asc, tx_index asc
		`,
		[
			args.chainId.toString(),
			args.fromBlockNumber.toString(),
		],
	)

	return rows.map((row) => ({
		txHash: parseString(row.tx_hash, 'tx_hash'),
		blockNumber: parseBigInt(row.block_number, 'block_number'),
		fromAddress: parseString(row.from_address, 'from_address'),
		toAddress: parseString(row.to_address, 'to_address'),
		valueWei: parseString(row.value_wei, 'value_wei'),
	}))
}

export const loadContractCalls = async (db: ProjectionDb, args: {
	chainId: bigint
	fromBlockNumber: bigint
}) => {
	const { rows } = await db.query(
		`
			select
				tx_hash,
				block_number,
				from_address,
				to_address
			from transactions
			where chain_id = $1
				and canonical = true
				and block_number >= $2
				and to_address is not null
			order by block_number asc, tx_index asc
		`,
		[
			args.chainId.toString(),
			args.fromBlockNumber.toString(),
		],
	)

	return rows.map((row) => ({
		txHash: parseString(row.tx_hash, 'tx_hash'),
		blockNumber: parseBigInt(row.block_number, 'block_number'),
		fromAddress: parseString(row.from_address, 'from_address'),
		toAddress: parseString(row.to_address, 'to_address'),
	}))
}

export const loadErc20Transfers = async (db: ProjectionDb, args: {
	chainId: bigint
	fromBlockNumber: bigint
}) => {
	const { rows } = await db.query(
		`
			select
				tx_hash,
				(payload_json->>'blockNumber')::bigint as block_number,
				payload_json->>'from' as from_address,
				payload_json->>'to' as to_address,
				coalesce(payload_json->>'tokenClass', 'unknown-token') as token_class
			from adapter_events
			where chain_id = $1
				and adapter_id = 'erc20'
				and canonical = true
				and event_family = 'transfer'
				and (payload_json->>'blockNumber')::bigint >= $2
			order by block_number asc, tx_hash asc
		`,
		[
			args.chainId.toString(),
			args.fromBlockNumber.toString(),
		],
	)

	return rows.flatMap((row) => (
		row.from_address === null
		|| row.from_address === undefined
		|| row.to_address === null
		|| row.to_address === undefined ?
			[]
		:
			[
				{
					txHash: parseString(row.tx_hash, 'tx_hash'),
					blockNumber: parseBigInt(row.block_number, 'block_number'),
					fromAddress: parseString(row.from_address, 'from_address'),
					toAddress: parseString(row.to_address, 'to_address'),
					tokenClass: parseString(row.token_class, 'token_class'),
				},
			]
	))
}

export const loadRecentTxPulses = async (db: ProjectionDb, args: {
	chainId: bigint
	fromBlockNumber: bigint
}) => {
	const { rows } = await db.query(
		`
			select
				tx.tx_hash,
				tx.block_number,
				tx.tx_index,
				tx.from_address,
				tx.to_address,
				tx.value_wei::text as value_wei,
				r.gas_used::text as gas_used
			from transactions tx
			left join receipts r
				on r.chain_id = tx.chain_id
				and r.tx_hash = tx.tx_hash
				and r.block_hash = tx.block_hash
			where tx.chain_id = $1
				and tx.canonical = true
				and tx.block_number >= $2
			order by tx.block_number asc, tx.tx_index asc
		`,
		[
			args.chainId.toString(),
			args.fromBlockNumber.toString(),
		],
	)

	return rows.map((row) => ({
		txHash: parseString(row.tx_hash, 'tx_hash'),
		blockNumber: parseBigInt(row.block_number, 'block_number'),
		txIndex: parseNumber(row.tx_index, 'tx_index'),
		fromAddress: parseString(row.from_address, 'from_address'),
		toAddress: row.to_address === null || row.to_address === undefined ?
			null
		:
			parseString(row.to_address, 'to_address'),
		valueWei: parseString(row.value_wei, 'value_wei'),
		gasUsed: row.gas_used === null || row.gas_used === undefined ?
			'0'
		:
			parseString(row.gas_used, 'gas_used'),
	}))
}

export const loadEventEffectLogs = async (db: ProjectionDb, args: {
	chainId: bigint
	fromBlockNumber: bigint
	toBlockNumber: bigint
	topic0s: string[]
}) => {
	if (args.topic0s.length === 0) {
		return []
	}

	const { rows } = await db.query(
		`
			select
				block_number,
				tx_hash,
				log_index,
				address,
				topic0,
				topic1,
				topic2,
				topic3,
				data
			from logs
			where chain_id = $1
				and canonical = true
				and removed = false
				and block_number between $2 and $3
				and topic0 = any($4)
			order by block_number asc, log_index asc
		`,
		[
			args.chainId.toString(),
			args.fromBlockNumber.toString(),
			args.toBlockNumber.toString(),
			args.topic0s,
		],
	)

	return rows.map((row): EventEffectLog => ({
		blockNumber: parseBigInt(row.block_number, 'block_number'),
		txHash: parseString(row.tx_hash, 'tx_hash'),
		logIndex: parseNumber(row.log_index, 'log_index'),
		address: parseString(row.address, 'address'),
		topic0: row.topic0 === null || row.topic0 === undefined ?
			null
		:
			parseString(row.topic0, 'topic0'),
		topic1: row.topic1 === null || row.topic1 === undefined ?
			null
		:
			parseString(row.topic1, 'topic1'),
		topic2: row.topic2 === null || row.topic2 === undefined ?
			null
		:
			parseString(row.topic2, 'topic2'),
		topic3: row.topic3 === null || row.topic3 === undefined ?
			null
		:
			parseString(row.topic3, 'topic3'),
		data: parseString(row.data, 'data'),
	}))
}

export const persistStateSurfaces = async (db: ProjectionDb, args: {
	entityIds: string[]
	rows: StateSurfaceRow[]
}) => {
	if (args.entityIds.length === 0) {
		return
	}

	await db.query(
		`
			delete from state_surfaces
			where entity_id = any($1)
		`,
		[
			args.entityIds,
		],
	)

	for (const row of args.rows) {
		await db.query(
			`
				insert into state_surfaces (
					entity_id,
					surface_id,
					surface_kind,
					value_json,
					unit,
					visual_channel,
					updated_at_block
				)
				values ($1, $2, $3, $4::jsonb, $5, $6, $7)
				on conflict (entity_id, surface_id) do update
				set
					surface_kind = excluded.surface_kind,
					value_json = excluded.value_json,
					unit = excluded.unit,
					visual_channel = excluded.visual_channel,
					updated_at_block = excluded.updated_at_block
			`,
			[
				row.entityId,
				row.surfaceId,
				row.surfaceKind,
				JSON.stringify(row.valueJson),
				row.unit,
				row.visualChannel,
				row.updatedAtBlock.toString(),
			],
		)
	}
}

export const persistCorridors = async (db: ProjectionDb, args: {
	chainId: bigint
	rows: CorridorRow[]
}) => {
	await db.query(
		`
			delete from corridors
			where chain_id = $1
		`,
		[
			args.chainId.toString(),
		],
	)

	for (const row of args.rows) {
		await db.query(
			`
				insert into corridors (
					chain_id,
					corridor_key,
					source_district_id,
					target_district_id,
					flow_class,
					token_class,
					window_size,
					event_count,
					distinct_tx_count,
					total_value_wei,
					token_transfer_count,
					last_seen_block,
					published,
					corridor_algorithm_version,
					updated_at_block
				)
				values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
			`,
			[
				row.chainId.toString(),
				row.corridorKey,
				row.sourceDistrictId,
				row.targetDistrictId,
				row.flowClass,
				row.tokenClass,
				row.windowSize,
				row.eventCount,
				row.distinctTxCount,
				row.totalValueWei,
				row.tokenTransferCount,
				row.lastSeenBlock.toString(),
				row.published,
				row.corridorAlgorithmVersion.toString(),
				row.updatedAtBlock.toString(),
			],
		)
	}
}
