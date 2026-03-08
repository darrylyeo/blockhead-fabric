import { Pool } from 'pg'

import type { Db } from '../shared/types.js'

export const connectDb = ({ databaseUrl }: { databaseUrl: string }): Db => (
	new Pool({
		connectionString: databaseUrl,
		max: 10,
	})
)
