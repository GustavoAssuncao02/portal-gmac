# Portal GMAC

Sistema de gestão da GMAC Metalúrgica, construído com React, Vite, Node/Express e MySQL.

## Contas a Pagar

O menu inclui **Contas a Pagar**, **Mini BI**, **Classificações** e **Fornecedores**. A gestão usa modais para cadastro, detalhes, baixa total, estorno, anexos e histórico. Cadastre fornecedores e classificações antes de lançar contas. Contas novas podem ser normais, parceladas ou recorrentes; a próxima recorrência sempre exige confirmação e revisão.

Valores são validados em centavos. Duplicidades por fornecedor, valor e vencimento são bloqueadas, inclusive em lançamentos concorrentes. Parcelamentos preservam o total original; a estrutura fica bloqueada enquanto houver parcela paga. Contas pagas só permitem alterações após estorno. Contas com pagamentos anteriores ou vínculos não são apagadas definitivamente. A exclusão de uma conta lançada por engano preserva sua auditoria no histórico geral.

O Mini BI filtra por **vencimento** e agrupa pagamentos pela **data da baixa**, incluindo contas desativadas e valores efetivamente pagos. Os gráficos aplicam filtros na própria tela. PDF e Excel respeitam os filtros ou a seleção atual. Notificações de três dias antes e do dia do vencimento usam o sininho existente; a API verifica vencimentos a cada minuto enquanto estiver em execução e o portal atualiza a lista a cada 30 segundos.

Os dados do módulo ficam no MySQL; os anexos privados ficam em `server/data/` (ou em `DATA_DIR`), e o banco guarda o nome e o caminho de cada arquivo. Faça backup do banco e dessa pasta; ela não é enviada ao GitHub. O acesso às contas, anexos, histórico e exportações exige sessão administrativa. Não há contas financeiras fictícias criadas automaticamente.

A busca encontra contas também pelo valor ("1.234,56", "1234,56" ou "1234.56") e pelo CPF/CNPJ do fornecedor. Os filtros de situação mostram a quantidade e o total em reais, há atalhos de vencimento (hoje, próximos 7 dias, este mês) e a seleção em massa exibe a soma antes da baixa. Os campos de valor aceitam o formato brasileiro. O fornecedor pode ser cadastrado sem sair do formulário, e a classificação usada por último com ele é sugerida. Na baixa, digitar o valor pago preenche juros ou desconto. Contas recorrentes podem gerar as próximas ocorrências de uma vez (até 24); cada ocorrência é independente, e a oferta de "próxima recorrência" após o pagamento só aparece quando a série acaba. PDFs e imagens anexados podem ser visualizados sem download.

**Custo real por OS:** cada conta pode ser vinculada a uma OS no campo "OS vinculada (custo)". A tela da OS e o Business Intelligence mostram o valor da OS (proposta com desconto), o custo previsto na proposta (materiais + mão de obra), os custos lançados (pagos e a pagar) e a margem real comparada à prevista.

Validação isolada, sem alterar dados locais: `npm run test:payables`, `node --test tests/payables-improvements.test.js` e `node tests/payables-improvements.browser.mjs` (após `npm run build`).

Para popular a demonstração local solicitada de setembro a dezembro de 2026, com a API em execução e as credenciais administrativas locais configuradas, execute `node scripts/seed-payables.mjs`. O script cria 120 contas (30 por mês) e 10 fornecedores fictícios; as contas usam classificações do plano de contas (Gestão Financeira > Classificações) e, sem o plano instalado, 10 classificações de teste. Registros são identificados por `DEMO-CP-2026`; executar novamente não duplica os lançamentos. As baixas nunca usam data futura. A execução não é automática na inicialização do sistema.

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

