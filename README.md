# Portal GMAC

Sistema de gestão da GMAC Metalúrgica, construído com React, Vite, Node/Express e MySQL.

## Contas a Pagar

O menu inclui **Contas a Pagar**, **Mini BI**, **Classificações** e **Fornecedores**. A gestão usa modais para cadastro, detalhes, baixa total, estorno, anexos e histórico. Cadastre fornecedores e classificações antes de lançar contas. Contas novas podem ser normais, parceladas ou recorrentes; a próxima recorrência sempre exige confirmação e revisão.

Valores são validados em centavos. Duplicidades por fornecedor, valor e vencimento são bloqueadas, inclusive em lançamentos concorrentes. Parcelamentos preservam o total original; a estrutura fica bloqueada enquanto houver parcela paga. Contas pagas só permitem alterações após estorno. Contas com pagamentos anteriores ou vínculos não são apagadas definitivamente. A exclusão de uma conta lançada por engano preserva sua auditoria no histórico geral.

O Mini BI filtra por **vencimento** e agrupa pagamentos pela **data da baixa**, incluindo contas desativadas e valores efetivamente pagos. Os gráficos aplicam filtros na própria tela. PDF e Excel respeitam os filtros ou a seleção atual. Notificações de três dias antes e do dia do vencimento usam o sininho existente; a API verifica vencimentos a cada minuto enquanto estiver em execução e o portal atualiza a lista a cada 30 segundos.

O módulo usa a persistência JSON serializada e os anexos privados em `server/data/`, seguindo o fluxo local já utilizado pelas ofertas/OS. Faça backup dessa pasta; não é enviada ao GitHub. O acesso às contas, anexos, histórico e exportações exige sessão administrativa. Não há contas financeiras fictícias criadas automaticamente.

Validação isolada, sem alterar dados locais: `npm run test:payables`.

## Executar localmente

```bash
npm install
npm run dev
```

Abra [http://localhost:5174](http://localhost:5174). A API usa a porta 3002.

Preencha `.env` a partir de `.env.example`. No modo local, configure `DEMO_ADMIN_CPF` (11 dígitos), `DEMO_ADMIN_PASSWORD` e `DEMO_ADMIN_NAME`. Não há senha padrão. `.env`, dados locais, anexos e resultados de testes não são publicados no Git.

## Ofertas e ordens de serviço

As solicitações inseridas manualmente, propostas e ordens de serviço são gravadas pela API em `server/data/offers.json`. Anexos e PDFs ficam em `server/data/files/` e continuam disponíveis após reiniciar o servidor. O limite por anexo é 20 MB. A tela **Pedidos** lista materiais cuja compra foi solicitada, com acesso à OS relacionada. Materiais novos ficam no pré-cadastro do estoque até a aprovação da compra.

Para usar esse fluxo, inicie o frontend e a API juntos com `npm run dev`. A configuração do MySQL é opcional para ofertas e OS; o estoque e a autenticação continuam usando as integrações já existentes.

## Operadores e apontamento de produção

No login, escolha **Operador** para usar a conta compartilhada. Configure `OPERATOR_USERNAME` (11 dígitos), `OPERATOR_PASSWORD` e `SESSION_SECRET` em `.env`; não há credencial padrão. O admin cadastra as pessoas em **Funcionários**. Ao iniciar uma OS, o operador escolhe seu nome e a máquina utilizada, ou trabalho manual. Para trocar de máquina, pause e inicie uma nova sessão. A sessão só permite registrar peças, pausar ou concluir com sua credencial privada.

As etapas de cada OS vêm da proposta aceita. Cada etapa conta de 0 até a quantidade de peças da OS; uma etapa posterior só pode registrar peças já concluídas na etapa anterior. O sistema grava início, retomada, peças por etapa, pausa com motivo, conclusão e interrupção administrativa, incluindo horário, funcionário e sessão. O tempo ativo acumulado e o tempo da sessão são mostrados na tela do operador. O painel do admin consulta esses dados a cada 10 segundos.

Com MySQL configurado, aplique `database/migrations/003_operator_workflow.sql` em bancos existentes. Funcionários, estado operacional e histórico ficam no MySQL. Sem MySQL, esses dados são persistidos em `server/data/offers.json` para uso local. As ofertas e o conteúdo principal das OS continuam nesse arquivo.

## Configurar o MySQL

1. Copie `.env.example` para `.env` e preencha os dados do banco.
2. Execute `database/schema.sql` no MySQL.
3. Reinicie o servidor com `npm run dev`.

Para bancos existentes, aplique também `database/migrations/004_clients.sql` antes de usar o cadastro e os relatórios de clientes.

## Cadastros e Conta

Clientes e administradores são persistidos pela API: no MySQL quando configurado, ou no arquivo local. Máquinas ficam no arquivo local e o catálogo anterior do navegador é importado uma única vez ao entrar como administrador. Horas e nomes de máquina ficam registrados em cada sessão, inclusive após excluir um cadastro.

Em **Configurações**, cada administrador pode alterar seu nome e senha após confirmar a senha atual. Senhas são armazenadas como hashes e nunca são incluídas em relatórios. O acesso a cadastros administrativos, configurações e relatórios exige a sessão administrativa. Trocas de senha invalidam sessões anteriores; reiniciar a API também exige um novo login.

## Relatórios

- Funcionários, clientes e administradores: informações cadastrais, em PDF e Excel `.xlsx`.
- Horas trabalhadas e horas reais de máquinas: início/fim obrigatórios, seleção individual ou todos, total por cadastro e detalhamento por dia.
- OS: período pela data de criação, dados da solicitação/proposta, materiais, mão de obra, etapas, documentos e histórico de operações.

Horas são calculadas pelos intervalos de sessões, incluindo sessões ativas até a emissão, sem pausas. Intervalos simultâneos da mesma pessoa ou máquina são contados uma vez. Sessões que atravessam a meia-noite são separadas por dia, no fuso `America/Bahia`. Sessões antigas sem máquina não são atribuídas ficticiamente a um equipamento.

## Oferta e Exibição

As novas etapas são agrupadas em Usinagem, Pintura e Caldeiraria. As etapas antigas e os apontamentos de OS já existentes são preservados. Origem da fabricação, têmpera, cor/tipo da pintura e descrição complementar são gravadas nos recursos da oferta, mantidas no PDF e na OS, e disponibilizadas ao operador sem valores financeiros.

No painel de serviços, **Modo de exibição** abre o painel em tela cheia, sem menu e abas. O botão de sair ou `Esc` restaura a tela normal. A atualização dos dados continua a cada 10 segundos.

## Validação

```bash
npm test
npx playwright install chromium
npm run test:browser
```

Os testes usam dados e servidores isolados em `test-results/`; não alteram os registros locais do portal. Demais testes de navegador estão em `tests/*.browser.mjs`. MySQL deve ser validado em uma instância de teste antes de uma implantação.
