import { describe, expect, it } from 'vitest'

import {
	createFabricAttachmentRow,
	createFabricObjectRow,
	createScopeSnapshot,
} from './testFactories.js'
import { validateDesiredState } from './validateDesiredState.js'

describe('validateDesiredState', () => {
	it('accepts a valid desired state snapshot', () => {
		expect(validateDesiredState(createScopeSnapshot())).toEqual([])
	})

	it('reports missing parents and unknown child scopes', () => {
		expect(validateDesiredState(createScopeSnapshot({
			objects: [
				createFabricObjectRow({
					objectId: 'entry_latest_spine',
					parentObjectId: 'root',
				}),
				createFabricObjectRow({
					objectId: 'block_1',
					parentObjectId: 'missing_parent',
				}),
				createFabricObjectRow({
					objectId: 'attachment_1',
					classId: 72,
					parentObjectId: 'entry_latest_spine',
					resourceReference: '/fabric/73/99/',
				}),
			],
			attachments: [
				createFabricAttachmentRow({
					childScopeId: 'missing_scope',
				}),
			],
			knownScopeIds: [
				'scope_eth_mainnet',
			],
		}))).toEqual([
			'Object block_1 is missing parent missing_parent',
			'Attachment attachment_1 references unknown child scope missing_scope',
			'Attachment attachment_1 must use class 73',
		])
	})
})
