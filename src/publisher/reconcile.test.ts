import { describe, expect, it, vi } from 'vitest'

import { createLogger } from '../shared/log.js'
import { createMockDb } from '../test/factories.js'

import { reconcileScope } from './reconcile.js'
import {
	createFabricEntrypointRow,
	createFabricObjectRow,
	createMockFabricClient,
	createFabricScopeRow,
	createPublicationCheckpointRow,
	createPublisherConfig,
	createRemoteObject,
} from './testFactories.js'

const createScopeRow = () => {
	const scope = createFabricScopeRow()
	const checkpoint = createPublicationCheckpointRow()

	return {
		scope_id: scope.scopeId,
		chain_id: scope.chainId.toString(),
		name: scope.name,
		entry_msf_path: scope.entryMsfPath,
		desired_revision: scope.desiredRevision.toString(),
		published_revision: scope.publishedRevision.toString(),
		status: scope.status,
		checkpoint_scope_id: checkpoint.scopeId,
		last_attempted_revision: checkpoint.lastAttemptedRevision.toString(),
		last_published_revision: checkpoint.lastPublishedRevision.toString(),
		checkpoint_status: checkpoint.status,
		last_error: checkpoint.lastError,
		checkpoint_updated_at: checkpoint.updatedAt.toISOString(),
	}
}

const createEntrypointRow = () => {
	const entrypoint = createFabricEntrypointRow()

	return {
		scope_id: entrypoint.scopeId,
		entrypoint_id: entrypoint.entrypointId,
		name: entrypoint.name,
		root_object_id: entrypoint.rootObjectId,
		desired_revision: entrypoint.desiredRevision.toString(),
		published_revision: entrypoint.publishedRevision.toString(),
	}
}

const createObjectRow = (object: ReturnType<typeof createFabricObjectRow>) => ({
	scope_id: object.scopeId,
	object_id: object.objectId,
	entrypoint_id: object.entrypointId,
	parent_object_id: object.parentObjectId,
	entity_id: object.entityId,
	class_id: object.classId,
	type: object.type,
	subtype: object.subtype,
	name: object.name,
	transform_json: object.transformJson,
	bound_json: object.boundJson,
	resource_reference: object.resourceReference,
	resource_name: object.resourceName,
	metadata_json: object.metadataJson,
	deleted: object.deleted,
	desired_revision: object.desiredRevision.toString(),
	published_revision: object.publishedRevision.toString(),
	updated_at_block: object.updatedAtBlock.toString(),
})

