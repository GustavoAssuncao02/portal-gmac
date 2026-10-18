# Portal GMAC: contexto do sistema para uma IA

**Atualizado em:** 06/10/2026.  
**Projeto:** Portal GMAC, sistema interno da GMAC Metalúrgica.  
**Finalidade:** explicar o funcionamento atual para orientar novas solicitações, sem perder regras, integrações ou funcionalidades existentes.

> Leia este documento como contexto antes de propor ou implementar uma alteração. A solicitação específica será enviada junto dele ou depois dele. Não interprete a descrição dos módulos como uma ordem para reconstruir o portal inteiro.
>
> Este documento substitui, como referência atual, `ENTENDIMENTO_PORTAL_GMAC.txt`. O TXT contém descrições antigas, funções que eram futuras e comportamentos que já foram substituídos. Este Markdown foi atualizado a partir do código; não é uma certificação de que todas as telas foram novamente testadas nesta data.

## 1. Como a IA deve usar este contexto

1. Entenda o pedido novo e identifique os módulos afetados antes de alterar o código.
2. Confira o código atual: este documento é uma fotografia do projeto, não substitui a inspeção dos arquivos.
3. Preserve os dados existentes, os vínculos e os históricos. Não recrie o banco nem zere registros para implementar uma funcionalidade.
4. Não invente regras de negócio. Se houver dúvida que altere o resultado esperado, pergunte ao responsável pelo projeto.
5. Diferencie comportamento implementado, configuração temporária de teste e ponto de atenção ainda não resolvido.
6. Faça mudanças específicas e compatíveis com a estrutura existente. Não aproveite o pedido para redesenhar tudo ou fazer refatorações sem necessidade.
7. Teste o fluxo completo afetado, não apenas o build ou a aparência de um botão.
8. Não faça commit, push ou publicação sem solicitação explícita. Não sobrescreva alterações de outras pessoas.
9. Nunca inclua senhas, tokens, credenciais ou dados pessoais reais em documentação, exemplos ou commits.

## 2. Visão geral

O portal centraliza a operação e a administração de uma metalúrgica:

- Cadastro de clientes, fornecedores, funcionários e administradores.
- Cadastro de máquinas e serviços de hora homem, com valores por hora e históricos de utilização.
- Estoque de materiais em kg, entradas, saídas, custo médio e vínculo com OS.
- Solicitações de serviços, detalhamento de recursos e propostas comerciais.
- Geração, acompanhamento, edição, conclusão e reabertura de ordens de serviço.
- Apontamentos reais de trabalho feitos pelo operador.
- Pedidos de material, vinculados ou não a uma oferta/OS.
- Contas a pagar, Business Intelligence e classificações financeiras.
- Relatórios em PDF e Excel, notificações e preferências individuais.

**Fluxo principal:**

```text
Oferta manual
  -> Detalhamento: materiais, mão de obra, etapas e processo
  -> Proposta A/B/C/D e geração do PDF
  -> Aceite da proposta
  -> OS criada + baixa do estoque disponível
  -> Operador inicia, registra produção, pausa ou troca recursos
  -> Operador conclui todas as peças em todas as etapas
  -> Administração confirma a conclusão no painel
  -> Serviço aparece em Serviços concluídos
```

**Fluxo complementar de material faltante:**

```text
Falta identificada na oferta/OS
  -> Pedido de material
  -> Registrar entrada ou recusar o pedido
  -> Se recebido para uma OS: entrada no estoque + saída para essa OS
  -> Pendência reduzida ou resolvida, com histórico preservado
```

## 3. Perfis e acesso

### Administrador

- Acessa os módulos administrativos e financeiros.
- Gerencia cadastros, recursos, propostas, OS, estoque, pedidos e relatórios.
- Recebe notificações conforme suas preferências individuais.
- Altera nome, senha e aparência da própria conta em Configurações.

### Funcionário administrativo

- Cadastrado em **Funcionários** com o tipo **Administrativo** e uma senha (6 a 72 caracteres).
- Entra pela mesma tela de login do administrador, com CPF e senha, e usa o sistema administrativo normal, **exceto o grupo Gestão Financeira** (Contas a Pagar, Contas a Receber, Tesouraria, Baixa em Lote, Conciliação bancária, Business Intelligence e Classificações). O grupo some do menu, as telas não abrem e a tela inicial não mostra o resumo de contas a pagar.
- O backend também bloqueia essas telas (`restrictStaffFinance`, resposta 403). Continuam liberadas as etapas financeiras que ficam dentro de outras telas: Fornecedores (em Cadastros), custo da OS, lançamento a receber ao concluir a OS e o financeiro da compra de estoque. Para esse perfil, `GET /api/payables` devolve fornecedores e classificações sem as contas.
- Não recebe notificações de contas a pagar ou a receber.
- No servidor, a sessão tem o papel `staff` e o id `employee-<id do funcionário>`, para não se misturar com os ids dos administradores nas preferências.
- Por decisão do usuário, por enquanto ele pode acessar o cadastro de Administradores.
- Trocar o tipo, a senha ou excluir o funcionário encerra as sessões abertas dele.

### Operador

- Usa uma conta compartilhada de acesso à área operacional (tablet ou computador).
- Ao abrir a conta compartilhada, aparece **Entrar**: o funcionário digita o código de 4 dígitos dele e só então vê as OS. O nome não é mais escolhido em uma lista.
- O código é definido no cadastro do funcionário com o tipo **Operador** (único entre os operadores; o botão **Gerar código** sugere um livre) e pode ser alterado por administradores e funcionários administrativos. Na primeira inicialização após a mudança, os operadores já cadastrados receberam um código automático, que aparece na coluna **Acesso** da lista de funcionários.
- O operador identificado fica guardado na sessão do navegador até clicar em **Trocar operador** (volta para **Entrar** sem sair da conta compartilhada) ou em **Sair** (sai da conta compartilhada).
- O que acontece depois da identificação está provisório: o usuário vai reformular esse fluxo.
- Seleciona a máquina ou o serviço de hora homem efetivamente utilizado (um dos dois, não ambos).
- Registra quantidades por etapa, pausa, troca recursos e conclui o trabalho.
- Recebe dados operacionais da OS, sem os valores comerciais internos no retorno específico da área do operador.
- Cada sessão de trabalho tem uma credencial própria. A conta compartilhada não elimina a identificação do funcionário nem a proteção da sessão ativa.

### Login normal

- Administrador: CPF de 11 dígitos e senha, validados no backend.
- Funcionário administrativo: CPF de 11 dígitos e senha, na mesma tela do administrador.
- Operador: usuário compartilhado de 11 dígitos e senha configurados no servidor; depois, o código de 4 dígitos de cada funcionário (`POST /api/operations/operator/identify`).
- Senhas dos administradores cadastrados são armazenadas como hashes; não são exportadas em relatórios.
- O link de recuperação orienta entrar em contato com a administração; não há recuperação automática por e-mail descrita como implementada.
- A sessão administrativa dura 12 horas e é restaurada ao recarregar, enquanto ainda for válida.
- O token do operador dura 8 horas. O navegador conserva a sessão no recarregamento.
- Reiniciar a API invalida as sessões administrativas, que ficam em memória. Não confundir persistência ao recarregar a página com persistência após reiniciar o servidor.

### Modo temporário de teste

Na configuração local consultada nesta atualização, `TEST_LOGIN_ENABLED=true`.

- Nos dois perfis, clicar em **Entrar** permite acesso com os campos vazios.
- O backend ainda emite os tokens usados pelo sistema; não é apenas uma simulação visual de login.
- Com o CPF vazio, o administrador usado é o cadastro correspondente a `DEMO_ADMIN_CPF`, se encontrado, ou o primeiro administrador disponível.
- Com um CPF digitado (senha vazia), o CPF escolhe o perfil: **00000000000** entra como administrador (conta "GMAC") e **11111111111** como funcionário administrativo (cadastro "Teste Administrativo", tipo Administrativo, senha aleatória que só serve no modo de teste). Qualquer outro CPF cadastrado entra na própria conta; CPF desconhecido recebe 401.
- Não é criado um administrador fictício automaticamente. Se não existir cadastro, o backend informa o problema.
- A tela consulta `/api/auth/config`. Em falha temporária, repete a consulta a cada 2 segundos, sem ficar presa na validação obrigatória dos campos. O backend continua decidindo se o acesso é permitido.
- O modo de teste não dispensa o código do operador nem a validação da credencial da sessão de trabalho.
- Alteração de nome/senha em Configurações continua pedindo a senha atual: o modo temporário modifica a entrada no portal, não todas as verificações de segurança.
- Para voltar ao login obrigatório: `TEST_LOGIN_ENABLED=false` no `.env` e reiniciar o projeto.
- Com `NODE_ENV=production`, o acesso sem senha é bloqueado mesmo se a opção estiver ativada.

**Atenção:** enquanto esse modo estiver ativo, qualquer pessoa com acesso ao portal na rede pode entrar como administrador. É uma configuração temporária para ambiente confiável de testes, não uma configuração de produção.

