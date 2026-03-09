import { Hex } from '@tevm/voltaire/Hex'
import { Keccak256 } from '@tevm/voltaire/Keccak256'

import {
	accountResource,
	contractResource,
	districtResource,
} from './resources.js'

import type {
	DistrictAtlasEntity,
	DistrictMembershipRow,
	DistrictRow,
	EntityAnchorRow,
	ProjectedFabricObject,
	ProjectedFabricState,
	ProjectionConfig,
} from './types.js'

const spiralOffsets = [
	[
		0,
		0,
	],
	[
		6,
		0,
	],
	[
		-6,
		0,
	],
	[
		0,
		6,
	],
	[
		0,
		-6,
	],
	[
		6,
		6,
	],
	[
		-6,
		6,
	],
	[
		6,
		-6,
	],
	[
		-6,
		-6,
	],
] as const

const hashAddress = (address: string) => (
	hexString(Keccak256.fromHex(address.toLowerCase()))
)

const hexString = (value: Uint8Array) => (
	Hex.fromBytes(value).toLowerCase()
)

const districtKey = (address: string) => (
	hashAddress(address).slice(2, 4)
)

const districtId = (address: string) => (
	`d_${districtKey(address)}`
)

const entityId = (chainId: bigint, entity: DistrictAtlasEntity) => (
	`${entity.isContract ? 'contract' : 'account'}:${chainId.toString()}:${entity.address}`
)

const entityKind = (entity: DistrictAtlasEntity) => (
	entity.isContract ? 'contract' : 'account'
)

const label = (address: string) => (
	`${address.slice(0, 8)}...${address.slice(-4)}`
)

const parseNibble = (value: string) => (
	Number.parseInt(value, 16)
)

const districtOrigin = (
	districtKeyValue: string,
	districtSpacing: number,
	offsetX: number,
	offsetZ: number,
) => ({
	x: offsetX + (parseNibble(districtKeyValue[0] ?? '0') * districtSpacing) + (districtSpacing / 2),
	y: 0,
	z: offsetZ + (parseNibble(districtKeyValue[1] ?? '0') * districtSpacing) + (districtSpacing / 2),
})

const slot = (address: string, slotSpacing: number) => {
	const hash = hashAddress(address)

	return {
		x: ((Number.parseInt(hash.slice(6, 10), 16) % 16) - 7.5) * slotSpacing,
		y: 0,
		z: ((Number.parseInt(hash.slice(10, 14), 16) % 16) - 7.5) * slotSpacing,
		key: hash.slice(6, 14),
	}
}

const adjustedSlot = (entity: DistrictAtlasEntity, slotValue: ReturnType<typeof slot>, districtSpacing: number) => (
	entity.isContract && slotValue.x >= -((districtSpacing / 2) - 24) && slotValue.z >= -((districtSpacing / 2) - 24) && slotValue.x + 24 < districtSpacing / 2 && slotValue.z + 24 < districtSpacing / 2 ?
		{
			...slotValue,
			x: slotValue.x - 18,
			z: slotValue.z - 18,
		}
	:
		slotValue
)

