import 'dotenv/config'

import { connectDb } from '../src/db/connect.js'

const run = async () => {
	const databaseUrl = process.env.DATABASE_URL

	if (!databaseUrl) {
		throw new Error('DATABASE_URL is required')
	}

	const db = connectDb({ databaseUrl })

	try {
		await db.query('drop schema public cascade')
		await db.query('create schema public')
		await db.query('grant all on schema public to public')
		console.log('Database reset (public schema dropped and recreated)')
	} finally {
		await db.end()
	}
}

void run()
