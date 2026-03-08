import type { Logger } from '../shared/log.js'

import { listPublishableScopes, loadScopeSnapshot, markScopePublished, upsertPublicationCheckpoint } from './db.js'
import { discoverRemoteState } from './discoverRemoteState.js'
import { executeMutations } from './executeMutations.js'
import { planMutations } from './planMutations.js'
import type { FabricClient, PublishableScopeRow, PublisherConfig, PublisherDb } from './types.js'
import { validateDesiredState } from './validateDesiredState.js'

export const needsReconcile = (scope: PublishableScopeRow) => (
	scope.desiredRevision > (
		scope.checkpoint?.lastPublishedRevision
		?? scope.publishedRevision
	)
)

export const reconcileScope = async (args: {
	scopeId: string
	config: PublisherConfig
	db: PublisherDb
	fabricClient: FabricClient
	logger: Logger
}) => {
	const snapshot = await loadScopeSnapshot(args.db, args.scopeId)

	if (!snapshot) {
		return
	}

	await upsertPublicationCheckpoint(args.db, {
		scopeId: snapshot.scope.scopeId,
		lastAttemptedRevision: snapshot.scope.desiredRevision,
		lastPublishedRevision: snapshot.checkpoint?.lastPublishedRevision ?? snapshot.scope.publishedRevision,
		status: 'running',
		lastError: null,
	})

	const errors = validateDesiredState(snapshot)

	if (errors.length > 0) {
		const error = errors.join('; ')

		await upsertPublicationCheckpoint(args.db, {
			scopeId: snapshot.scope.scopeId,
			lastAttemptedRevision: snapshot.scope.desiredRevision,
			lastPublishedRevision: snapshot.checkpoint?.lastPublishedRevision ?? snapshot.scope.publishedRevision,
			status: 'failed',
			lastError: error,
		})

		args.logger.error('publisher.scope_validation_failed', {
			scopeId: snapshot.scope.scopeId,
			error,
		})

		return
	}

	if (snapshot.entrypoints.length === 0 && snapshot.objects.length === 0 && snapshot.attachments.length === 0) {
		await markScopePublished(args.db, {
			scopeId: snapshot.scope.scopeId,
			desiredRevision: snapshot.scope.desiredRevision,
		})

		args.logger.info('publisher.scope_published_empty', {
			scopeId: snapshot.scope.scopeId,
			desiredRevision: snapshot.scope.desiredRevision.toString(),
		})

		return
	}

	const remoteState = await discoverRemoteState({
		fabricClient: args.fabricClient,
		fabricUrl: args.config.fabricUrl,
		fabricAdminKey: args.config.fabricAdminKey,
		timeoutMs: args.config.publisherConnectTimeoutMs,
		snapshot,
	})
	const plan = planMutations({
		snapshot,
		remoteState,
	})

	await executeMutations({
		scopeId: remoteState.scopeId,
		fabricClient: args.fabricClient,
		plan,
	})
	await markScopePublished(args.db, {
		scopeId: snapshot.scope.scopeId,
		desiredRevision: snapshot.scope.desiredRevision,
	})

	args.logger.info('publisher.scope_published', {
		scopeId: snapshot.scope.scopeId,
		desiredRevision: snapshot.scope.desiredRevision.toString(),
		creates: plan.creates.length,
		updates: plan.updates.length,
		attachmentUpdates: plan.attachmentUpdates.length,
		moves: plan.moves.length,
		deletes: plan.deletes.length,
	})
}

export const runPublisherRound = async (args: {
	config: PublisherConfig
	db: PublisherDb
	fabricClient: FabricClient
	logger: Logger
}) => {
	const scopes = await listPublishableScopes(args.db)

	for (const scope of scopes) {
		if (!needsReconcile(scope)) {
			continue
		}

		try {
			await reconcileScope({
				scopeId: scope.scopeId,
				config: args.config,
				db: args.db,
				fabricClient: args.fabricClient,
				logger: args.logger,
			})
		} catch (error) {
			const lastPublishedRevision = scope.checkpoint?.lastPublishedRevision ?? scope.publishedRevision
			const message = error instanceof Error ?
				error.message
				: String(error)

			await upsertPublicationCheckpoint(args.db, {
				scopeId: scope.scopeId,
				lastAttemptedRevision: scope.desiredRevision,
				lastPublishedRevision,
				status: 'degraded',
				lastError: message,
			})

			args.logger.error('publisher.scope_reconcile_failed', {
				scopeId: scope.scopeId,
				error: message,
			})
		}
	}
}