const transform = (x: number, y: number, z: number) => ({
	position: {
		x,
		y,
		z,
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
})

const metadata = (chainId: bigint, entity: DistrictAtlasEntity, districtIdValue: string, updatedAtBlock: bigint) => ({
	schemaVersion: 1,
	entityId: entityId(chainId, entity),
	entityKind: entityKind(entity),
	chainId: Number(chainId),
	canonical: true,
	updatedAtBlock: updatedAtBlock.toString(),
	address: entity.address,
	isContract: entity.isContract,
	districtId: districtIdValue,
	label: label(entity.address),
	...(
		entity.isContract ?
			{
				familyLabel: entity.familyLabel,
			}
		:
			{}
	),
})

const districtMetadata = (chainId: bigint, district: DistrictRow) => ({
	schemaVersion: 1,
	entityId: `district:${chainId.toString()}:${district.districtId}`,
	entityKind: 'district',
	chainId: Number(chainId),
	canonical: true,
	updatedAtBlock: district.updatedAtBlock.toString(),
	districtId: district.districtId,
	entityCount: district.entityCount,
	contractCount: district.contractCount,
	accountCount: district.accountCount,
	activityWindow32: district.activityWindow32,
})

export const materializeDistrictAtlas = (args: {
	config: ProjectionConfig
	entities: DistrictAtlasEntity[]
	headBlockNumber: bigint
}) => {
	const scopeId = args.config.chainId === 1n ?
		'scope_eth_mainnet'
	:
		`scope_chain_${args.config.chainId.toString()}`
	const desiredRevision = args.headBlockNumber
	const atlasEntryObjectId = 'entry_district_atlas'
	const districtGroups = new Map<string, DistrictAtlasEntity[]>()

	for (const entity of args.entities) {
		const value = districtId(entity.address)
		const current = districtGroups.get(value) ?? []

		current.push(entity)
		districtGroups.set(value, current)
	}

	const districts = Array.from(districtGroups.entries())
		.sort(([left], [right]) => (
			left.localeCompare(right)
		))
		.map(([value, entities]) => {
			const key = value.slice(2)
			const origin = districtOrigin(
				key,
				args.config.districtSpacing,
				args.config.districtAtlasOffsetX,
				args.config.districtAtlasOffsetZ,
			)

			return {
				chainId: args.config.chainId,
				districtId: value,
				districtKey: key,
				originX: origin.x,
				originY: origin.y,
				originZ: origin.z,
				entityCount: entities.length,
				contractCount: entities.filter(({ isContract }) => (
					isContract
				)).length,
				accountCount: entities.filter(({ isContract }) => (
					!isContract
				)).length,
				activityWindow32: entities.filter(({ lastSeenBlock }) => (
					lastSeenBlock >= desiredRevision - 31n
				)).length,
				projectionVersion: args.config.projectionVersion,
				updatedAtBlock: desiredRevision,
			} satisfies DistrictRow
		})

	const memberships: DistrictMembershipRow[] = []
	const anchors: EntityAnchorRow[] = []
	const objects: ProjectedFabricObject[] = [
		{
			scopeId,
			objectId: atlasEntryObjectId,
			entrypointId: 'entry_district_atlas',
			parentObjectId: 'root',
			entityId: `entry:district-atlas:${args.config.chainId.toString()}`,
			classId: 73,
			type: 0,
			subtype: 0,
			name: 'District Atlas',
			transformJson: transform(0, 0, 0),
			boundJson: null,
			...districtResource(),
			metadataJson: {
				schemaVersion: 1,
				entityId: `entry:district-atlas:${args.config.chainId.toString()}`,
				entityKind: 'entrypoint',
				chainId: Number(args.config.chainId),
				canonical: true,
				updatedAtBlock: desiredRevision.toString(),
			},
			deleted: false,
			desiredRevision,
			updatedAtBlock: desiredRevision,
		},
	]

	for (const district of districts) {
		const group = [
			...(districtGroups.get(district.districtId) ?? []),
		].sort((left, right) => (
			entityId(args.config.chainId, left).localeCompare(entityId(args.config.chainId, right))
		))
		const districtObjectId = `district:${args.config.chainId.toString()}:${district.districtId}`
		const collisionGroups = new Map<string, DistrictAtlasEntity[]>()

		objects.push({
			scopeId,
			objectId: districtObjectId,
			entrypointId: 'entry_district_atlas',
			parentObjectId: atlasEntryObjectId,
			entityId: districtObjectId,
			classId: 73,
			type: 0,
			subtype: 0,
			name: `District ${district.districtId.slice(2).toUpperCase()}`,
			transformJson: {
				position: {
					x: district.originX,
					y: 1,
					z: district.originZ,
				},
				rotation: {
					x: 0,
					y: 0,
					z: 0,
					w: 1,
				},
				scale: {
					x: args.config.districtSpacing * 0.82,
					y: 2,
					z: args.config.districtSpacing * 0.82,
				},
			},
			boundJson: {
				x: args.config.districtSpacing,
				y: 8,
				z: args.config.districtSpacing,
			},
			...districtResource(),
			metadataJson: districtMetadata(args.config.chainId, district),
			deleted: false,
			desiredRevision,
			updatedAtBlock: desiredRevision,
		})

		for (const entity of group) {
			const slotValue = adjustedSlot(
				entity,
				slot(entity.address, args.config.slotSpacing),
				args.config.districtSpacing,
			)
			const current = collisionGroups.get(slotValue.key) ?? []

			current.push(entity)
			collisionGroups.set(slotValue.key, current)
		}

		for (const entities of collisionGroups.values()) {
			const ordered = [
				...entities,
			].sort((left, right) => (
				entityId(args.config.chainId, left).localeCompare(entityId(args.config.chainId, right))
			))

			for (const [collisionRank, entity] of ordered.entries()) {
				const slotValue = adjustedSlot(
					entity,
					slot(entity.address, args.config.slotSpacing),
					args.config.districtSpacing,
				)
				const [offsetX, offsetZ] = spiralOffsets[collisionRank] ?? [
					0,
					0,
				]
				const entityIdValue = entityId(args.config.chainId, entity)
				const anchorX = slotValue.x + offsetX
				const anchorZ = slotValue.z + offsetZ

				memberships.push({
					chainId: args.config.chainId,
					entityId: entityIdValue,
					entityKind: entityKind(entity),
					districtId: district.districtId,
					districtAlgorithmVersion: args.config.districtAlgorithmVersion,
					updatedAtBlock: desiredRevision,
				})

				anchors.push({
					chainId: args.config.chainId,
					entityId: entityIdValue,
					entityKind: entityKind(entity),
					districtId: district.districtId,
					anchorX,
					anchorY: 0,
					anchorZ,
					slotKey: slotValue.key,
					collisionRank,
					landmarkRank: entity.isContract ? 0 : null,
					anchorAlgorithmVersion: args.config.anchorAlgorithmVersion,
					updatedAtBlock: desiredRevision,
				})

				const scale = entity.isContract ?
					{
						x: 8,
						y: 12,
						z: 8,
					}
				:
					{
						x: 5,
						y: 5,
						z: 5,
					}

				objects.push({
					scopeId,
					objectId: entityIdValue,
					entrypointId: 'entry_district_atlas',
					parentObjectId: districtObjectId,
					entityId: entityIdValue,
					classId: 73,
					type: 0,
					subtype: 0,
					name: label(entity.address),
					transformJson: {
						position: {
							x: anchorX,
							y: 1 + (scale.y / 2),
							z: anchorZ,
						},
						rotation: {
							x: 0,
							y: 0,
							z: 0,
							w: 1,
						},
						scale,
					},
					boundJson: {
						x: entity.isContract ? 8 : 4,
						y: entity.isContract ? 8 : 4,
						z: entity.isContract ? 8 : 4,
					},
					...(
						entity.isContract ?
							contractResource(entity.familyLabel)
						:
							accountResource()
					),
					metadataJson: metadata(
						args.config.chainId,
						entity,
						district.districtId,
						desiredRevision,
					),
					deleted: false,
					desiredRevision,
					updatedAtBlock: desiredRevision,
				})
			}
		}
	}

	return {
		state: {
			scope: {
				scopeId,
				chainId: args.config.chainId,
				name: args.config.chainId === 1n ? 'Ethereum Mainnet' : `Chain ${args.config.chainId.toString()}`,
				entryMsfPath: '/fabric/',
				desiredRevision,
				status: 'active',
			},
			entrypoints: [
				{
					scopeId,
					entrypointId: 'entry_district_atlas',
					name: 'District Atlas',
					rootObjectId: atlasEntryObjectId,
					desiredRevision,
				},
			],
			objects,
		} satisfies ProjectedFabricState,
		districts,
		memberships,
		anchors,
	}
}