## 4. Navegação e estrutura das telas

### Menu atual

```text
Início
Máquinas
Serviços
Estoque
Pedidos de material
Calculadora de pesos e medidas
Cadastros
    Fornecedores
    Administradores
    Funcionários
    Clientes
Serviços em andamento
Serviços concluídos
Ofertas e serviços
Gestão Financeira
    Contas a Pagar
    Contas a Receber
    Tesouraria
    Baixa em Lote
    Conciliação bancária
    Business Intelligence
    Classificações
Relatórios
Configurações
```

- **Início** é o nome visível do antigo Dashboard.
- **Pedidos de material** aparece logo abaixo de Estoque.
- **Serviços**, abaixo de Máquinas, é o catálogo de atividades cobradas por hora homem. Não é a lista de OS em andamento.
- Peças e serviços, Produção e Qualidade não são destinos atuais do menu. Não reintroduzi-los com base no TXT antigo.
- Internamente, algumas chaves antigas foram preservadas: `Dashboard` é exibido como Início, e `Pedidos` como Pedidos de material.
- Os grupos Cadastros e Gestão Financeira podem ser expandidos ou recolhidos.

### Abas e cabeçalho global

- Telas administrativas abrem em abas superiores, com aba ativa destacada.
- As abas podem ser fechadas individualmente e reordenadas por arraste.
- Deve permanecer uma tela disponível; fechar todas retorna ao Início.
- Com mais de 3 abas, aparece o botão de fechar todas.
- As setas de navegação aparecem somente quando as abas ultrapassam o espaço disponível. O botão de fechar todas fica à direita dos controles de rolagem.
- O cabeçalho contém o sino de notificações e o relógio/data global.
- Não duplicar sino e relógio nos cabeçalhos internos das telas.

## 5. Início

É a primeira tela administrativa após entrar, com saudação pelo primeiro nome da conta.

- Resumos de OS abertas, em execução, atrasadas e ofertas em análise.
- Lista de OS abertas com os prazos mais próximos primeiro e acesso aos detalhes.
- Resumo dos materiais com estoque baixo, servindo de atalho para Estoque.
- Atalho destacado para a calculadora de pesos e medidas.
- Resumos de contas a pagar que abrem a lista financeira com os filtros correspondentes.
- Área de atenção da gestão, incluindo pendências e pedidos de material.
- Dados provenientes dos módulos do portal, não indicadores fixos apenas decorativos.

## 6. Cadastros

| Cadastro | Informações principais | Observações |
| --- | --- | --- |
| Funcionários | Tipo (Operador ou Administrativo), nome, CPF, nascimento e e-mail (opcionais), identificação de 3 dígitos; código de acesso de 4 dígitos (operador) ou senha (administrativo) | Nascimento e e-mail são opcionais só para funcionários (colunas `birth_date` e `email` aceitam nulo, ajustadas na inicialização); administradores continuam exigindo os dois. Os 20 funcionários importados da listagem do RH (16/10/2026) usam como código de acesso o **Nº identificador** da folha com 4 dígitos (identificador 6 → `0006`). A identificação preserva zeros à esquerda, como `001`. Criar, editar e excluir exigem login de administrador ou de funcionário administrativo. A lista pública de funcionários nunca devolve código nem senha; o código aparece só para quem está logado no sistema administrativo. Colunas no MySQL: `employee_type`, `access_code` e `password_hash`, criadas automaticamente na inicialização (`ensureEmployeeAccess`). |
| Administradores | Nome, nascimento, CPF, e-mail, senha | Cadastro, edição e exclusão; senha nova pode ser omitida na edição para manter a atual. |
| Clientes | Nome/razão social, tipo de documento, CPF/CNPJ, e-mail (opcional), observação | Formatação e validação da quantidade de dígitos do documento. O e-mail é opcional (gravado como NULL; a coluna é ajustada na inicialização). Os 175 clientes da planilha `CLIENTES_CNPJ_ATUALIZADO.xlsx` (16/10/2026; só o "CLIENTE AVULSO", sem documento, e a linha repetida da GAZIN ficaram de fora) entraram com razão social, CNPJ e, quando diferente da razão social, o nome fantasia na observação. |
| Fornecedores | Nome/razão social, CPF/CNPJ, e-mail, telefone | Usados nas contas a pagar; a exclusão é impedida quando há contas vinculadas. Os 411 fornecedores da listagem do sistema antigo (16/10/2026) foram importados só com nome e CPF/CNPJ. |

Os registros são persistidos pelo backend. Não tratar Administradores e Clientes como telas meramente demonstrativas, como dizia o documento antigo.

As listas de cadastro (Funcionários, Clientes, Administradores e Fornecedores) usam `src/RegistryList.jsx`: busca por nome, CPF/CNPJ, e-mail (e nome fantasia/código), contagem, ordenação nos títulos e CPF/CNPJ formatado com a etiqueta do tipo; a coluna do nome fica com a maior parte da largura. Clientes e fornecedores aceitam CPF ou CNPJ.

Em 16/10/2026 saíram os dados de teste: os 10 clientes `@clientes-teste.invalid` (substituídos pelos da planilha; as contas a receber de demonstração foram religadas pelo CNPJ ou ficaram sem vínculo), os funcionários Ana/Bruno/Carla Teste, os 10 fornecedores "(Fictício)" com as 120 contas a pagar de demonstração, e o sufixo "(Teste)" das classificações. Depois foram apagados também todas as ofertas/propostas, OS (com o histórico de trabalho no MySQL), pedidos de material, contas a receber, o estoque e os extratos bancários importados; a numeração das propostas continua (13502). As cópias de antes ficam em `server/data/backups/manual-*-2026-10-16*.json`.

Um navegador sem estoque próprio no `localStorage` não envia nada para `/inventory/import`: antes ele mandava os materiais de exemplo do código e repovoava um estoque esvaziado.

Há histórico de atividades do funcionário. Históricos operacionais devem continuar identificando quem realizou o trabalho mesmo quando cadastros forem posteriormente alterados ou removidos.

## 7. Máquinas e serviços de hora homem

### Máquinas

- Cadastro, edição, remoção e busca por máquina, setor ou operador.
- Nome, tipo, setor e valor por hora.
- Uma máquina pode pertencer a mais de um setor (`sectors`, com `sector` guardando o texto "Usinagem e Caldeiraria"). No cadastro, os setores são separados por vírgula ou marcados entre os já existentes; o Tipo é opcional. A máquina de vários setores é um cadastro só: aparece em cada grupo de setor, mas status, tempo de uso e histórico são únicos.
- Em 16/10/2026 o cadastro foi trocado pelas máquinas reais: 18 máquinas de **Usinagem** e **Caldeiraria**, ainda com valor por hora R$ 0,00 e sem tipo. **Bancada**, **Têmpera** e **Prensa** são uma de cada, dos dois setores. A escolha de máquina do operador e o seletor da oferta agrupam por setor (`src/machineSectors.js`).
- Filtros Todas, Em funcionamento e Ociosas, com resumos de quantidade.
- Status calculado a partir das sessões reais de trabalho, não de uma escolha manual ou de um status fictício salvo no cadastro.
- Lista mostra operador atual, início de uso e total utilizado no dia.
- Atualização da tela a cada 10 segundos.
- Ícone de informação ao lado do início de uso abre histórico com funcionário, OS, início, fim, duração e motivo de encerramento quando houver.
- A troca de máquina durante o trabalho registra um evento e separa os intervalos de utilização, sem exigir pausar toda a sessão.
- Abaixo dos resumos, **Funcionários ociosos (agora)** lista os operadores sem trabalho aberto em nenhuma OS, com o horário, o motivo e a OS da última parada de hoje (`GET /operations/idle-employees`, só administração); quem está parado há mais tempo vem primeiro.

### Serviços

- Catálogo de atividades de **hora homem**, com nome, tipo, setor e valor por hora.
- Cadastro, edição, remoção, busca e histórico pelo ícone de informação.
- Não possui status de máquina ociosa/em funcionamento.
- O histórico identifica funcionário, OS e tempo real de utilização.
- O operador pode selecionar o serviço no início e trocar o serviço durante a sessão.
- O relatório de Serviços usa essas horas reais, não apenas as horas previstas na proposta.

Em 16/10/2026 o catálogo real foi trocado pelos serviços da empresa (usinagem, caldeiraria, solda, manutenção mecânica, corte, dobra, montagem, desmontagem, adequação NR12, pintura e instalação), ainda **sem valor por hora** (R$ 0,00, a preencher na tela Serviços) e sem setor. Os serviços removidos continuam com nome e horas nos históricos e relatórios.

O catálogo inicial de testes abaixo é criado somente quando ainda não existe a lista de serviços (instalação nova e testes automatizados):

| Serviço | Valor inicial por hora |
| --- | ---: |
| Tornearia | R$ 85,00 |
| Fresagem | R$ 90,00 |
| Soldagem | R$ 75,00 |
| Corte e dobra | R$ 65,00 |
| Montagem mecânica | R$ 70,00 |
| Pintura industrial | R$ 60,00 |
| Polimento | R$ 55,00 |

