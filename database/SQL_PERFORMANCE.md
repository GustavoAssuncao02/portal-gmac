# Otimização das consultas

As respostas da API, regras de acesso, autenticação, transações e histórico completo são preservados. Não há cache de dados ou paginação nova.

## Banco já existente

Execute com o `.env` do banco que deseja otimizar:

```powershell
npm run db:optimize
npm run db:optimize -- --apply
```

O primeiro comando apenas lista os índices faltantes. O segundo cria três índices não únicos, sem modificar registros:

- `inventory_movements(order_code, movement_type)`: busca de saídas por OS.
- `order_operation_events(order_code, seq)`: histórico da OS na ordem de gravação.
- `order_operation_events(occurred_at, seq)`: histórico filtrado por período.

O procedimento pode ser repetido: índices já presentes são mantidos. A criação solicita `ALGORITHM=INPLACE, LOCK=NONE`, com espera por metadados limitada a 10 segundos. Se o banco não suportar essa operação, o comando falha em vez de usar uma criação que bloqueia gravações. Depois da criação, `ANALYZE TABLE` atualiza as estatísticas das tabelas afetadas. Execute novamente após resolver a causa; índices já criados serão reconhecidos. O `schema.sql` inclui os índices para bancos novos.

## Consultas

- Estados e eventos são consultados apenas para as OS solicitadas, em lotes de até 500 códigos parametrizados, mantendo todo o histórico de cada OS.
- A busca de atividades materializa uma vez o conjunto de sessões do funcionário. A data filtra os eventos finais, preservando interrupções ligadas a sessões iniciadas antes do período.
- Listagens públicas de administradores não carregam hashes de senha; autenticação e alteração de senha continuam carregando os campos privados.
- O histórico de estoque é agrupado uma vez em memória, preservando a ordenação recebida do SQL.

## Verificação

```powershell
node --test tests/sql-performance.test.js tests/employee-activity.test.js tests/machine-availability.test.js tests/reports.test.js tests/order-editing.test.js tests/process-mode.test.js tests/operator-machine-change.test.js
node tests/sql-performance.mysql.mjs
```

O teste MySQL cria e remove exclusivamente um banco temporário `gmac_test_sql_<uuid>` e exige permissão para isso. Compara as consultas antigas e novas, casos de sessões legadas e limites de datas, planos `EXPLAIN` e tempos de consulta com 6.003 eventos sintéticos.

Para comparar a API local antes/depois, `node scripts/check-sql-api.mjs --record` registra hashes de 60 respostas no conjunto atual; `node scripts/check-sql-api.mjs` confere a equivalência. O número depende dos funcionários cadastrados. O teste requer o acesso de teste já habilitado. Campos de tempo decorrido e horário de geração são excluídos da comparação; tokens e dados comerciais não são gravados no arquivo de hashes.
