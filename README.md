# Portal GMAC

Sistema de gestão da GMAC Metalúrgica, construído com React, Vite, Node/Express e MySQL.

## Contas a Pagar

O menu inclui **Contas a Pagar**, **Mini BI**, **Classificações** e **Fornecedores**. A gestão usa modais para cadastro, detalhes, baixa total, estorno, anexos e histórico. Cadastre fornecedores e classificações antes de lançar contas. Contas novas podem ser normais, parceladas ou recorrentes; a próxima recorrência sempre exige confirmação e revisão.

Valores são validados em centavos. Duplicidades por fornecedor, valor e vencimento são bloqueadas, inclusive em lançamentos concorrentes. Parcelamentos preservam o total original; a estrutura fica bloqueada enquanto houver parcela paga. Contas pagas só permitem alterações após estorno. Contas com pagamentos anteriores ou vínculos não são apagadas definitivamente. A exclusão de uma conta lançada por engano preserva sua auditoria no histórico geral.

O Mini BI filtra por **vencimento** e agrupa pagamentos pela **data da baixa**, incluindo contas desativadas e valores efetivamente pagos. Os gráficos aplicam filtros na própria tela. PDF e Excel respeitam os filtros ou a seleção atual. Notificações de três dias antes e do dia do vencimento usam o sininho existente; a API verifica vencimentos a cada minuto enquanto estiver em execução e o portal atualiza a lista a cada 30 segundos.

O módulo usa a persistência JSON serializada e os anexos privados em `server/data/`, seguindo o fluxo local já utilizado pelas ofertas/OS. Faça backup dessa pasta; não é enviada ao GitHub. O acesso às contas, anexos, histórico e exportações exige sessão administrativa. Não há contas financeiras fictícias criadas automaticamente.

A busca encontra contas também pelo valor ("1.234,56", "1234,56" ou "1234.56") e pelo CPF/CNPJ do fornecedor. Os filtros de situação mostram a quantidade e o total em reais, há atalhos de vencimento (hoje, próximos 7 dias, este mês) e a seleção em massa exibe a soma antes da baixa. Os campos de valor aceitam o formato brasileiro. O fornecedor pode ser cadastrado sem sair do formulário, e a classificação usada por último com ele é sugerida. Na baixa, digitar o valor pago preenche juros ou desconto. Contas recorrentes podem gerar as próximas ocorrências de uma vez (até 24); cada ocorrência é independente, e a oferta de "próxima recorrência" após o pagamento só aparece quando a série acaba. PDFs e imagens anexados podem ser visualizados sem download.

**Custo real por OS:** cada conta pode ser vinculada a uma OS no campo "OS vinculada (custo)". A tela da OS e o Business Intelligence mostram o valor da OS (proposta com desconto), o custo previsto na proposta (materiais + mão de obra), os custos lançados (pagos e a pagar) e a margem real comparada à prevista.

Validação isolada, sem alterar dados locais: `npm run test:payables`, `node --test tests/payables-improvements.test.js` e `node tests/payables-improvements.browser.mjs` (após `npm run build`).

Para popular a demonstração local solicitada de setembro a dezembro de 2026, com a API em execução e as credenciais administrativas locais configuradas, execute `node scripts/seed-payables.mjs`. O script cria 120 contas (30 por mês), 10 fornecedores fictícios e 10 classificações de teste. Registros são identificados por `DEMO-CP-2026`; executar novamente não duplica os lançamentos. As baixas nunca usam data futura. A execução não é automática na inicialização do sistema.

## Contas a Receber e conciliação bancária

**Contas a Receber** segue as regras de Contas a Pagar: IDs `REC-`, baixa com juros ou desconto, estorno com motivo, histórico e exportação em PDF/Excel. Ao clicar em **Concluído** num serviço finalizado, um modal programa o recebimento da OS. O valor sugerido é o valor da proposta com o desconto aplicado, e pode ser alterado; a conclusão sem programar continua disponível. Cada OS gera no máximo uma conta a receber (ou um parcelamento).

A data prevista de recebimento (inclusive de cada parcela) não pode ser anterior à data de emissão do documento; datas passadas são aceitas quando a emissão também é anterior. Em **Recebimento parcelado**, um único documento é dividido em 2 a 120 parcelas mensais. Os valores e as datas sugeridos podem ser ajustados, e a soma precisa ser exatamente igual ao total. Enquanto nenhuma parcela foi recebida, o parcelamento pode ser reestruturado ou excluído por inteiro. Depois disso, valores e datas ficam bloqueados até o estorno. O parcelamento também está disponível ao programar o recebimento na conclusão da OS.