São valores iniciais editáveis, não uma tabela comercial definitiva da empresa. Máquina ou serviço em uso não pode ser excluído sem primeiro resolver as sessões ativas.

## 8. Ofertas e propostas

### Ofertas e serviços

- Lista solicitações inseridas manualmente, com busca e filtro de data.
- Exibe serviço, cliente, etiqueta, quantidade, solicitação, prazo, status, origem e ações.
- Estados do fluxo incluem Em análise, Propostas, Aceitas e Recusadas.
- Oferta manual começa **Em análise**.
- A ação **Recusar** está disponível para oferta manual em análise, com confirmação, sem apagar o registro.
- Oferta recusada não pode gerar uma OS.
- Oferta aceita permite acessar a OS vinculada.
- Não pressupor que exista uma integração externa de entrada de ofertas: a integração com outros sites não está descrita como implementada.

### Inserir oferta manualmente

O modal cadastra dados como CNPJ, empresa, prazo solicitado, peça/serviço, quantidade, descrição, etiqueta e anexo. Depois de salvar, permite seguir para o detalhamento/proposta ou permanecer na listagem.

### Detalhes da oferta

- Informações do cliente e da solicitação, documentos e descrição.
- Materiais com quantidade em **kg**, valor por kg e total por item.
- Busca/sugestão de materiais existentes e possibilidade de informar material ainda não cadastrado.
- Verificação de estoque que considera a soma de linhas do mesmo material.
- Mão de obra por hora máquina ou hora homem, selecionada dos respectivos catálogos.
- Ao selecionar máquina/serviço, o valor por hora vem preenchido; pode ser alterado para a composição da proposta.
- Horas previstas, valores por hora e totais compõem a estimativa. Não são apontamentos reais de trabalho.
- Tipo Serviço ou Produto, origem Amostra/Desenho, Têmpera Sim/Não e descrição complementar opcional.
- Quando Pintura está selecionada, aparece o campo Cor/Tipo.
- Os recursos e o processo definidos na oferta acompanham a proposta e a OS.

### Etapas e processo

| Grupo | Subetapas cadastradas |
| --- | --- |
| Usinagem | Tornearia, Freza, Plaina, Torno CMC, C.usinagem, Montagem, Desmontagem |
| Pintura | Pintura |
| Caldeiraria | Corte e dobra, Corte com Maçarico, Corte a plasma, Esmirilhamento, Montagem Estruturada, Montagem mecânica, Polimento |

- Os nomes acima refletem os rótulos atuais do sistema; não corrigir nomenclaturas sem alinhar o pedido.
- Tanto grupos quanto subetapas podem ser reordenados por arraste.
- A ordem selecionada é persistida e utilizada na execução da OS.
- Etapas antigas, como Corte e Soldagem, são preservadas para compatibilidade com registros existentes.
- A área do operador apresenta as subetapas separadas pelos grupos, preservando a ordem definida.

Abaixo da descrição complementar existe o checkbox **Processo Injessado**, marcado por padrão. Esse é o rótulo atual; a regra técnica é `strictProcess`.

- **Marcado:** a produção segue a sequência. A quantidade de uma etapa não pode superar a quantidade já registrada na etapa anterior.
- **Desmarcado:** o funcionário pode registrar em qualquer etapa, sem exigir conclusão da anterior.
- Em ambos os modos, a quantidade de cada etapa não pode superar a quantidade da OS.
- Uma peça só conta como concluída quando passou por todas as etapas.
- Com os contadores agregados atuais, peças concluídas = menor quantidade registrada entre todas as etapas. Não há identificação individual/serial de cada peça.

Exemplo: uma OS de 20 peças com Pintura = 20, Caldeiraria = 8 e Usinagem = 5 possui **5 peças concluídas**, e não 20. A OS só pode ser concluída quando todas as etapas atingirem 20.

### Propostas A, B, C e D

| Opção | Margem inicial |
| --- | ---: |
| A | 15% |
| B | 20% |
| C | 25% |
| D | 30% |

- Em cada opção só o **prazo de entrega**, o **% de lucro bruto** e o **desconto** são editáveis. Materiais, mão de obra, valor do serviço e horas vêm dos recursos da oferta e não podem ser alterados na proposta (o servidor também os recalcula ao gerar, sem confiar no que o navegador envia).
- **Valor do serviço** = materiais + mão de obra, ou seja, o **custo**. **Valor da OS** = valor do serviço × (1 + % de lucro) × (1 − desconto): é o que o cliente paga e o que vai para o PDF. **Lucro bruto esperado** = Valor da OS − valor do serviço. Exemplo: custo R$ 1.832,40 com 15% → Valor da OS R$ 2.107,26 e lucro R$ 274,86. A regra está em `proposalPricing` (`server/proposalMath.js`).
- As horas são separadas: **Tempo de máquina** soma só as horas de hora máquina, **Tempo de serviço** soma só as de hora homem e **Horas totais** é a soma das duas (`proposalCosts`). Antes, o tempo de serviço somava também as horas de máquina.
- A proposta salva guarda `serviceValue` (custo), `osValue` (Valor da OS), `profit`, `machine`, `serviceTime`, `totalTime`, `materials`, `labor`, `margin` e `discount`. Ao gerar um documento, `osValue` é o **total do documento** (é o que o cliente recebe e o que o recebimento da OS usa). A margem e o desconto escolhidos só são guardados se o documento cobra o Valor da OS que eles produzem; com tabela de preços (Nestlé, Etiqueta) ou preço editado no documento, guarda-se a margem real sobre o custo e desconto 0.
- `osValueOf` devolve o valor cobrado de uma proposta salva: total do documento, depois `osValue`, depois (propostas antigas, sem `osValue`) o valor do serviço com o desconto aplicado. Recebimento da OS, margem real (`orderCosts`) e PDF genérico usam esse valor, nunca o custo.
- No modal dos modelos A/B, o preço vem preenchido com o Valor da OS da opção. Se o total digitado no documento for diferente, aparece um aviso no rodapé; o recebimento da OS segue o total do documento.
- A opção selecionada fica destacada.
- Escolha de layout de PDF: Clássico, Executivo ou Compacto.
- Gerar a proposta grava os dados e o PDF; a ação não deve ser confundida com envio automático por e-mail.
- Aceitar a proposta gera a OS e efetua a baixa de materiais disponíveis.
- Repetir o aceite de uma OS já processada não deve gerar outra OS ou duplicar a baixa.
- O download do PDF deve ser um botão, não apenas um hiperlink sem tratamento visual.

**Pontos comerciais a conferir antes de modificar preços ou enviar PDFs:**

- A edição geral da OS, em propostas com Valor da OS, recalcula o `profit` como Valor da OS menos valor do serviço (custo); em propostas antigas, sem Valor da OS, mantém o cálculo anterior (valor do serviço menos materiais e mão de obra). A aba de proposta da edição mostra "Valor da OS" e "Horas totais" só quando a proposta os tem.
- O PDF da proposta, que vai ao cliente, **não mostra margem de lucro, lucro bruto esperado nem custos** (regra fixa em `proposalSections`, em `server/offers.js`, coberta por `tests/proposal-privacy.test.js` e pela auditoria dos PDFs). Ele é montado de novo a cada download a partir da proposta salva; nenhum arquivo de PDF é mais gravado em `server/data/files/` para propostas, e arquivos antigos dessa pasta (referenciados por `pdfId`) não são enviados. Também não mostra custos: materiais e mão de obra aparecem só por nome, especificação, quantidade e horas, sem valor por kg, valor por hora, totais ou os totais de materiais e mão de obra. O cliente vê o valor cobrado (o Valor da OS, sob o rótulo "Valor do serviço" no layout genérico), o desconto, o prazo e os tempos previstos; o valor do serviço interno (custo) nunca vai ao cliente.

## 9. Estoque e consumo de materiais

### Cadastro e movimentação

- Material contém nome, especificação, disponível em kg, mínimo em kg e preço médio por kg.
- Quantidade não é alterada diretamente pela edição cadastral: deve mudar por entrada ou saída.
- É possível editar ícone e usar uma foto própria. As imagens são reduzidas para armazenamento compacto, com validação no backend; não guardar o original em alta resolução sem necessidade.
- A API reduz a foto para até 256 x 256, em WebP, com limite de 48.000 bytes para a imagem compacta.
- Estoque baixo corresponde a disponível menor ou igual ao mínimo.
- Tela consulta atualizações a cada 10 segundos.
- O histórico individual registra cadastro/movimentos, quantidades, valores, saldo, origem/destino, OS e responsável quando essa identificação está registrada.
- A OS vinculada no histórico pode ser aberta por clique.

Ao receber mais quantidade de um material existente, o custo é recalculado por **média ponderada**, não substituído simplesmente pelo preço da última compra.

```text
Saldo: 20 kg a R$ 28,00/kg
Entrada: 10 kg a R$ 30,00/kg
Novo saldo: 30 kg
Novo preço médio: (20 * 28 + 10 * 30) / 30 = R$ 28,67/kg, aproximadamente
```

