import { describe, expect, it } from 'vitest'

import { planMutations } from './planMutations.js'
import {
	createFabricAttachmentRow,
	createFabricObjectRow,
	createRemoteObject,
	createRemoteScopeState,
	createScopeSnapshot,
} from './testFactories.js'

describe('planMutations', () => {
	it('plans ordered creates, updates, moves, attachment updates, and deletes', () => {
		const plan = planMutations({
			snapshot: createScopeSnapshot({
				objects: [
					createFabricObjectRow({
						objectId: 'entry_latest_spine',
						parentObjectId: '70:1',
						name: 'Latest Spine Updated',
					}),
					createFabricObjectRow({
						objectId: 'block_1',
						parentObjectId: 'entry_latest_spine',
					}),
					createFabricObjectRow({
						objectId: 'attachment_1',
						parentObjectId: 'entry_latest_spine',
						classId: 73,
						resourceReference: '/fabric/73/100/',
					}),
				],
				attachments: [
					createFabricAttachmentRow({
						objectId: 'attachment_1',
						resourceReference: '/fabric/73/100/',
					}),
				],
			}),
			remoteState: createRemoteScopeState({
				managedObjects: [
					createRemoteObject({
						objectId: 'entry_latest_spine',
						parentObjectId: '70:1',
						name: 'Latest Spine',
					}),
					createRemoteObject({
						objectId: 'attachment_1',
						parentObjectId: 'wrong_parent',
						classId: 73,
						resourceReference: '/fabric/73/99/',
					}),
					createRemoteObject({
						objectId: 'obsolete_leaf',
						parentObjectId: 'entry_latest_spine',
					}),
					createRemoteObject({
						objectId: 'obsolete_parent',
						parentObjectId: 'entry_latest_spine',
					}),
					createRemoteObject({
						objectId: 'obsolete_child',
						parentObjectId: 'obsolete_parent',
					}),
				],
			}),
		})

		expect(plan.creates.map(({ objectId }) => (
			objectId
		))).toEqual([
			'block_1',
		])
		expect(plan.updates.map(({ objectId }) => (
			objectId
		))).toEqual([
			'entry_latest_spine',
		])
		expect(plan.attachmentUpdates.map(({ objectId }) => (
			objectId
		))).toEqual([
			'attachment_1',
		])
		expect(plan.moves).toEqual([
			{
				objectId: 'attachment_1',
				parentId: 'entry_latest_spine',
			},
		])
		expect(plan.deletes.map(({ objectId }) => (
			objectId
		))).toEqual([
			'obsolete_child',
			'obsolete_leaf',
			'obsolete_parent',
		])
	})

	it('resolves the desired root sentinel to the remote root object id', () => {
		const plan = planMutations({
			snapshot: createScopeSnapshot({
				objects: [
					createFabricObjectRow({
						objectId: 'entry_latest_spine',
						parentObjectId: 'root',
					}),
				],
			}),
			remoteState: createRemoteScopeState({
				rootObjectId: '73:1',
				managedObjects: [],
			}),
		})

		expect(plan.creates).toEqual([
			{
				objectId: 'entry_latest_spine',
				parentId: '73:1',
				name: 'Latest Spine',
				classId: 72,
				type: 0,
				subtype: 0,
				resourceReference: null,
				resourceName: null,
				transform: {},
				bounds: null,
			},
		])
	})
})