Em **Contrato recorrente** (mensal ou anual), as próximas ocorrências são geradas na hora (até 24), e cada uma pode ser editada ou recebida separadamente. Os anexos do contrato ficam na primeira ocorrência. NF, boleto e contrato podem ser anexados e visualizados enquanto a conta está em aberto. Os comprovantes enviados na baixa acompanham o recebimento. Na baixa, informar o **Valor recebido** calcula juros ou desconto. Contas selecionadas podem receber baixa em massa, sem ajustes. A lista tem:

- busca por valor (`1.500,00`) e por CPF/CNPJ do cliente;
- filtros de situação com quantidade e total em reais;
- atalhos de vencimento (hoje, próximos 7 dias e este mês);
- ordenação pelas colunas;
- paginação de 20, 50 ou 100 contas.

O cliente pode ser cadastrado sem sair do formulário. O sininho avisa sobre contas a receber que vencem em breve ou já venceram. A antecedência é configurada por administrador em **Minha conta › Contas a receber a vencer** (3, 5 ou 7 dias, ou nunca).

**Conciliação bancária** importa extratos OFX 1.x (SGML) e 2.x (XML). O conteúdo é lido como UTF-8 estrito e, só quando inválido, pela codificação declarada no cabeçalho; divergências de codificação ficam registradas no lote. Os registros `SALDO ANTERIOR` e `SALDO TOTAL DISPONÍVEL DIA` são guardados como posições de saldo, fora dos totais e da conciliação. A importação é idempotente por empresa (`COMPANY_SCOPE`, padrão `gmac`), banco, conta e FITID. Uma reimportação informa novas e existentes, e um FITID repetido com dados diferentes vira conflito para revisão, sem substituir nada. O fechamento diário agrupa todas as movimentações da data, e a diferença entre o saldo informado (LEDGERBAL) e o calculado aparece como ressalva, sem ajuste artificial.

A conciliação sugere candidatos apenas com valor exato, ordenados por evidência: CPF/CNPJ e mesma data; CPF/CNPJ dentro da tolerância configurada; nome semelhante; mesma data; e, por último, **Conferir data**: mesmo CPF/CNPJ, mas com data fora da tolerância (até 90 dias). A data do banco é comparada com a data mais próxima entre a baixa e o vencimento. Candidatos empatados são sinalizados, e o vínculo sempre depende de confirmação manual. Um registro financeiro não participa de duas conciliações integrais, e contas conciliadas não podem ser editadas, estornadas, desativadas ou excluídas sem desfazer o vínculo. Os arquivos originais ficam em `server/data/bank-statements/`. Extratos `.ofx` são ignorados pelo Git.

Validação isolada: `node --test tests/bank-statements.test.js tests/receivables-installments.test.js tests/receivables-features.test.js` e, após `npm run build`, `node tests/finance-receivables.browser.mjs`, `node tests/receivables-installments.browser.mjs` e `node tests/receivables-features.browser.mjs`.

## Tela de login

O painel da esquerda mostra fotos e vídeos da oficina, desfocados e com zoom lento, trocados em ordem aleatória com uma transição azulada. Logo e textos ficam por cima, em HTML. Para trocar as mídias, coloque imagens (`.jpg`, `.png`, `.webp`) e vídeos (`.mp4`, `.webm`) na pasta `Midia/` e execute `npm run login-media`: as fotos são otimizadas em WebP e tudo é publicado em `public/login-media/`, com o `manifest.json` lido pela tela. Com a preferência "reduzir movimento" do sistema operacional, o painel mostra só fotos, sem zoom.

## Executar localmente

```bash
npm install
npm run dev
```