### Oferta não dá baixa no estoque

Informar materiais na oferta apenas verifica disponibilidade e estima custos. A baixa acontece ao aceitar a proposta e gerar a OS.

Se forem inseridas duas linhas do mesmo material com 20 kg e 5 kg, e o saldo for 24 kg, a necessidade conjunta é 25 kg e a falta é **1 kg**. Não considerar cada linha isoladamente como se ambas pudessem usar os mesmos 24 kg.

### Aceite da proposta e baixa

- Baixa o disponível, sem criar saldo negativo.
- O restante fica pendente para compra, sem impedir por si só a criação da OS.
- Movimentação de saída registra a OS consumidora.
- O processamento de estoque e os metadados da oferta/OS têm tratamento de transação, serialização e repetição para evitar dupla baixa.
- Quando o fluxo exige o estoque compartilhado, uma falha no banco não deve ser convertida silenciosamente em um aceite fictício sem movimentação.

Exemplo: necessidade de 25 kg e disponível de 24 kg gera saída de 24 kg, saldo 0 kg e pedido/pendência de 1 kg.

## 10. Pedidos de material

A antiga área **Pré-cadastro / Produtos solicitados pendentes** foi retirada do estoque. Materiais faltantes aparecem diretamente em **Pedidos de material**, sem depender da antiga aprovação naquele bloco. Rotas/metadados antigos de aprovação podem permanecer por compatibilidade; não recriar a interface removida.

### Origens dos pedidos

- Falta de material informado em uma oferta/OS.
- Solicitação manual pelo botão **Solicitar material**, no canto superior direito.
- A solicitação manual pode escolher um material existente ou informar um material novo, com especificação e quantidade em kg.
- Pedido manual não precisa de OS e usa código próprio, como `PM-2026-0001`.
- Pedido manual não altera o estoque quando é criado.

### Listagem e navegação

- Código, material, especificação, quantidade a pedir, quantidade necessária, OS/oferta relacionada, data, ações e histórico.
- Todo pedido tem código `PM-AAAA-NNNN`, na mesma sequência dos pedidos manuais. Pedidos vindos de oferta/OS recebem o código ao surgir (registrado em `materialRequestCodes` no JSON); os já existentes foram numerados em ordem cronológica. O código não muda depois de atribuído.
- Clicar no nome do material leva ao **Estoque**, não aos detalhes da OS.
- O link específico da OS/oferta continua levando ao registro relacionado.
- **Adicionar material** abre o modal de entrada existente, pré-preenchido com os dados e a quantidade pendente; o usuário pode ajustar.
- **Recusar pedido** usa confirmação e aparência vermelha discreta.
- Recusar mantém o pedido visível com **Pedido recusado**, preserva a auditoria e não cancela a OS nem altera o estoque.
- Material recusado continua sendo uma pendência na OS, se a falta não foi resolvida.
- Depois do recebimento completo, as ações são substituídas por **Material solicitado adicionado**.
- Recebimento parcial reduz a pendência, sem tratar o pedido como totalmente resolvido.
- Ícone de informação, à direita das ações, mostra quem solicitou, recebeu ou recusou, com datas, quantidades e vínculo com OS quando houver.
- Registros antigos sem autor não recebem um nome fictício retroativo: o histórico informa a ausência de identificação.

### Recebimento vinculado à OS

```text
Pedido para uma OS com 10 kg pendentes
  -> Entrada de 10 kg no estoque, para registrar a compra
  -> Saída de 10 kg para a OS vinculada
  -> Pendência da OS zerada
  -> Compra e consumo ficam registrados separadamente no histórico
```

- A quantidade comprada para a OS não deve aparecer como livre no estoque depois de ser alocada a ela.
- Se receber menos, a falta restante continua pendente.
- Se receber mais, apenas a necessidade pendente é alocada; o excedente fica em estoque.
- Em pedido manual sem OS, o material recebido permanece em estoque, sem saída automática para uma OS fictícia.
- Repetir a mesma confirmação de recebimento não pode registrar outra compra ou outra saída.

## 11. Execução, painéis e detalhes da OS

### Painel de serviços em andamento

- Mostra OS/serviço, cliente, operador, grupo da etapa atual, peças concluídas, progresso por subetapa, tempo ativo, tempo restante, status e acesso à OS.
- A etapa atual deve representar Usinagem, Caldeiraria ou Pintura conforme a subetapa. Há tratamento de compatibilidade para etapas antigas.
- Filtros de prazo incluem Dentro do prazo, Próximo do prazo, Em cima do prazo e Atrasado, além do filtro de concluídos ainda não confirmados.
- O status de prazo é diferente do estado operacional, como Aguardando, Em execução ou Pausado.
- Busca por informações do serviço, cliente e código da OS.
- Atualização periódica de 10 segundos; não é uma transmissão contínua por WebSocket.
- Material pendente destaca a linha e oferece um botão que abre modal com nomes e quantidades faltantes.
- O modal possui **Ir ao pedido**, que abre Pedidos de material e destaca as linhas relacionadas com uma piscada vermelha suave, temporária, voltando ao normal.
- **Modo de exibição** coloca o painel em tela cheia para acompanhamento na TV. Saída pelo controle da tela ou `Esc`.
- Progresso deve aproveitar a largura disponível, com nomes legíveis, sem quebrar palavras. Processos longos podem distribuir etapas inteiras em linhas conforme o layout responsivo.

### Área do operador

- Lista projetos com busca e filtros de estado; consulta novas OS a cada 10 segundos.
- Depois do código, a tela mostra só **Selecione uma OS** (lista com busca e filtros). Ao tocar numa OS, a lista some e aparece só a OS, com **← Voltar para as OS**.
- Na OS, o trabalho segue três quadrados grandes, nesta ordem: **1 Selecionar máquina / serviço** (vermelho) abre uma tela própria com quadrados de todas as máquinas e, abaixo, de todos os serviços; escolher volta para a OS. **2 Iniciar trabalho** (cinza) só libera depois da escolha e, enquanto o operador identificado trabalha, vira **Pausar trabalho**; escolher outro recurso nesse momento troca o recurso da sessão. **3 Concluir serviço** (amarelo) segue a regra de antes (todas as peças em todas as etapas). Uma OS com um único serviço de hora homem previsto já abre com esse serviço escolhido.
- Ao registrar a última peça da última etapa, abre sozinho o modal **Concluir serviço** (com **Agora não**).
- Registro de etapas, funcionários trabalhando na OS e histórico continuam abaixo dos quadrados. Trocar operador volta para a lista.
- Mostra material, responsável, prazo, etapa atual, quantidade, cliente, identificação da OS, tempos e grupos de etapas.
- Cada grupo de etapas é um cartão discreto, na tela do operador e em **Informações do projeto**: fundo branco, uma linha fina lateral e um ponto em cor suave ao lado do nome (**Usinagem** azul, **Caldeiraria** laranja, **Pintura** violeta, **Outras etapas** cinza). O cabeçalho mostra o nome, o estado em texto simples (**Não iniciada**, **Em andamento** ou **Concluída**, esta em verde), as passagens registradas e uma barra fina de progresso do grupo. Evitar cores fortes, ícones e etiquetas nesse cartão: o usuário pediu um visual sóbrio. Os cartões se distribuem pela largura da tela (cada um precisa de cerca de 460 px): em tela larga ficam lado a lado, em largura média Usinagem e Pintura dividem a linha e a Caldeiraria usa a linha toda, e no celular ficam empilhados; um grupo sozinho na linha ocupa a linha inteira. Dentro do cartão, as etapas quebram em linhas (sem rolagem horizontal) fora do layout de celular. Em **Informações do projeto**, a partir de 1800 px a página tem duas colunas que se equilibram sozinhas e a seção **Andamento e etapas** ocupa a largura toda para os grupos ficarem lado a lado. A numeração das etapas continua sendo a da sequência da OS; o tom e o progresso vêm de `stageGroupTone` e `stageGroupProgress` (`src/serviceProgress.js`), com o cabeçalho em `src/OperatorStageGroup.jsx`.
- Antes da lista, o funcionário clica em **Entrar** e digita o código de 4 dígitos (ver Perfis e acesso > Operador).
- O funcionário escolhe **Máquina** ou **Serviço de hora homem**, nunca os dois ao mesmo tempo; a escolha de um deles é obrigatória na tela e o backend recusa os dois juntos.
- Havendo falta, abre **Material pendente**, informa os kg faltantes e pergunta se deseja começar mesmo assim.
- A confirmação é validada no backend e fica registrada; a interface não pode simplesmente ignorar a pendência.
- **Máquina é de uma pessoa por vez**, em qualquer OS: iniciar ou trocar para uma máquina em uso por outra pessoa é recusado (409 `MACHINE_BUSY`, "A máquina X está sendo usada por Fulano na OS-…"), e na tela do operador ela aparece tracejada e desabilitada com "Em uso por Fulano · OS". O próprio funcionário pode levar a sua máquina ao trocar de OS. Se alguém esquecer de pausar, o administrador encerra a sessão pelo painel. Os **serviços de hora homem** continuam compartilhados por várias pessoas ao mesmo tempo. `GET /machines` traz `inUseBy` (funcionário e OS).
- Vários funcionários podem trabalhar na mesma OS ao mesmo tempo, cada um com sua sessão (`activeSessions`). O mesmo funcionário não pode ter duas sessões ativas na mesma OS, nem trabalhar em duas OS ao mesmo tempo: ao iniciar outra OS, a tela pergunta "Você já está trabalhando na OS X. Deseja alterar para esta?"; confirmando (`switchFrom` no `start`), o trabalho na OS anterior é pausado com a justificativa automática **Troca de serviço**, no mesmo instante em que o novo começa. Sem a confirmação o backend responde 409 `WORKING_ELSEWHERE`, e a OS anterior só é pausada depois que o novo início foi aceito.
- Abaixo das etapas e acima do histórico fica **Funcionários trabalhando neste serviço**. Ao clicar no nome aparecem **Pausar trabalho** e **Troca de máquina ou serviço** daquele funcionário.
- O botão único **Troca de máquina ou serviço** abre uma janela que já vem no tipo em uso (máquina ou serviço) e permite sair da máquina para um serviço de hora homem e vice-versa (evento `resource_changed`), além de trocar por outro recurso do mesmo tipo.
- Pausar, trocar recurso ou concluir exige a credencial da sessão, guardada no navegador em que o trabalho foi iniciado. Sessões de outro dispositivo aparecem na lista, com as ações desativadas.
- Com mais de um funcionário trabalhando, registrar uma etapa pergunta **Quem concluiu esta etapa?**; o registro é atribuído ao funcionário escolhido e guarda quem fez o lançamento.
- Pausar um funcionário não pausa a OS enquanto houver outros trabalhando. Concluir a OS encerra também as sessões dos demais (evento `session_ended`), preservando as horas de cada um.
- O tempo do projeto conta uma única vez os períodos com pelo menos um funcionário trabalhando; as horas por funcionário, máquina e serviço continuam vindo dos intervalos de cada sessão.
- No painel administrativo, encerrar sessão com justificativa pede a escolha do funcionário quando há mais de uma sessão ativa.
- Registros antigos com uma única `activeSession` são lidos como lista de uma sessão.
- Pausas disponíveis: Descanso, Horário de almoço, Jossenilson mandou parar e Troca de atividade. **Troca de serviço** não aparece na lista: é gravada sozinha na troca de OS.
- Pausas não entram no tempo ativo. Os relógios locais atualizam a cada segundo com base nos horários persistidos.
- O total de passagens pelas etapas não equivale ao total de peças concluídas; respeitar a regra do menor contador.

