// Additive indexes only. Identifiers are constants, never request input.
export const performanceIndexes = [
  { table: 'inventory_movements', name: 'idx_inventory_movements_order_type', columns: ['order_code', 'movement_type'] },
  { table: 'order_operation_events', name: 'idx_order_operation_events_order_seq', columns: ['order_code', 'seq'] },
  { table: 'order_operation_events', name: 'idx_order_operation_events_date_seq', columns: ['occurred_at', 'seq'] },
]

export async function optimizeSqlIndexes(connection, { apply = false } = {}) {
  const [existing] = await connection.execute('SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS position FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX')
  const results = []
  const changedTables = new Set()
  for (const index of performanceIndexes) {
    const current = existing.filter((row) => row.tableName === index.table && row.indexName === index.name)
    if (current.length && current.map((row) => row.columnName).join(',') !== index.columns.join(',')) throw new Error(`Index ${index.name} already exists with a different definition.`)
    if (current.length) {
      results.push({ name: index.name, status: 'already-present' })
      continue
    }
    // Online InnoDB index creation; fail instead of silently taking a table write lock.
    const sql = `ALTER TABLE ${index.table} ADD INDEX ${index.name} (${index.columns.join(', ')}), ALGORITHM=INPLACE, LOCK=NONE`
    if (apply) {
      await connection.query(sql)
      changedTables.add(index.table)
    }
    results.push({ name: index.name, status: apply ? 'created' : 'planned', sql })
  }
  for (const table of changedTables) await connection.query(`ANALYZE TABLE ${table}`)
  return results
}