**Conciliação bancária** importa extratos OFX 1.x (SGML) e 2.x (XML). O conteúdo é lido como UTF-8 estrito e, só quando inválido, pela codificação declarada no cabeçalho; divergências de codificação ficam registradas no lote. Os registros `SALDO ANTERIOR` e `SALDO TOTAL DISPONÍVEL DIA` são guardados como posições de saldo, fora dos totais e da conciliação. A importação é idempotente por empresa (`COMPANY_SCOPE`, padrão `gmac`), banco, conta e FITID. Uma reimportação informa novas e existentes, e um FITID repetido com dados diferentes vira conflito para revisão, sem substituir nada. O fechamento diário agrupa todas as movimentações da data, e a diferença entre o saldo informado (LEDGERBAL) e o calculado fica registrada na validação, sem ajuste artificial; o aviso de divergência só aparece acima de R$ 10,00. O aviso de cabeçalho com codificação diferente de um conteúdo UTF-8 válido não é exibido.

A conciliação sugere candidatos apenas com valor exato, ordenados por evidência: CPF/CNPJ e mesma data; CPF/CNPJ dentro da tolerância configurada; nome semelhante; mesma data; e, por último, **Conferir data**: mesmo CPF/CNPJ, mas com data fora da tolerância (até 90 dias). A data do banco é comparada com a data mais próxima entre a baixa e o vencimento. Candidatos empatados são sinalizados, e o vínculo sempre depende de confirmação manual. Um registro financeiro não participa de duas conciliações integrais, e contas conciliadas não podem ser editadas, estornadas, desativadas ou excluídas sem desfazer o vínculo. Os arquivos originais ficam em `server/data/bank-statements/`. Extratos `.ofx` são ignorados pelo Git.

Validação isolada: `node --test tests/bank-statements.test.js tests/receivables-installments.test.js tests/receivables-features.test.js` e, após `npm run build`, `node tests/finance-receivables.browser.mjs`, `node tests/receivables-installments.browser.mjs` e `node tests/receivables-features.browser.mjs`.

## Modelos de proposta

Ao clicar em **Gerar proposta em PDF**, o usuário escolhe um dos quatro modelos usados pelo comercial. Os dados do sistema já vêm preenchidos:

- **Modelo A** (como a cotação 13482): carta com escopo em tópicos e uma única linha de composição, em destaque.
- **Modelo B** (como a cotação 13357): escopo numerado e composição com cada item e seu valor. Itens com o mesmo grupo (ex.: Obra civil) aparecem juntos, com subtotal.
- **Nestlé** (planilha FS-3055, como a solicitação 2022906): reproduz a planilha do cliente, com códigos SAP.
- **Etiqueta** (como a 5319): planilha de preços com todos os serviços e materiais, frete e total.

Os modelos A e B usam um timbrado com a identidade da GMAC: faixa azul com detalhe laranja no topo e no rodapé, logo à esquerda e o título "Proposta Comercial" à direita. O logo é desenhado em vetor, nítido em qualquer zoom ou impressão. O documento é organizado assim:

- **Identificação em duas colunas.** De um lado, cliente, CNPJ, solicitante e aos cuidados de. Do outro, número da cotação, data, validade (com a data final) e empresa emissora. Campos vazios não aparecem.
- **Identificação fiscal compacta.** CNAE (código de atividade) e NBS (serviço) ou NCM (produto), uma linha cada.
- **Composição e preço global juntos.** O valor global e o valor por extenso ficam num quadro logo após os itens, com os números alinhados à direita.
- **Prazos e condições em quadro.** Prazo de entrega, pagamento e validade; o que não for informado aparece como "A combinar".
- **"Importante" em duas partes.** As condições gerais em tópicos e o fechamento com o técnico responsável e o contato. Os textos são os originais, só com a correção do português. O técnico vem do cadastro da empresa emissora e pode ser trocado no formulário de cada proposta; em branco, a linha não aparece.
- **Rodapé em todas as páginas.** Endereço, telefone, e-mail, site, número da cotação e "Página X de Y". O telefone tem um selo de WhatsApp clicável (`wa.me`), que abre uma conversa já mencionando a cotação. O número vem do campo "WhatsApp" do cadastro da empresa; em branco, o selo não aparece. Um título de seção nunca fica sozinho no fim da página.

