import { describe, expect, it } from 'vitest'

import {
	materializeContractStateSurfaces,
	surfaceMetadata,
} from './stateSurfaces.js'

const contract = {
	address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
	entityId: 'contract:1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
	districtId: 'd_a0',
	anchorX: 24,
	anchorY: 0,
	anchorZ: 48,
	protocolLabel: 'USDC',
	familyLabel: 'erc20',
	activity32: 9,
	incomingValue32: '42',
	outgoingValue32: '7',
	eventCount32: 3,
	transferVelocity32: 2,
	totalSupply: '100',
} as const

describe('materializeContractStateSurfaces', () => {
	it('materializes the v1 contract surface set', () => {
		expect(materializeContractStateSurfaces({
			contracts: [
				contract,
			],
			headBlockNumber: 100n,
		})).toEqual([
			{
				entityId: contract.entityId,
				surfaceId: 'activity_32',
				surfaceKind: 'gauge',
				valueJson: 9,
				unit: null,
				visualChannel: 'emissiveIntensity',
				updatedAtBlock: 100n,
			},
			{
				entityId: contract.entityId,
				surfaceId: 'incoming_value_32',
				surfaceKind: 'gauge',
				valueJson: '42',
				unit: 'wei',
				visualChannel: 'height',
				updatedAtBlock: 100n,
			},
			{
				entityId: contract.entityId,
				surfaceId: 'outgoing_value_32',
				surfaceKind: 'gauge',
				valueJson: '7',
				unit: 'wei',
				visualChannel: 'width',
				updatedAtBlock: 100n,
			},
			{
				entityId: contract.entityId,
				surfaceId: 'event_count_32',
				surfaceKind: 'gauge',
				valueJson: 3,
				unit: null,
				visualChannel: 'particleDensity',
				updatedAtBlock: 100n,
			},
		])
	})
})

describe('surfaceMetadata', () => {
	it('exposes stable surface ids and current values', () => {
		expect(surfaceMetadata(contract)).toEqual({
			stateSurfaces: [
				'activity_32',
				'incoming_value_32',
				'outgoing_value_32',
				'event_count_32',
			],
			surfaceValues: {
				activity_32: 9,
				incoming_value_32: '42',
				outgoing_value_32: '7',
				event_count_32: 3,
			},
		})
	})
})