Abra [http://localhost:5174](http://localhost:5174). A API usa a porta 3002.

`npm run dev` inicia frontend e backend juntos, identificados no terminal como `FRONTEND` e `BACKEND`. O terminal mostra automaticamente os endereços de acesso deste computador e da rede local (por exemplo, `http://192.168.1.100:5174`). Use o endereço real exibido para acessar de outros computadores no mesmo Wi-Fi. `Ctrl+C` encerra os dois serviços; se um deles falhar, o outro também é encerrado. A porta da API é definida por `PORT` em `.env`, e o proxy do frontend acompanha essa configuração.

Preencha `.env` a partir de `.env.example`. No modo local, configure `DEMO_ADMIN_CPF` (11 dígitos), `DEMO_ADMIN_PASSWORD` e `DEMO_ADMIN_NAME`. Não há senha padrão. `.env`, dados locais, anexos e resultados de testes não são publicados no Git.

Para testes temporários, `TEST_LOGIN_ENABLED=true` em `.env` permite clicar em **Entrar** como administrador ou operador com os campos vazios. O administrador será a conta cadastrada com o CPF de `DEMO_ADMIN_CPF`, ou o primeiro administrador disponível. As sessões e permissões continuam funcionando normalmente; não são criadas contas fictícias. Todos na rede com acesso ao portal poderão entrar sem senha enquanto essa opção estiver ativa. Para restaurar o login obrigatório, altere para `TEST_LOGIN_ENABLED=false` e reinicie `npm run dev`. O acesso de teste é sempre bloqueado com `NODE_ENV=production`, mesmo se a opção estiver ativada.

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

## Testar na rede local

O Vite atende em todas as interfaces na porta 5174. Outros computadores na mesma rede devem abrir `http://IP-DESTE-COMPUTADOR:5174`. No servidor, `http://localhost:5174` continua funcionando. O IP pode mudar se o roteador atribuir outro endereco.

Preencha as credenciais MySQL em `.env` e execute `npm run db:setup` antes de iniciar `npm run dev`. O preparo cria o banco dedicado `portal_gmac`, faz backup de `server/data/offers.json` e importa funcionarios, administradores, clientes e historicos/estados de operacao. O comando nao sobrescreve tabelas ja populadas; uma importacao concluida nao se repete. A conta local principal mantem seu login e senha. Campos cadastrais ausentes dessa conta de demonstracao recebem data/e-mail ficticios.

Frontend e API precisam permanecer executando neste computador, com o MySQL80 ativo. A API fica em `127.0.0.1:3002` e o frontend encaminha `/api` para ela. Nao e necessario abrir a porta 3306 nem instalar MySQL nos computadores clientes. Confira a conexao real em `/api/health`: `databaseConnected: true`.

As rotas `/api` aceitam ate 200 requisicoes por minuto por IP, somadas entre todas as rotas, incluindo login. Ao atingir o limite, retornam HTTP 429 com `Retry-After`. O proxy local encaminha o IP real de cada computador e substitui cabecalhos de encaminhamento enviados pelo cliente. Arquivos da interface nao entram nessa contagem. A contagem fica na memoria de cada processo da API e reinicia com o servidor; para usar varias instancias, sera necessario um armazenamento compartilhado. Em outro proxy de producao, configure explicitamente os enderecos confiaveis e a substituicao de `X-Forwarded-For`.

O estoque anterior do navegador e copiado para a chave local `gmac-inventory-before-mysql` antes da primeira importacao. Materiais ausentes sao importados para o MySQL; saldos ja existentes no servidor nao sao sobrescritos por caches de outros computadores. Um navegador novo so inicializa o catalogo de demonstracao quando o estoque compartilhado esta vazio. Edicoes e entradas usam os IDs e saldos retornados pelo servidor; a tela consulta o estoque a cada 10 segundos.

Ofertas, conteudo das OS, maquinas, aprovacoes de compra e contas a pagar continuam em `server/data/`, agora compartilhados pela mesma API. A primeira sessao administrativa importa aprovacoes validas do navegador sem apagar as de outros computadores; novas aprovacoes sao persistidas no servidor e consultadas a cada 10 segundos. Portanto, faca backup tanto do MySQL quanto dessa pasta, incluindo anexos. Nao copie a pasta de dados para cada cliente. Este ambiente e de teste em rede confiavel; nao publique a porta do Vite na internet. Se houver bloqueio no Firewall do Windows, permita Node.js/porta TCP 5174 apenas na rede local. Nao desative o firewall.

## Cadastros e Conta

Clientes e administradores são persistidos pela API: no MySQL quando configurado, ou no arquivo local. Máquinas ficam no arquivo local e o catálogo anterior do navegador é importado uma única vez ao entrar como administrador. Horas e nomes de máquina ficam registrados em cada sessão, inclusive após excluir um cadastro.

Em **Configurações**, cada administrador pode alterar seu nome e senha após confirmar a senha atual. Senhas são armazenadas como hashes e nunca são incluídas em relatórios. O acesso a cadastros administrativos, configurações e relatórios exige a sessão administrativa. Trocas de senha invalidam sessões anteriores; reiniciar a API também exige um novo login.

Ao recarregar a página, a sessão administrativa válida é confirmada pelo servidor e a tela aberta é restaurada, sem pedir a senha novamente. A validade continua sendo de 12 horas; **Sair** encerra a sessão e limpa o estado salvo. Indisponibilidade temporária da API permite tentar novamente sem apagar a credencial. Senhas e dados de conta não são usados como prova de autenticação no navegador.

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