### Estados operacionais

| Estado técnico | Significado |
| --- | --- |
| `waiting` | Aguardando início |
| `running` | Trabalho em execução |
| `paused` | Trabalho pausado, sem sessão ativa |
| `finalizing` | Todas as peças passaram por todas as etapas, aguardando a conclusão pelo operador |
| `completed` | Concluído pelo operador |

### Serviços concluídos

- Concluir pelo operador não remove imediatamente a OS do painel de andamento.
- A administração confirma a conclusão pelo botão **Concluído**; isso registra `completionAcknowledgedAt`.
- O botão abre a janela **Recebimento do serviço**, que pergunta se o cliente já pagou: **Ainda vai receber** programa a conta em Contas a Receber (parcela única ou parcelado) e **Já recebido** registra a entrada na Tesouraria, já baixada, com data e forma de recebimento. **Concluir sem lançar** finaliza a OS sem criar lançamento financeiro. Nada é criado antes de uma dessas confirmações.
- Depois dessa confirmação, o serviço sai do painel de andamento e aparece em **Serviços concluídos**.
- Lista mantém a apresentação do processo e o acesso à OS, do mais recente para o menos recente.
- A coluna **Colaboradores** mostra todos que trabalharam na OS (eventos de início e retomada, campo `collaborators` de `GET /operations/orders`), e o filtro **Colaborador** mostra só as OS de uma pessoa. Os títulos ordenam a tabela: números e datas começam do maior, texto de A a Z; clicar de novo inverte.
- Serviços concluídos e Ofertas e serviços atualizam a cada 10 segundos, como o painel em andamento.
- Com o MySQL configurado, o estado da operação (status, sessões, conclusão) fica na tabela `order_operations`, e **não** em `operation` da OS no JSON. Qualquer regra do servidor fora de `operations.js` que precise saber se a OS está concluída deve ler essa tabela (como o recebimento faz com `operationStates`); ler `order.operation` só vale sem banco. Foi esse o motivo de "A OS precisa estar concluída para programar o recebimento" aparecer para uma OS já concluída pelo operador (`tests/receivable-os-status.mysql.mjs`).
- Consultar um serviço concluído não apaga nem reinicia seu histórico.

### Detalhes, edição e reabertura

- A OS tem tela e aba próprias (**Ordem de serviço**), abertas pelo **Ver OS** dos painéis de serviços, das ofertas, do estoque e dos pedidos de material; o botão de voltar retorna à tela de origem. Ela não faz parte de **Pedidos de material**.
- Detalhes da OS exibem informações separadas por contexto, materiais, processo, proposta aceita, arquivos e histórico de operações em modal.
- No histórico, o administrador pode corrigir o horário de operações de sessão (início, retomada, pausa, troca de recurso, peças registradas, encerramento e conclusão). O horário original fica guardado no evento (`originalAt`, `timeEdits`), a linha recebe a marca **Horário editado** e o botão de informação mostra o horário original e quem editou.
- A correção respeita a sequência das operações do funcionário na OS, não aceita horário futuro e recalcula tempo da sessão, tempo ativo da OS e as horas de máquina, serviço e funcionário nos relatórios.
- Encerrar uma sessão ativa administrativamente pede justificativa em modal próprio, não em `window.prompt`.
- **Editar OS** permite alterar dados do serviço/cliente, prazos, quantidade, materiais, mão de obra, proposta, processo, etapas, quantidades produzidas e anexos associados.
- Editar OS concluída exige confirmação explícita.
- Há verificação de versão para impedir salvar sobre mudanças feitas enquanto o formulário estava aberto.
- Com sessão ativa, mudanças em etapas, regras de processo ou quantidades produzidas são impedidas até encerrar a sessão.
- **Reabrir OS** está disponível para OS concluída e preserva quantidades produzidas e histórico; não zera a produção automaticamente.
- A reabertura limpa a confirmação de conclusão e permite a OS voltar ao acompanhamento. Quantidades podem ser ajustadas pela edição.
- Ao confirmar a reabertura, o sistema leva para **Serviços em andamento** e destaca a OS por alguns segundos (a tela da OS não fica aberta, para a OS não "sumir" da lista de concluídos sem aparecer onde foi parar).
- Se a OS tem **contas a receber vinculadas** (programada, parcelada ou já recebida na Tesouraria), o modal de reabertura lista os lançamentos e pergunta o que fazer: **Manter** ou **Excluir** (nada vem marcado). A exclusão usa as mesmas regras de "Excluir conta" em Contas a Receber: o parcelamento sai inteiro, a entrada da Tesouraria pode ser removida, mas conta com histórico de recebimento ou conciliada com o banco não pode ser excluída; nesse caso o modal avisa e o lançamento é mantido. A API é `POST /operations/orders/:code/reopen` com `{ receivables: 'keep' | 'delete' }` (padrão `keep`); a exclusão acontece na mesma operação da reabertura (se for bloqueada, a OS continua concluída) e fica no histórico das contas e no evento "OS reaberta".
- Alterações e reabertura ficam registradas no histórico.

**Atenção para futuras mudanças:** a edição geral de materiais da OS não equivale a executar novas entradas/saídas ou estornar a baixa original automaticamente. Alterações de consumo após o aceite precisam ser analisadas explicitamente com o histórico e as regras de estoque, evitando prometer uma reconciliação que o fluxo de edição não executa.

## 12. Gestão Financeira

### Contas a Pagar

