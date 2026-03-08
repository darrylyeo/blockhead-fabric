import type {
	KnownAmmPoolContract,
	ProjectedFabricAttachment,
	ProjectedFabricEntrypoint,
	ProjectedFabricObject,
	ProjectedFabricScope,
	ProjectionConfig,
} from './types.js'

const childScopeId = (chainId: bigint, kind: string, address: string) => (
	`scope_attachment_${chainId.toString()}_${kind.replaceAll('-', '_')}_${address.slice(2)}`
)

const attachmentObjectId = (chainId: bigint, kind: string, address: string) => (
	`attachment:${chainId.toString()}:${kind}:${address}`
)

const descriptorPath = (scopeId: string) => (
	`/fabric/scopes/${scopeId}/`
)

const entrypointId = 'entry_inspect_attachment'
const surfacesContainerId = 'container:inspect:surfaces'

export const materializeAttachmentCandidates = (args: {
	config: ProjectionConfig
	headBlockNumber: bigint
	pools: KnownAmmPoolContract[]
	candidates: {
		address: string
		kind: string
		title: string
		priority: string
	}[]
}) => {
	const scopeId = args.config.chainId === 1n ?
		'scope_eth_mainnet'
	:
		`scope_chain_${args.config.chainId.toString()}`
	const poolsByAddress = new Map(
		args.pools.map((pool) => (
			[
				pool.address.toLowerCase(),
				pool,
			]
		)),
	)
	const childScopes: ProjectedFabricScope[] = []
	const entrypoints: ProjectedFabricEntrypoint[] = []
	const attachments: ProjectedFabricAttachment[] = []
	const objects: ProjectedFabricObject[] = []
	const seenObjectIds = new Set<string>()

	for (const candidate of args.candidates) {
		const pool = poolsByAddress.get(candidate.address.toLowerCase())

		if (!pool) {
			continue
		}

		const childId = childScopeId(args.config.chainId, candidate.kind, pool.address)
		const resourceReference = descriptorPath(childId)
		const objectId = attachmentObjectId(args.config.chainId, candidate.kind, pool.address)

		if (seenObjectIds.has(objectId)) {
			continue
		}

		seenObjectIds.add(objectId)

		childScopes.push({
			scopeId: childId,
			chainId: args.config.chainId,
			name: candidate.title,
			entryMsfPath: resourceReference,
			desiredRevision: args.headBlockNumber,
			status: 'active',
		})
		entrypoints.push({
			scopeId: childId,
			entrypointId,
			name: candidate.title,
			rootObjectId: entrypointId,
			desiredRevision: args.headBlockNumber,
		})
		attachments.push({
			scopeId,
			objectId,
			childScopeId: childId,
			resourceReference,
			desiredRevision: args.headBlockNumber,
		})
		objects.push({
			scopeId,
			objectId,
			entrypointId: 'entry_protocol_landmarks',
			parentObjectId: pool.entityId,
			entityId: objectId,
			classId: 73,
			type: 0,
			subtype: 255,
			name: candidate.title,
			transformJson: {
				position: {
					x: 0,
					y: 6,
					z: 0,
				},
				rotation: {
					x: 0,
					y: 0,
					z: 0,
					w: 1,
				},
				scale: {
					x: 1,
					y: 1,
					z: 1,
				},
			},
			boundJson: {
				x: 4,
				y: 4,
				z: 4,
			},
			resourceReference,
			resourceName: 'attachment-inspect',
			metadataJson: {
				schemaVersion: 1,
				entityId: objectId,
				entityKind: 'attachment',
				chainId: Number(args.config.chainId),
				canonical: true,
				updatedAtBlock: args.headBlockNumber.toString(),
				kind: candidate.kind,
				childScopeId: childId,
				priority: candidate.priority,
				parentEntityId: pool.entityId,
			},
			deleted: false,
			desiredRevision: args.headBlockNumber,
			updatedAtBlock: args.headBlockNumber,
		})
		objects.push({
			scopeId: childId,
			objectId: entrypointId,
			entrypointId,
			parentObjectId: 'root',
			entityId: `entry:inspect-attachment:${args.config.chainId.toString()}:${pool.address}`,
			classId: 72,
			type: 0,
			subtype: 0,
			name: candidate.title,
			transformJson: {
				position: {
					x: 0,
					y: 0,
					z: 0,
				},
				rotation: {
					x: 0,
					y: 0,
					z: 0,
					w: 1,
				},
				scale: {
					x: 1,
					y: 1,
					z: 1,
				},
			},
			boundJson: {
				x: 96,
				y: 48,
				z: 96,
			},
			resourceReference: null,
			resourceName: null,
			metadataJson: {
				schemaVersion: 1,
				entityId: `entry:inspect-attachment:${args.config.chainId.toString()}:${pool.address}`,
				entityKind: 'entrypoint',
				chainId: Number(args.config.chainId),
				canonical: true,
				updatedAtBlock: args.headBlockNumber.toString(),
				kind: candidate.kind,
				parentEntityId: pool.entityId,
			},
			deleted: false,
			desiredRevision: args.headBlockNumber,
			updatedAtBlock: args.headBlockNumber,
		})
		objects.push({
			scopeId: childId,
			objectId: pool.entityId,
			entrypointId,
			parentObjectId: entrypointId,
			entityId: pool.entityId,
			classId: 73,
			type: 0,
			subtype: 0,
			name: pool.protocolLabel,
			transformJson: {
				position: {
					x: 0,
					y: 8,
					z: 0,
				},
				rotation: {
					x: 0,
					y: 0,
					z: 0,
					w: 1,
				},
				scale: {
					x: 2,
					y: 2,
					z: 2,
				},
			},
			boundJson: {
				x: 12,
				y: 12,
				z: 12,
			},
			resourceReference: null,
			resourceName: 'amm-pool',
			metadataJson: {
				schemaVersion: 1,
				entityId: pool.entityId,
				entityKind: 'contract',
				chainId: Number(args.config.chainId),
				canonical: true,
				updatedAtBlock: args.headBlockNumber.toString(),
				protocolLabel: pool.protocolLabel,
				familyLabel: pool.familyLabel,
				swapIntensity32: pool.swapIntensity32,
				reserve0: pool.reserve0,
				reserve1: pool.reserve1,
			},
			deleted: false,
			desiredRevision: args.headBlockNumber,
			updatedAtBlock: args.headBlockNumber,
		})
		objects.push({
			scopeId: childId,
			objectId: surfacesContainerId,
			entrypointId,
			parentObjectId: entrypointId,
			entityId: `container:inspect:surfaces:${args.config.chainId.toString()}:${pool.address}`,
			classId: 72,
			type: 0,
			subtype: 0,
			name: 'State Surfaces',
			transformJson: {
				position: {
					x: 0,
					y: 0,
					z: 28,
				},
				rotation: {
					x: 0,
					y: 0,
					z: 0,
					w: 1,
				},
				scale: {
					x: 1,
					y: 1,
					z: 1,
				},
			},
			boundJson: {
				x: 80,
				y: 24,
				z: 32,
			},
			resourceReference: null,
			resourceName: null,
			metadataJson: {
				schemaVersion: 1,
				entityId: `container:inspect:surfaces:${args.config.chainId.toString()}:${pool.address}`,
				entityKind: 'container',
				chainId: Number(args.config.chainId),
				canonical: true,
				updatedAtBlock: args.headBlockNumber.toString(),
				parentEntityId: pool.entityId,
			},
			deleted: false,
			desiredRevision: args.headBlockNumber,
			updatedAtBlock: args.headBlockNumber,
		})
		for (const [index, surface] of [
			{
				id: 'reserve0',
				name: 'Reserve 0',
				value: pool.reserve0,
				x: -24,
			},
			{
				id: 'reserve1',
				name: 'Reserve 1',
				value: pool.reserve1,
				x: 0,
			},
			{
				id: 'swap_intensity_32',
				name: 'Swap Intensity 32',
				value: pool.swapIntensity32,
				x: 24,
			},
		].entries()) {
			objects.push({
				scopeId: childId,
				objectId: `surface:${pool.entityId}:${surface.id}`,
				entrypointId,
				parentObjectId: surfacesContainerId,
				entityId: `surface:${pool.entityId}:${surface.id}`,
				classId: 73,
				type: 0,
				subtype: 0,
				name: surface.name,
				transformJson: {
					position: {
						x: surface.x,
						y: 6,
						z: index * 2,
					},
					rotation: {
						x: 0,
						y: 0,
						z: 0,
						w: 1,
					},
					scale: {
						x: 1,
						y: 1,
						z: 1,
					},
				},
				boundJson: {
					x: 10,
					y: 10,
					z: 10,
				},
				resourceReference: null,
				resourceName: 'state-surface',
				metadataJson: {
					schemaVersion: 1,
					entityId: `surface:${pool.entityId}:${surface.id}`,
					entityKind: 'surface',
					chainId: Number(args.config.chainId),
					canonical: true,
					updatedAtBlock: args.headBlockNumber.toString(),
					parentEntityId: pool.entityId,
					surfaceId: surface.id,
					value: surface.value,
				},
				deleted: false,
				desiredRevision: args.headBlockNumber,
				updatedAtBlock: args.headBlockNumber,
			})
		}
	}

	return {
		childScopes,
		entrypoints,
		attachments,
		objects,
	}
}
