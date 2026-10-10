import 'dotenv/config'
import mysql from 'mysql2/promise'
import { optimizeSqlIndexes } from './sql-performance-indexes.mjs'

if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) throw new Error('Configure o banco no .env antes de otimizar.')
const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME })
try {
  await connection.query('SET SESSION lock_wait_timeout = 10')
  console.log(JSON.stringify(await optimizeSqlIndexes(connection, { apply: process.argv.includes('--apply') }), null, 2))
} finally {
  await connection.end()
}