- Cadastro de fornecedor, descrição, classificação, documento/boleto/nota fiscal, emissão, vencimento, valor e anexos.
- Conta normal, parcelada ou recorrente; recorrência mensal/anual e próximo lançamento com confirmação, não geração silenciosa.
- Valores são tratados em centavos; parcelas preservam o total original.
- Pesquisa, filtros por fornecedor/classificação/período/status, ordenação e seleção de contas.
- Estados incluem Pendente, Pago, Vencido e Desativada.
- Baixa total individual ou em massa; não descrever pagamento parcial como implementado.
- Baixa registra data, forma, juros ou desconto, observação e comprovantes.
- Juros e desconto são mutuamente exclusivos na mesma baixa. Baixa em massa tem restrições próprias de ajustes e comprovantes.
- Estorno exige justificativa e preserva o histórico.
- Conta paga exige estorno antes de editar. Grupos parcelados com pagamento têm restrições de edição estrutural.
- Exclusão/desativação respeita vínculos e histórico; registros com pagamento ou vínculo não são simplesmente apagados.
- Duplicidades são verificadas no backend, inclusive em operações concorrentes.
- Exportação PDF/Excel respeita a seleção ou os filtros; detalhe individual inclui informações e histórico da conta.
- Há script específico de demonstração para 120 contas entre setembro e dezembro de 2026, fornecedores e classificações. Não é executado automaticamente ao iniciar o projeto.
- Em Contas a Receber, "Dar baixa" tem também o campo **ISS (R$)**, que começa em zero: é o ISS retido pelo cliente e sai do valor recebido (valor − desconto + juros − ISS), podendo vir junto com juros ou desconto. Fica em `receipt.issCents`, aparece no detalhe da conta e na coluna **ISS (R$)** do PDF/Excel; a baixa em massa não aceita ISS.

### Tesouraria

- Fica no grupo Gestão Financeira, logo abaixo de Contas a Receber. É o livro-caixa: lista todo dinheiro que já entrou ou saiu, com Entradas, Saídas e Saldo do período.
- **Nova saída** usa o formulário de Contas a Pagar e **Nova entrada** o de Contas a Receber; no lugar de vencimento/tipo ficam a data e a forma do pagamento ou recebimento (Pix, Boleto, Transferência, Cartão ou Dinheiro). O lançamento já nasce baixado, sem passar por "dar baixa".
- O lançamento é gravado como uma conta a pagar (`PAG-`) ou a receber (`REC-`) com a marca `treasury: true` e o pagamento/recebimento preenchido. Por isso entra normalmente em Business Intelligence, conciliação bancária, relatórios e nas listas de contas pagas/recebidas, com origem **Tesouraria**.
- As baixas feitas em Contas a Pagar e em Contas a Receber também aparecem na Tesouraria (origem **Contas a Pagar** / **Contas a Receber**); o filtro **Só lançadas aqui** mostra apenas os lançamentos diretos.
- Um lançamento da Tesouraria pode ser editado e ter anexos alterados sem estorno, e pode ser excluído diretamente, desde que não esteja conciliado com o extrato. Lançamentos iguais no mesmo dia são aceitos (a verificação de duplicidade não se aplica a eles).
- Estornar a baixa de um lançamento da Tesouraria o transforma em uma conta em aberto comum.
- Ao receber uma OS na Tesouraria (janela **Recebimento do serviço**, opção **Já recebido**), a conta guarda o **valor da OS** e o **valor recebido** à parte: se o recebido for maior, a diferença vira **juros**; se for menor, vira **desconto** (campo 
eceived da API, como em "Dar baixa"). A janela avisa a diferença numa linha discreta sob o campo de valor (por exemplo, "Juros de R$ 20,00 sobre o valor da OS (R$ 960,00)."), tanto em **Já recebido** quanto em **Ainda vai receber** (neste, o aviso é só informativo: a conta programada guarda o valor digitado). A edição do lançamento mostra **Valor da OS** e **Valor recebido**. Entradas manuais sem OS continuam com um único valor.

### Conciliação bancária

- Importa extratos OFX 1.x/2.x (`server/ofx.js`) do **Itaú** e do **Sicoob** (os dois modelos do Sicoob, "money" e "unix", só mudam a quebra de linha). Vários arquivos podem ser escolhidos de uma vez: cada um vira um lote próprio, um arquivo com erro é informado pelo nome e não impede os outros, e a tela abre na conta do último arquivo.
- Cada banco/conta (BANKID + ACCTID) é uma conta separada no seletor, com o nome do banco (Itaú, Sicoob, etc.). O FITID é único por conta; reimportar o mesmo período só soma "já existentes".
- Sicoob: tags fechadas, acentos em Windows-1252, históricos curtos ("CRÉD.TED-STR", "PIX EMITIDO OUTRA IF", "DÉB.CONV…", "RDC AUTOMÁTICO", "RESGATE RDC…", "DÉB. REPACTUAÇÃO…") e a contraparte em `<NAME>`, usada na sugestão por nome. `<NAME>` com documento mascarado ("Pagamento Pix ***.519.435-**") fica só como referência. O Sicoob não envia saldo anterior nem saldos diários: o aviso é informativo e o fechamento por dia fica sem conferência.
- **Conciliar tudo** vale para todas as contas e deixa de fora aplicações e resgates automáticos (RDC), que são dinheiro da própria empresa indo e voltando da aplicação; eles ainda podem ser conciliados um a um.
- Extratos reais (`*.ofx`) nunca vão para o repositório.
- **Encerramento da conciliação** (`store.bankClosings`, `CON-000001`…): um por conta e mês. A tela tem o seletor **Mês** (padrão: o mês mais recente da conta; "Todos os meses" só consulta) e a barra de situação: em aberto, encerrada ou reaberta.
  - **Encerrar conciliação** mostra o resumo e, se houver movimentações sem vínculo, exige justificativa (mínimo de 10 caracteres). Aplicação/resgate RDC não contam como pendência. O encerramento guarda uma fotografia de cada movimentação do mês com o vínculo da época, quem encerrou e quando.
  - Encerrado, o mês fica **travado**: Conciliar, Desfazer e "Conciliar tudo" não alteram vínculos daquele mês (409 no backend).
  - **Reabrir para editar** pede motivo e destrava o mês; **Encerrar novamente** atualiza o mesmo registro (versão 2, 3…), com o histórico encerrada → reaberta → encerrada novamente.
  - **Excluir** apaga só o registro do encerramento (fica um evento `closing_deleted` em `bankEvents` para auditoria); os vínculos continuam e o mês volta a ficar em aberto.
  - Movimentações importadas num mês já encerrado aparecem como "importadas depois" no encerramento, para reabrir e encerrar de novo.
  - A seção **Conciliações encerradas** lista todos os encerramentos, de todas as contas, com Ver, Reabrir e Excluir. API: `POST /bank-statements/closings`, `POST /bank-statements/closings/:id/reopen`, `DELETE /bank-statements/closings/:id`.

### Compra de material lançada a partir do estoque

- Depois de uma entrada de material (material novo com saldo ou entrada em material existente), pela tela de Estoque ou por Pedidos de material, o sistema pergunta se a compra vai para o financeiro: **Conta a pagar** (ainda será paga) ou **Pagamento já realizado** (saída na Tesouraria, já baixada). **Não lançar agora** apenas fecha a pergunta.
- O formulário abre com valor (quantidade × valor por kg) e descrição preenchidos; fornecedor e classificação são informados pelo usuário. Editar um material não é compra e não pergunta nada.
- A compra não é vinculada automaticamente a uma OS, porque o material previsto na proposta já está no custo da OS.

### Custo real da OS

- **Custos lançados** = custo previsto na proposta (materiais + mão de obra) + contas a pagar vinculadas à OS. As contas vinculadas são custos adicionais, que surgiram depois do planejado; sem elas, o custo lançado é igual ao previsto.
- A margem real usa esse total. Vale para a seção **Custo real e margem** da OS e para a tabela por OS do Business Intelligence.

### Business Intelligence

- Esse é o nome visível atual; não usar Mini BI como nome de tela, embora identificadores internos antigos possam permanecer.
- Resumos de valores totais, pagos, pendentes, vencidos, a vencer, juros e descontos.
- Agrupamentos por fornecedor, classificação e mês dos pagamentos, com filtros interativos e acesso às contas.
- O período seleciona contas pela **data de vencimento**.
- O agrupamento mensal de pagamentos usa a **data da baixa** e o valor efetivamente pago.
- Não trocar essas bases por data de emissão ou criação sem alinhar o pedido.

### Classificações

- Cadastro, edição, listagem e exclusão de categorias usadas nas contas a pagar.
- Categoria utilizada em contas não pode ser excluída como se não tivesse vínculos.
- Listagem deve ocupar a largura útil da tela, sem limitar desnecessariamente as colunas.

## 13. Notificações

O sino fica no cabeçalho superior e é compartilhado pelas telas administrativas. Consulta atualizações a cada 10 segundos.

| Evento | Comportamento padrão |
| --- | --- |
| Novo pedido de material | Notifica administradores, inclusive pedido manual sem OS |
| Serviço concluído pelo operador | Notifica ao concluir, antes da confirmação administrativa para arquivar |
| Estoque de material ficando baixo | Notifica a condição de baixo estoque, sem repetir a mesma condição a cada consulta |
| Nova OS/serviço em andamento | Notifica quando a OS é adicionada |
| Conta a pagar a vencer | Usa o prazo escolhido na configuração da conta |

- As quatro preferências operacionais vêm ativadas por padrão.
- Cada administrador pode ativar/desativar por checkbox em Configurações. Texto deve ficar ao lado do checkbox.
- Contas a pagar: 3, 5, 7 dias antes ou Nunca; padrão de 3 dias, com tratamento do dia do vencimento.
- Leitura é individual por administrador, não global para toda a equipe.
- Ao abrir o sino, as notificações exibidas são marcadas como lidas e o número vermelho desaparece; erros de leitura precisam ser tratados.
- Eventos têm identificadores para evitar duplicações indevidas. As preferências filtram a apresentação, não devem impedir preservar os registros do sistema.
- A API verifica estoque periodicamente e vencimentos a cada minuto. Histórico e preferências são persistidos no servidor.

