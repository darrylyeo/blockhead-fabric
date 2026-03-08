import { describe, expect, it } from 'vitest'

import { executeMutations } from './executeMutations.js'
import { createMockFabricClient } from './testFactories.js'

describe('executeMutations', () => {
	it('applies mutations in spec order', async () => {
		const calls: string[] = []
		const fabricClient = createMockFabricClient({
			createObject: async (args) => {
				calls.push(`create:${args.objectId}`)
				return {
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
				}
			},
			updateObject: async (args) => {
				calls.push(`update:${args.objectId}`)
				return {
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
				}
			},
			moveObject: async (args) => {
				calls.push(`move:${args.objectId}`)
				return {
					objectId: args.objectId,
					parentObjectId: args.parentId,
					name: args.objectId,
					classId: 72,
					type: 0,
					subtype: 0,
					resourceReference: null,
					resourceName: null,
					transform: {},
					bounds: null,
				}
			},
			deleteObject: async ({ objectId }) => {
				calls.push(`delete:${objectId}`)
			},
		})

		await executeMutations({
			scopeId: 'root',
			fabricClient,
			plan: {
				creates: [
					{
						objectId: 'create_1',
						parentId: '70:1',
						name: 'Create 1',
						classId: 72,
						type: 0,
						subtype: 0,
						resourceReference: null,
						resourceName: null,
						transform: {},
						bounds: null,
					},
				],
				updates: [
					{
						objectId: 'update_1',
						parentId: '70:1',
						name: 'Update 1',
						classId: 72,
						type: 0,
						subtype: 0,
						resourceReference: null,
						resourceName: null,
						transform: {},
						bounds: null,
					},
				],
				attachmentUpdates: [
					{
						objectId: 'attachment_1',
						parentId: '70:1',
						name: 'Attachment 1',
						classId: 73,
						type: 0,
						subtype: 255,
						resourceReference: '/fabric/73/100/',
						resourceName: null,
						transform: {},
						bounds: null,
					},
				],
				moves: [
					{
						objectId: 'move_1',
						parentId: '70:1',
					},
				],
				deletes: [
					{
						objectId: 'delete_1',
					},
				],
			},
		})

		expect(calls).toEqual([
			'create:create_1',
			'update:update_1',
			'move:move_1',
			'update:attachment_1',
			'delete:delete_1',
		])
	})
})