A data, o número da cotação (sequencial, a partir da última emitida) e o valor por extenso são preenchidos automaticamente. A empresa emissora pode ser a GMAC Usinagem ou a GMAC Metalúrgica.

Nas planilhas Nestlé e Etiqueta, as horas e os materiais previstos na oferta são lançados nas linhas correspondentes da tabela de preços. Quando uma correspondência é ambígua, o usuário escolhe a linha, e a escolha fica lembrada. O total do documento passa a ser o valor sugerido no Contas a Receber da OS.

Os preços de cada documento são gravados no momento da geração; mudar a tabela depois não altera PDFs já emitidos. Empresas, tabelas de preço, textos padrão e o catálogo fiscal ficam em **Empresas, tabelas de preço e catálogo fiscal**, na escolha do modelo.

O **catálogo fiscal** é atualizado todo domingo à meia-noite (horário da Bahia), a partir destas fontes:

- CNAE: [API do IBGE](https://servicodados.ibge.gov.br/api/v2/cnae/subclasses);
- NBS: CSV oficial do MDIC;
- NCM: BrasilAPI;
- atividades registradas nos CNPJs das duas empresas: BrasilAPI, com a cnpj.ws como reserva.

Uma fonte fora do ar não apaga a versão anterior, e a tentativa se repete em 6 horas. O catálogo também pode ser atualizado manualmente. Ele fica nas tabelas `fiscal_codes` e `fiscal_catalog` do MySQL. Para desligar a atualização automática, use `FISCAL_CATALOG_SYNC=off`.

As fontes Arial, Calibri e Berlin Sans do Windows são usadas quando presentes. Fora do Windows, o sistema usa equivalentes de mesmas medidas: Helvetica e Carlito. O título "Proposta Comercial" usa a Montserrat. Carlito e Montserrat têm licença OFL e ficam em `server/assets/fonts`. O logo vetorial fica em `server/proposalBrand.js`.

Validação: `node --test tests/proposal-documents.test.js` e, após `npm run build`, `node tests/proposal-documents.browser.mjs`.

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

Para testes temporários, `TEST_LOGIN_ENABLED=true` em `.env` permite clicar em **Entrar** como administrador ou operador com os campos vazios. O administrador será a conta cadastrada com o CPF de `DEMO_ADMIN_CPF`, ou o primeiro administrador disponível. As sessões e permissões continuam funcionando normalmente; não são criadas contas fictícias. Todos na rede com acesso ao portal poderão entrar sem senha enquanto essa opção estiver ativa. Para restaurar o login obrigatório, altere para `TEST_LOGIN_ENABLED=false` e reinicie `npm run dev`. O acesso de teste só funciona num portal que roda neste computador: a API escutando só nele (`API_HOST` local, como `127.0.0.1`, o padrão) e o banco nele (`DB_HOST` local, como `127.0.0.1` ou `localhost`), e nunca com `NODE_ENV=production`. Um portal publicado escuta na rede e usa o banco da hospedagem, então continua pedindo a senha mesmo com a opção ativada e o `NODE_ENV` ausente ou digitado errado; o servidor avisa no log que ignorou a opção. Na rede local, o acesso continua passando pelo Vite deste computador.

## Ofertas e ordens de serviço

As solicitações inseridas manualmente, propostas e ordens de serviço são gravadas pela API no MySQL. Anexos e PDFs ficam em `server/data/files/` e continuam disponíveis após reiniciar o servidor. Os anexos não têm limite de tamanho: o arquivo vai direto para o disco, sem passar inteiro pela memória do servidor (o servidor da hospedagem pode ter um limite próprio de upload). A tela **Pedidos** lista materiais cuja compra foi solicitada, com acesso à OS relacionada. Materiais novos ficam no pré-cadastro do estoque até a aprovação da compra.

Para usar esse fluxo, inicie o frontend e a API juntos com `npm run dev`. A configuração do MySQL é opcional para ofertas e OS; o estoque e a autenticação continuam usando as integrações já existentes.

## Operadores e apontamento de produção

No login, escolha **Operador** para usar a conta compartilhada. Configure `OPERATOR_USERNAME` (11 dígitos), `OPERATOR_PASSWORD` e `SESSION_SECRET` em `.env`; não há credencial padrão. O admin cadastra as pessoas em **Funcionários**. Ao iniciar uma OS, o operador escolhe seu nome e a máquina utilizada, ou trabalho manual. Para trocar de máquina, pause e inicie uma nova sessão. A sessão só permite registrar peças, pausar ou concluir com sua credencial privada.

As etapas de cada OS vêm da proposta aceita. Cada etapa conta de 0 até a quantidade de peças da OS; uma etapa posterior só pode registrar peças já concluídas na etapa anterior. O sistema grava início, retomada, peças por etapa, pausa com motivo, conclusão e interrupção administrativa, incluindo horário, funcionário e sessão. O tempo ativo acumulado e o tempo da sessão são mostrados na tela do operador. O painel do admin mostra esses dados em tempo real.

Com MySQL configurado, aplique `database/migrations/003_operator_workflow.sql` em bancos existentes. Funcionários, estado operacional e histórico ficam no MySQL, assim como as ofertas e o conteúdo das OS.

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

Ofertas, conteudo das OS, maquinas, aprovacoes de compra e contas a pagar tambem ficam no MySQL, compartilhados pela mesma API; em `server/data/` ficam so os arquivos enviados (anexos, comprovantes, extratos OFX) e os backups diarios. Faca backup tanto do MySQL quanto dessa pasta. Nao copie a pasta de dados para cada cliente. Este ambiente e de teste em rede confiavel; nao publique a porta do Vite na internet. Se houver bloqueio no Firewall do Windows, permita Node.js/porta TCP 5174 apenas na rede local. Nao desative o firewall.

## Hospedagem (SaveInCloud ou outro servidor)

Em produção, um único processo Node atende a interface e a API no mesmo endereço. A interface é a pasta `dist/`, gerada por `npm run build`; sem ela, só a API responde e o servidor avisa na inicialização.

```bash
npm install
npm start
```

`dist/` não vai para o GitHub. Com `NODE_ENV=production` (ou `BUILD_ON_START=true`), `npm start` (e o `server.js` da raiz, usado por pm2 e forever) instala as dependências quando faltam ou estão mais velhas que o `package-lock.json` (a hospedagem nem sempre roda `npm install` no deploy) e gera a interface sempre que algum arquivo dela for mais novo que o último build (`scripts/ensure-build.mjs`). As chaves `true`/`production` valem com qualquer caixa (`True`, `Production`), como o painel da hospedagem às vezes grava. Por isso Vite, o plugin do React e o PostCSS ficam em `dependencies`: a hospedagem instala só elas em produção. Fora de produção nada muda: o desenvolvimento segue com Vite e os testes geram o próprio build.

Variáveis de ambiente no servidor, além das do banco e das credenciais:

| Variável | Valor na hospedagem | Para quê |
| --- | --- | --- |
| `API_HOST` | `0.0.0.0` | Aceitar conexões de fora do contêiner. O padrão `127.0.0.1` só atende a própria máquina. |
| `PORT` | a porta que a hospedagem encaminha (`8080` no SaveInCloud) | Porta do processo Node. |
| `NODE_ENV` | `production` | Gera a interface no start, bloqueia o acesso de teste sem senha e deixa a API fechada para outros sites. |
| `BUILD_ON_START` | `true` num ambiente de teste sem `NODE_ENV=production` | Gera a interface no start, como em produção. Não libera o acesso sem senha: um portal publicado sempre pede CPF e senha, mesmo com `TEST_LOGIN_ENABLED=true`. |
| `DATA_DIR` | uma pasta fora do código, ex.: `/home/jelastic/portal-data` | Onde ficam os arquivos enviados (anexos, comprovantes, extratos OFX) e os backups diários (padrão `server/data/`). Os dados ficam no MySQL. Um deploy do GitHub substitui o código; fora dele, os arquivos continuam. |
| `TRUST_PROXY` | `1` com um balanceador na frente | Faz o servidor enxergar o IP real de cada usuário. Com o padrão `loopback`, atrás de um balanceador todos os usuários contam como um só IP no limite de requisições. |
| `API_RATE_LIMIT` | `200` ou mais | Requisições por minuto por IP. Usuários da mesma rede saem para a internet com o mesmo IP público e dividem esse limite; aumente se aparecer o erro 429. |
| `UPLOAD_MAX_MB` | `500` (padrão) | Tamanho máximo de cada anexo (desenhos, modelos, fotos, comprovantes). Aumente se a GMAC precisar receber arquivos maiores. |
| `UPLOAD_DISK_RESERVE_MB` | `256` (padrão) | Espaço livre que o disco sempre guarda: um anexo que o ocuparia é recusado, para o portal, os backups e os logs nunca ficarem sem espaço. |

Na entrada da hospedagem (balanceador ou nginx à frente do portal), use limites coerentes com estes: corpo da requisição de pelo menos o `UPLOAD_MAX_MB` (no nginx, `client_max_body_size 500m`), para não cortar anexos que o portal aceita, e tempo de leitura do corpo por inatividade (no nginx, `client_body_timeout 60s`), não por duração total.

As telas se atualizam em tempo real por uma conexão que fica aberta (`GET /api/live`, Server-Sent Events). O servidor manda um sinal de vida a cada 25 s; a entrada da hospedagem precisa deixar essa conexão aberta por mais tempo que isso sem inatividade (no nginx, `proxy_read_timeout` de pelo menos 60s) e sem guardar a resposta antes de repassá-la (o portal já envia `X-Accel-Buffering: no`). Se a conexão cair, o navegador reconecta sozinho e, enquanto isso, as telas voltam a se atualizar pelo relógio, como antes.
| `CORS_ORIGIN` | vazio | Lista de outros sites autorizados a chamar a API. Vazio, em produção, só o próprio portal chama. |

Confirme no painel da hospedagem a porta encaminhada e quantos proxies ficam à frente do contêiner.

**SaveInCloud (Jelastic)**

- Servidor de aplicação Node.js com deploy pelo repositório do GitHub; `PROCESS_MANAGER=npm` faz o contêiner usar `npm start`. Com pm2, o arquivo iniciado é o `server.js` da raiz, que faz o mesmo.
- Banco: MySQL no mesmo ambiente. Em `DB_HOST`, use o endereço interno do nó do banco (IP da rede local do ambiente ou `nodeXXXX-env-XXXX...`), porta `3306`. Crie o banco importando `database/schema.sql` (ou um dump do banco local) pelo phpMyAdmin.
- Sem um administrador na tabela `users`, ninguém entra no portal: leve ao menos o administrador junto com o dump do banco local.
- O MySQL é obrigatório: sem `DB_HOST`, `DB_USER` e `DB_NAME` o portal não sobe. As tabelas são criadas sozinhas no primeiro start. Se a pasta de `DATA_DIR` ainda tiver um `offers.json` ou `fiscal-catalog.json` da versão anterior e o banco estiver vazio, eles são importados para o banco uma única vez (o `offers.json` vai para `backups/`). O catálogo fiscal também é baixado sozinho.
- Na hospedagem não existe login sem senha: o portal escuta na rede (`API_HOST=0.0.0.0`) e usa o MySQL de outro nó, então `TEST_LOGIN_ENABLED=true` é ignorado (o log avisa) mesmo sem `NODE_ENV=production`. Um ambiente de teste publicado (`BUILD_ON_START=true`, sem `NODE_ENV`) entra com CPF e senha e deve usar um banco próprio, nunca o banco da empresa. O login sem senha fica só no portal local.
- Uma reimplantação do contêiner (troca de versão do Node) mantém só as pastas declaradas como volume: inclua a pasta de `DATA_DIR` nos volumes do nó.

**Orçamentos do site gmacmetalurgica.com.br**

O formulário de orçamento do site principal envia para o portal (antes ia para o programa separado "GMAC BACKEND"). O código fica em `server/siteQuotes/` e roda no mesmo processo, publicado em `/gmac`:

- `POST /gmac/api/quotes` (multipart): valida os campos e os anexos e envia um e-mail para comercial@gmacmetalurgica.com.br, com o e-mail do cliente no "Responder para". Nada é gravado no banco nem em disco.
- `GET /gmac/api/health`: `200` com `smtpReady: true` quando o e-mail foi verificado; `503` com `smtpError` (`SMTP_CONFIG_MISSING`, `SMTP_AUTH_DISABLED`, `SMTP_AUTH_FAILED`, `SMTP_CONNECTION_FAILED`) enquanto não puder enviar.
- No site principal, `VITE_API_URL` é o endereço do portal seguido de `/gmac` (o formulário acrescenta `/api/quotes`).
- Variáveis: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` e `QUOTES_ALLOWED_ORIGINS` (veja `.env.example`). Sem `SMTP_PASS` o portal sobe normalmente e só os orçamentos ficam indisponíveis. O SMTP é verificado na partida e, se falhar, de novo a cada minuto.
- Só os sites de `QUOTES_ALLOWED_ORIGINS` podem enviar (padrão: `https://gmacmetalurgica.com.br` e `https://www.gmacmetalurgica.com.br`). Essa rota não usa o `CORS_ORIGIN` nem o limite geral da API: tem limite próprio de 5 envios por IP a cada 15 minutos e 2 envios simultâneos.
- Anexos: até 10 arquivos PDF, DWG, DXF, JPG, JPEG ou PNG, 10 MB cada e 25 MB no total. O balanceador da hospedagem precisa aceitar requisições desse tamanho.
- `npm run check:smtp` testa a conexão, o TLS e o login do e-mail sem enviar nada. `tests/site-quotes.test.js` testa a rota com um envio simulado.

**Desempenho no navegador**

- Respostas de texto (JSON, JavaScript, CSS, HTML) são comprimidas com Brotli ou gzip. Imagens, vídeos, PDFs e planilhas seguem como estão.
- Arquivos em `dist/assets/` têm o conteúdo no nome e ficam no cache do navegador por um ano; um novo build muda o nome, então nunca ficam desatualizados. As bibliotecas (React, ícones) ficam em arquivos separados do código do portal e continuam em cache entre deploys.
- `index.html` e `login-media/manifest.json` são sempre confirmados com o servidor. Fontes ficam 30 dias em cache; logos, fotos e vídeos do login, um dia.
- Os dados da API nunca são guardados por caches intermediários. O navegador confirma a cópia com o servidor a cada consulta e recebe um `304`, sem corpo, quando nada mudou.
- As consultas periódicas das telas param enquanto a aba está oculta e são refeitas no instante em que ela volta a aparecer.
- No `localStorage` ficam só conveniências do aparelho: uma cópia das preferências de aparência de cada conta (tema, tamanho e tipo de letra; a original fica no banco) e quais avisos sonoros já tocaram. A sessão e o estado das abas ficam no `sessionStorage` e somem ao fechar a aba. Estoque, máquinas, ofertas, OS, clientes e contas a pagar e a receber não são gravados no navegador.
- A fonte escolhida na conta começa a ser baixada junto com a página, antes dos estilos.

**Segurança**

- Todas as respostas levam `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy` (`frame-ancestors`, `base-uri`, `form-action`), `Referrer-Policy` e `Permissions-Policy`. Com HTTPS, também `Strict-Transport-Security`.
- O cabeçalho `X-Powered-By` não é enviado.

**Antes de abrir o portal para a internet**

- Todas as rotas que alteram ou mostram dados internos exigem sessão. A conta do operador alcança só o que o painel de produção usa: arquivos e histórico da OS, máquinas e serviços de mão de obra. Ficam abertos apenas o login, a configuração do login, `/api/health` e os orçamentos do site principal (`/gmac/api/quotes`, só para os sites de `QUOTES_ALLOWED_ORIGINS`, e `/gmac/api/health`). O teste `tests/access-control.test.js` confere isso.
- Sessões e o limite de requisições ficam na memória do processo: use uma única instância. Reiniciar o servidor exige novo login.
- Todos os dados ficam no MySQL. `server/data/` (ou a pasta de `DATA_DIR`) guarda só os arquivos enviados (anexos, comprovantes, extratos) e os backups diários. A pasta precisa sobreviver a cada deploy e entrar no backup, junto com o MySQL.

**Backup**

- O servidor exporta sozinho, uma vez por dia, os dados do portal (ofertas, OS, financeiro, cadastros) do MySQL para `server/data/backups/auto-AAAA-MM-DD.json` e mantém os últimos 30 dias. Ela ajuda a desfazer uma alteração errada, mas fica no mesmo disco.
- Na hospedagem, programe também uma cópia **fora do servidor**: a pasta `server/data/` inteira (com os anexos) e um dump do MySQL (`mysqldump`), pelo menos uma vez por dia.

## Cadastros e Conta

Clientes, administradores e máquinas são persistidos pela API no MySQL. Horas e nomes de máquina ficam registrados em cada sessão, inclusive após excluir um cadastro.

Em **Configurações**, cada administrador pode alterar seu nome e senha após confirmar a senha atual. Senhas são armazenadas como hashes e nunca são incluídas em relatórios. O acesso a cadastros administrativos, configurações e relatórios exige a sessão administrativa. Trocas de senha invalidam sessões anteriores; reiniciar a API também exige um novo login.

Ao recarregar a página, a sessão administrativa válida é confirmada pelo servidor e a tela aberta é restaurada, sem pedir a senha novamente. A validade continua sendo de 12 horas; **Sair** encerra a sessão e limpa o estado salvo. Indisponibilidade temporária da API permite tentar novamente sem apagar a credencial. Senhas e dados de conta não são usados como prova de autenticação no navegador.

## Relatórios

- Funcionários, clientes e administradores: informações cadastrais, em PDF e Excel `.xlsx`.
- Horas trabalhadas e horas reais de máquinas: início/fim obrigatórios, seleção individual ou todos, total por cadastro e detalhamento por dia.
- OS: período pela data de criação, dados da solicitação/proposta, materiais, mão de obra, etapas, documentos e histórico de operações.

Horas são calculadas pelos intervalos de sessões, incluindo sessões ativas até a emissão, sem pausas. Intervalos simultâneos da mesma pessoa ou máquina são contados uma vez. Sessões que atravessam a meia-noite são separadas por dia, no fuso `America/Bahia`. Sessões antigas sem máquina não são atribuídas ficticiamente a um equipamento.

## Oferta e Exibição

As novas etapas são agrupadas em Usinagem, Pintura e Caldeiraria. As etapas antigas e os apontamentos de OS já existentes são preservados. Origem da fabricação, têmpera, cor/tipo da pintura e descrição complementar são gravadas nos recursos da oferta, mantidas no PDF e na OS, e disponibilizadas ao operador sem valores financeiros.

No painel de serviços, **Modo de exibição** abre o painel em tela cheia, sem menu e abas. O botão de sair ou `Esc` restaura a tela normal. A atualização dos dados continua em tempo real.

## Validação

```bash
npm test
npx playwright install chromium
npm run test:browser
```

Os testes usam dados e servidores isolados em `test-results/`; não alteram os registros locais do portal. Demais testes de navegador estão em `tests/*.browser.mjs`. MySQL deve ser validado em uma instância de teste antes de uma implantação.