## 14. Relatórios, PDF e Excel

| Relatório | Seleção/período | Conteúdo |
| --- | --- | --- |
| Funcionários | Cadastro geral | Informações cadastrais disponíveis, sem senhas nem códigos de acesso |
| Clientes | Cadastro geral | Nome, documento, contato e cadastro |
| Administradores | Cadastro geral | Informações cadastrais, sem hashes/tokens/senhas |
| Horas trabalhadas | Início/fim; todos ou funcionários selecionados | Total geral, total por funcionário e detalhe diário |
| Horas de máquinas | Início/fim; todas ou máquinas selecionadas | Horas reais totais e por dia, com opção Horas ociosas |
| Serviços | Início/fim; todos ou serviços selecionados | Cadastro, horas reais totais/diárias e utilização por funcionário/OS |
| Ordens de serviço | Início/fim pela criação da OS | Dados da OS, recursos, proposta, etapas, documentos e operações |

- Exportações são PDF e Excel `.xlsx`, não CSV apresentado como Excel.
- As horas vêm dos intervalos de trabalho, incluindo sessões ativas até a emissão e excluindo pausas.
- Trocas de máquina e serviço dividem a atribuição dos intervalos aos respectivos recursos.
- Sessões que atravessam a meia-noite são separadas por dia em `America/Bahia`.
- Sobreposição de intervalos da mesma pessoa ou máquina é contada uma vez, não em duplicidade.
- Em relatório de serviços, horas simultâneas de funcionários diferentes são somadas; sobreposição do mesmo funcionário no mesmo serviço não duplica horas.
- Sessões antigas sem recurso identificado não são atribuídas ficticiamente a uma máquina/serviço.
- Relatórios por período incluem o dia final escolhido, respeitando os limites calculados no servidor.

### Horas ociosas de máquinas

- Checkbox **Horas ociosas** acrescenta disponibilidade, utilização, ociosidade e percentuais no PDF e Excel.
- Base combinada com o usuário: **24 horas por dia, todos os dias**, não uma jornada de 8 horas ou dias úteis.
- Disponibilidade observada termina no máximo no horário de emissão; não contar horas futuras como ociosas.
- Ocioso = disponibilidade observada menos horas de uso registradas.
- Percentual ativo = horas utilizadas / horas disponíveis.
- Total de disponibilidade soma a janela observada de cada máquina selecionada.
- É uma medida baseada nos apontamentos do portal, não em sensores físicos. Falta de registro não prova que uma máquina ficou realmente desligada.

### Aparência dos documentos

- Geração compartilhada em `server/documentExports.js`, usada pelos relatórios, financeiro e proposta.
- Seções, cabeçalhos, paginação e tabelas com legibilidade; documentos extensos precisam repetir cabeçalhos e acomodar textos.
- Identidade visual dos PDFs: logo GMAC e fonte Inter embutidos a partir de `server/assets/` (Inter sob licença OFL, em `server/assets/fonts/Inter-OFL.txt`). Sem esses arquivos o PDF ainda é gerado, com Helvetica e sem logo.
- Primeira página com logo, tipo do documento (`eyebrow`: Relatório, Financeiro, Proposta comercial), título, data de emissão e período; demais páginas com cabeçalho compacto; rodapé com título, data de emissão e "Página X de Y".
- Totais (`summary`) aparecem como cartões de destaque; `highlight: true` destaca o primeiro (usado no valor da proposta). Observações (`notes`) ficam num quadro próprio.
- Tabelas com até 7 colunas: cabeçalho repetido a cada página, linhas alternadas, valores, horas e percentuais alinhados à direita e colunas dimensionadas pelo texto real, sem cortar palavras. Coluna "Status"/"Situação" vira selo colorido (verde, âmbar, vermelho, azul).
- Seções com mais de 7 colunas ou `records: true` viram cartões com grade de campos. Um cartão que cabe numa página não é dividido; se precisar dividir, repete a identificação com "(continuação)". Textos muito longos continuam nas páginas seguintes, sem cortes.
- Campos vazios aparecem como "—"; CPF e CNPJ são formatados nos PDFs. O modelo Executivo da proposta usa faixa azul-escura no topo; o Compacto, espaçamentos menores.
- `tests/documents-panel.browser.mjs` gera amostras em `test-results/document-review/` e `tests/verify-document-layout.py` verifica cortes, sobreposições, páginas vazias e tamanho mínimo de fonte.
- Excel usa folhas por seção, filtros, painéis congelados, larguras ajustadas, quebra de texto e formatos numéricos.
- Preferências de fonte/tema da interface não significam que todo PDF automaticamente usa a mesma fonte. Os documentos têm formatação própria.
- Conferir PDF e Excel separadamente: download HTTP 200 não garante conteúdo correto nem boa impressão.

## 15. Calculadora de pesos e medidas

- Tema azul integrado ao portal.
- Seleção de material, perfil/formato e apenas as dimensões necessárias para aquela combinação.
- Materiais incluem aço carbono, aço inox, alumínio, bronze, cobre e latão.
- Perfis incluem barras, bobina, chapas, tubos, perfis L/T/U, tarugo e bucha; as opções variam por material.
- Densidades e fórmulas específicas, resultados em kg/m ou kg conforme o formato e conversões de polegada/mm.
- Resultado atualiza conforme as medidas; é possível limpar os campos.
- A Coppermetal foi usada como referência histórica. Não afirmar equivalência exata de todas as fórmulas sem comparar a combinação relevante e seus arredondamentos.
- Essa calculadora não movimenta estoque nem registra produção por si só.

## 16. Configurações e experiência visual

- Conta vem em modo claro por padrão; modo escuro usa azul escuro, não preto predominante.
- Tamanho de fonte: Pequena, Padrão ou Grande. O padrão original deve ser preservado.
- Fontes disponíveis: Arial (padrão), Segoe UI, Verdana, Tahoma, Inter, Roboto, Open Sans, Montserrat e Source Sans 3.
- Tema, tamanho e família são preferências da conta administrativa, persistidas no servidor e com cache local por conta.
- Aplicam-se às telas da interface administrativa; não alterar uma fonte apenas em Configurações deixando os demais módulos inconsistentes.
- Configurações também reúne nome/senha da própria conta e preferências de notificações.

### Diretrizes de interface

- Portal operacional: compacto, claro, rápido e com bom aproveitamento de tela, sem aparência de landing page.
- Azul institucional, branco/cinza no modo claro e cores de status bem diferenciadas.
- Não concentrar muitos dados em uma única frase; separar rótulos, valores, grupos e ações.
- Tabelas e colunas devem aproveitar a largura, sem áreas laterais vazias desnecessárias.
- Evitar animações decorativas. O destaque temporário do pedido selecionado é uma exceção funcional, já solicitada.
- Usar modais do portal para confirmações, justificativas e históricos; não introduzir `alert`, `prompt` ou `confirm` nativos do navegador para esses fluxos.
- Ícones de ferramentas precisam de título/nome acessível. Priorizar controles de toque adequados no mobile.
- Não esconder funções essenciais para fazer a tela caber. Modais compactos no desktop podem ter rolagem interna em telas pequenas quando necessário.
- Testar texto, tabelas, modais, menus e estados vazios/erro em ambos os temas e com fontes alternativas.

Resoluções desktop de referência: 3456 x 2234, 3024 x 1964, 3072 x 1920, 2880 x 1864, 2880 x 1800, 2560 x 1664, 2560 x 1600, 2304 x 1440, 1440 x 900 e 1920 x 1080.

Referências mobile: iPhone 15, área de aproximadamente 393 x 852 pixels CSS, e iPhone 15 Pro Max, aproximadamente 430 x 932 pixels CSS. Não confundir resolução física do aparelho com área útil CSS do navegador.

Há uma auditoria histórica em `docs/responsive-audit.md` e testes de navegador. A auditoria é anterior a algumas mudanças recentes; não usar sua existência para afirmar que toda funcionalidade nova já foi validada em todas as resoluções.

## 17. Arquitetura e persistência real

### Tecnologias

- Frontend: React 18, Vite e CSS do projeto; Lucide em vários controles.
- Ordenação por arraste: `@dnd-kit`.
- Backend: Node.js em módulos ES e Express.
- Banco: MySQL via `mysql2`.
- PDF: PDFKit. Excel: ExcelJS. Redução de imagens: Sharp.
- Testes: `node:test` e Playwright; há testes específicos com MySQL.

### Onde os dados são armazenados

O portal possui **persistência híbrida**. Não afirmar que tudo está no MySQL nem que tudo está apenas no navegador.