describe('reconcileScope', () => {
	it('marks invalid desired state as failed', async () => {
		const { db, calls } = createMockDb({
			onQuery: async (sql) => {
				if (sql.includes('from fabric_scopes s') && sql.includes('where s.scope_id = $1')) {
					return {
						command: '',
						rowCount: 1,
						oid: 0,
						fields: [],
						rows: [
							createScopeRow(),
						],
					}
				}

				if (sql.includes('from fabric_entrypoints')) {
					return {
						command: '',
						rowCount: 1,
						oid: 0,
						fields: [],
						rows: [
							createEntrypointRow(),
						],
					}
				}

				if (sql.includes('from fabric_objects')) {
					const object = createFabricObjectRow({
						objectId: 'orphan',
						parentObjectId: 'missing_parent',
					})

					return {
						command: '',
						rowCount: 1,
						oid: 0,
						fields: [],
						rows: [
							createObjectRow(object),
						],
					}
				}

				if (sql.includes('from fabric_attachments')) {
					return {
						command: '',
						rowCount: 0,
						oid: 0,
						fields: [],
						rows: [],
					}
				}

				if (sql.includes('select scope_id') && sql.includes('from fabric_scopes')) {
					return {
						command: '',
						rowCount: 1,
						oid: 0,
						fields: [],
						rows: [
							{
								scope_id: 'scope_eth_mainnet',
							},
						],
					}
				}

				return {
					command: '',
					rowCount: 0,
					oid: 0,
					fields: [],
					rows: [],
				}
			},
		})

		await reconcileScope({
			scopeId: 'scope_eth_mainnet',
			config: createPublisherConfig(),
			db,
			fabricClient: createMockFabricClient({
				connectRoot: vi.fn(async () => ({
					scopeId: 'root',
					rootObjectId: '70:1',
				})),
			}),
			logger: createLogger({
				log() {},
				warn() {},
				error() {},
			}),
		})

		expect(
			calls
				.filter(({ sql }) => (
					sql.includes('insert into publication_checkpoints')
				))
				.at(-1)?.params?.[3],
		).toBe('failed')
	})

	it('publishes a reconciled scope after executing the plan', async () => {
		const createObject = vi.fn(async (args) => ({
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
		}))
		const { db, calls } = createMockDb({
			onQuery: async (sql) => {
				if (sql.includes('from fabric_scopes s') && sql.includes('where s.scope_id = $1')) {
					return {
						command: '',
						rowCount: 1,
						oid: 0,
						fields: [],
						rows: [
							createScopeRow(),
						],
					}
				}

				if (sql.includes('from fabric_entrypoints')) {
					return {
						command: '',
						rowCount: 1,
						oid: 0,
						fields: [],
						rows: [
							createEntrypointRow(),
						],
					}
				}

				if (sql.includes('from fabric_objects')) {
					return {
						command: '',
						rowCount: 1,
						oid: 0,
						fields: [],
						rows: [
							createObjectRow(createFabricObjectRow({
								parentObjectId: '70:1',
							})),
						],
					}
				}

				if (sql.includes('from fabric_attachments')) {
					return {
						command: '',
						rowCount: 0,
						oid: 0,
						fields: [],
						rows: [],
					}
				}

				if (sql.includes('select scope_id') && sql.includes('from fabric_scopes')) {
					return {
						command: '',
						rowCount: 1,
						oid: 0,
						fields: [],
						rows: [
							{
								scope_id: 'scope_eth_mainnet',
							},
						],
					}
				}

				return {
					command: '',
					rowCount: 0,
					oid: 0,
					fields: [],
					rows: [],
				}
			},
		})

		await reconcileScope({
			scopeId: 'scope_eth_mainnet',
			config: createPublisherConfig(),
			db,
			fabricClient: createMockFabricClient({
				connectRoot: async () => ({
					scopeId: 'root',
					rootObjectId: '70:1',
				}),
				getObject: async ({ objectId }) => ({
					objectId,
					parentObjectId: null,
					name: 'Root',
					classId: 70,
					type: 0,
					subtype: 0,
					resourceReference: null,
					resourceName: null,
					transform: {},
					bounds: null,
				}),
				listObjects: async ({ anchorObjectId }) => (
					anchorObjectId === '70:1' ?
						[]
					: []
				),
				createObject,
			}),
			logger: createLogger({
				log() {},
				warn() {},
				error() {},
			}),
		})

		expect(createObject).toHaveBeenCalledTimes(1)
		expect(
			calls
				.filter(({ sql }) => (
					sql.includes('insert into publication_checkpoints')
				))
				.at(-1)?.params?.[3],
		).toBe('idle')
	})

	it('is restart-safe: second reconcile with same desired state does not create duplicates', async () => {
		const created: ReturnType<typeof createRemoteObject>[] = []
		const createObject = vi.fn(async (args) => {
			const obj = createRemoteObject({
				objectId: args.objectId,
				parentObjectId: args.parentId,
				name: args.name,
				classId: args.classId,
			})
			created.push(obj)
			return obj
		})
		const listObjects = vi.fn(async ({ anchorObjectId }: { anchorObjectId: string }) => (
			anchorObjectId === '70:1' ?
				[...created]
			: []
		))
		const scopeRow = createScopeRow()
		const entrypointRow = createEntrypointRow()
		const objectRow = createObjectRow(createFabricObjectRow({
			objectId: 'entry_latest_spine',
			parentObjectId: 'root',
		}))
		const { db } = createMockDb({
			onQuery: async (sql) => {
				if (sql.includes('from fabric_scopes s') && sql.includes('where s.scope_id = $1')) {
					return { command: '', rowCount: 1, oid: 0, fields: [], rows: [scopeRow] }
				}
				if (sql.includes('from fabric_entrypoints')) {
					return { command: '', rowCount: 1, oid: 0, fields: [], rows: [entrypointRow] }
				}
				if (sql.includes('from fabric_objects')) {
					return { command: '', rowCount: 1, oid: 0, fields: [], rows: [objectRow] }
				}
				if (sql.includes('from fabric_attachments')) {
					return { command: '', rowCount: 0, oid: 0, fields: [], rows: [] }
				}
				if (sql.includes('select scope_id') && sql.includes('from fabric_scopes')) {
					return { command: '', rowCount: 1, oid: 0, fields: [], rows: [{ scope_id: 'scope_eth_mainnet' }] }
				}
				return { command: '', rowCount: 0, oid: 0, fields: [], rows: [] }
			},
		})
		const fabricClient = createMockFabricClient({
			connectRoot: async () => ({ scopeId: 'root', rootObjectId: '70:1' }),
			getObject: async ({ objectId }) => (
				objectId === '70:1' ?
					createRemoteObject({ objectId: '70:1', parentObjectId: null, classId: 70, name: 'Root' })
				: created.find((o) => (o.objectId === objectId)) ?? null
			),
			listObjects,
			createObject,
		})
		const logger = createLogger({ log() {}, warn() {}, error() {} })

		await reconcileScope({
			scopeId: 'scope_eth_mainnet',
			config: createPublisherConfig(),
			db,
			fabricClient,
			logger,
		})
		expect(createObject).toHaveBeenCalledTimes(1)

		createObject.mockClear()
		await reconcileScope({
			scopeId: 'scope_eth_mainnet',
			config: createPublisherConfig(),
			db,
			fabricClient,
			logger,
		})
		expect(createObject).not.toHaveBeenCalled()
	})
})