| Dados | Persistência atual |
| --- | --- |
| Estoque e movimentações compartilhadas | MySQL; existe modo local de demonstração no frontend, que não deve ser confundido com estoque compartilhado |
| Funcionários, administradores e clientes | MySQL quando configurado; fallback de contas/cadastros em JSON no modo sem banco |
| Estado operacional e eventos de trabalho | MySQL quando configurado; JSON no modo sem banco |
| Ofertas, conteúdo principal das OS, propostas e recursos | `server/data/offers.json` |
| Catálogos de máquinas e serviços de hora homem | `server/data/offers.json` |
| Pedidos manuais, metadados de recebimento/recusa e preferências | `server/data/offers.json` |
| Contas a pagar, fornecedores, classificações e auditoria financeira | `server/data/offers.json` |
| Notificações operacionais e marcações de leitura | JSON compartilhado do servidor |
| Arquivos, PDFs e anexos | Diretórios privados em `server/data/`, incluindo `server/data/files/` |
| Sessões administrativas | Memória da API |
| Cache visual, estado de navegação e tokens no cliente | `localStorage`/`sessionStorage`, conforme o tipo |

- `mutateStore` serializa alterações do arquivo JSON e integra notificações dos eventos de negócio.
- Transações SQL e metadados JSON precisam continuar alinhados nos fluxos de estoque; não trocar por escritas soltas sem proteção contra repetição.
- Fazer backup do MySQL **e** de `server/data/`, incluindo anexos. Backup apenas do banco perde parte importante do portal.
- `.env`, dados reais e resultados de teste não devem entrar no Git.
- Vários computadores usam o mesmo backend e banco. Copiar dados/cache para cada navegador não é uma solução de compartilhamento.

## 18. Execução local e rede

Na raiz do projeto:

```bash
npm install
npm run dev
```

- `npm run dev` inicia frontend e backend juntos, identificados como FRONTEND e BACKEND no terminal.
- Frontend: `http://localhost:5174`, atendendo em `0.0.0.0` para acesso na rede.
- Backend: porta padrão 3002, definida por `PORT`; normalmente atende em `127.0.0.1` e é acessado pelos clientes através do proxy `/api` do frontend.
- O terminal detecta e mostra o endereço da rede, como `http://IP-DO-COMPUTADOR:5174`. Não fixar um IP antigo como se fosse permanente.
- `Ctrl+C` encerra os dois serviços; se um falhar, o outro também é encerrado.
- Rodar o comando duas vezes na mesma porta causa conflito. Identificar a instância antes de encerrar processos; não matar indiscriminadamente todos os processos Node.
- O MySQL precisa estar ativo e configurado em `.env`. Os clientes na rede não precisam instalar MySQL nem acessar diretamente a porta 3306.
- `npm run db:setup` prepara/importa o banco dedicado; revisar backup e efeitos antes de executar em dados reais.
- Health check: `/api/health`. `databaseConnected: true` confirma a conexão nesse momento; a raiz da API não é uma página do sistema.
- Firewall deve permitir o acesso necessário apenas na rede confiável. Não desativar todo o firewall nem expor o Vite de teste à internet.
- `npm run start` inicia apenas a API; não confundir com o comando de desenvolvimento integrado.

### Limite de requisições e segurança

- Rotas `/api` limitadas a **200 requisições por minuto por IP**, incluindo login.
- Ao atingir o limite, retornam HTTP 429 e orientação de espera; arquivos da interface não entram nessa contagem.
- O proxy de desenvolvimento encaminha o IP real e substitui cabeçalhos de encaminhamento fornecidos pelo cliente.
- O limite fica em memória por processo. Múltiplas instâncias exigiriam armazenamento compartilhado e revisão da configuração de proxy.
- Existem rotas administrativas protegidas e rotas legadas sem exigência explícita de autenticação. Não afirmar que toda a API já foi endurecida para produção.
- Antes de publicar, revisar autenticação por rota, cookies/tokens, permissões, proxy, persistência, backup e o desligamento do modo sem senha. Ambiente funcional na LAN não equivale a implantação segura na internet.

## 19. Mapa de arquivos para orientar alterações

| Área | Arquivos de referência |
| --- | --- |
| App, login, menu, abas e várias telas | `src/main.jsx` |
| Início e resumos | `src/AdminHome.jsx`, `src/adminOverview.js` |
| Login e sessões | `server/authLogin.js`, `server/accounts.js`, `server/operatorAuth.js` |
| API, estoque e inicialização | `server/index.js`, `vite.config.js`, `scripts/dev-network.mjs` |
| Oferta, proposta, aceite e JSON | `server/offers.js`, telas correspondentes em `src/main.jsx` |
| Etapas e processo | `server/serviceStages.js`, `src/ServiceStageEditor.jsx`, `src/serviceProgress.js` |
| Operação e edição da OS | `server/operations.js`, `server/orderEditing.js`, `src/OperatorDashboard.jsx`, `src/OrderDetails.jsx`, `src/OrderEditModal.jsx` |
| Painéis e prazos | `src/servicePanels.js`, `src/serviceDeadline.js`, painel em `src/main.jsx` |
| Estoque, fotos e consumo da OS | `server/orderMaterials.js`, `server/inventoryAppearance.js`, `src/MaterialAppearance.jsx`, telas em `src/main.jsx` |
| Pedidos e pendências | `server/materialRequests.js`, `server/pendingMaterials.js`, `src/offerResources.js`, `src/MaterialRequestModals.jsx`, `src/PendingMaterialsModal.jsx` |
| Máquinas e serviços | `server/machines.js`, `server/laborServices.js`, `src/MachineHistoryModal.jsx`, `src/LaborServicesScreen.jsx` |
| Financeiro | `server/payables.js`, `server/payableRules.js`, `src/PayablesScreen.jsx`, `src/PayableForm.jsx`, `src/payableAnalytics.js` |
| Notificações | `server/notifications.js`, `server/notificationEvents.js`, `server/notificationRules.js`, `src/NotificationsButton.jsx` |
| Configurações e aparência | `src/AccountSettings.jsx`, `src/accountTheme.js`, `src/theme.css`, `scripts/build-dark-theme.mjs` |
| Relatórios e exportações | `server/reports.js`, `server/reportData.js`, `server/documentExports.js`, `src/ReportsScreen.jsx` |
| Responsividade | `src/styles.css`, `src/mobile.css`, `src/desktop.css`, CSS específicos dos módulos |
| Banco, preparo e migrações | `database/`, `scripts/setup-local-database.mjs` |
| Verificação | `tests/`, `docs/responsive-audit.md` |

Há CSS gerado para tema escuro e tamanho de fonte. Conferir o gerador antes de editar apenas os arquivos `.generated.css`, pois o próximo build pode substituir uma alteração manual.

## 20. Como validar uma alteração

Comandos gerais:

```bash
npm test
npm run build
```

- O build regenera estilos de aparência; conferir se alterações geradas são esperadas.
- Testes de navegador estão em `tests/*.browser.mjs`; vários usam o build de `dist`, exigindo compilar antes.
- Testes MySQL estão em `tests/*.mysql.mjs`; verificar o isolamento antes de executar, sem usar os registros reais como fixtures descartáveis.
- Exemplos de testes por área: `test-login`, `service-progress`, `service-panels`, `order-materials`, `material-request-receipt`, `manual-material-requests`, `operational-notifications`, `labor-services`, `reports`, `rate-limit`, `resolution-audit` e `mobile-experience`.
- Não afirmar que um teste foi executado apenas porque o arquivo existe.

Checklist para mudanças que atravessam módulos:

1. Login normal, modo de teste e recarregamento continuam coerentes.
2. Oferta, proposta e OS preservam seus vínculos e estados.
3. Baixa/entrada de estoque não duplica e a pendência correspondente é atualizada.
4. Funcionário, máquina e serviço corretos aparecem no histórico e no relatório.
5. Conclusão, confirmação administrativa e reabertura respeitam as quantidades existentes.
6. Preferências e leitura de notificações continuam individuais.
7. Valores, datas, unidade kg, intervalos de horas e fuso Bahia mantêm o significado correto.
8. PDF/Excel contêm dados corretos e não expõem segredos ou informação interna indevida.
9. Telas, tabelas e modais funcionam no desktop, mobile, modo escuro e fonte alternativa.
10. Erros de API, conflitos e repetição de cliques têm tratamento visível, sem sucesso fictício.

## 21. Modelo para enviar o próximo pedido à IA

```text
Use ENTENDIMENTO_PORTAL_GMAC.md como contexto do meu portal.
Leia os arquivos atuais dos módulos envolvidos antes de alterar.

Minha solicitação:
[Explique a mudança desejada, tela afetada e comportamento esperado.]

Exemplo ou referência:
[Print, OS de teste ou sequência de ações, sem senhas/dados sensíveis.]

Restrições:
- Preserve os dados existentes, vínculos e históricos.
- Não altere regras de negócio fora do pedido.
- Se faltar uma definição importante, pergunte antes de inventar.
- Não faça commit/push sem eu solicitar.

Ao terminar:
Informe o que mudou, o que foi realmente testado e qualquer limitação restante.
```
