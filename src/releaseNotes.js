// Each commit to main is a new version: add an entry at the top, with what changed in plain words for whoever uses the portal.
export const releaseNotes = [
  {
    version: '1.0.03',
    date: '2026-10-25',
    notes: [
      'Máquinas: novo painel de uso por período, histórico diário de cada máquina, manutenção com motivo',
      'Planejamento: nova tela com a agenda das máquinas, planejar a OS inteira de uma vez, máquina de cada etapa vinda da OS, agenda da máquina no dia ao escolher o horário',
      'Ofertas: tempo e máquina ou serviço obrigatórios em cada etapa, edição de materiais e mão de obra, peça já feita traz a máquina ou o serviço de cada etapa',
      'Ofertas e OS: serviço Interno ou Externo',
      'Ver OS: adicionar e remover anexos, tempo previsto e máquina de cada etapa com edição direto na tela',
      'Fazer proposta: novo botão Salvar',
      'Notificações: novo aviso de proposta salva, quem salva ou aceita não recebe o próprio aviso',
      'Operador: a etapa já vem com a máquina ou o serviço, painel ao vivo e fila do setor no tablet, pausa com as razões cadastradas, etapa concluída ao registrar a última peça, telas ajustadas aos tablets',
      'Configurações: acesso do tablet definido pelos administradores, novo tema Escuro intenso',
      'Cadastros: Setores, Razões de pausa e Bancos',
      'Funcionários: desativar e reativar',
      'Estoque: materiais em quilos ou em unidades',
      'Pedidos de material: criados no aceite da oferta',
      'Financeiro: banco nas baixas e filtro por banco',
      'Baixa em Lote: ajuste nos modos escuros',
      'Conciliação: considerar o banco da baixa',
      'Contas a pagar e Tesouraria: divisão entre classificações',
      'Contas a receber: ISS e previsão de recebimentos',
      'Menu: novo grupo Operação',
      'Anexos: sem limite de tamanho',
      'Acesso: o login não cai ao atualizar o sistema',
      'Melhorias gerais: correções de problemas, desempenho e segurança',
    ],
  },
  {
    version: '1.0.02',
    date: '2026-10-22',
    notes: ['Configurações: a versão do portal aparece no fim da página, e "Notas de atualização" mostra o que mudou em cada versão.'],
  },
  {
    version: '1.0.01',
    date: '2026-10-21',
    notes: [
      'Notificações: cada conta escolhe o som que toca quando chega uma notificação nova, ou deixa sem som.',
      'Login: o logotipo entra com uma animação no painel da marca.',
      'Ofertas: a empresa pode ser buscada entre os clientes cadastrados, e as ofertas e OS aceitam clientes com CPF.',
      'Operador: a saída fica em um único botão, que primeiro sai do funcionário e depois da conta do operador.',
    ],
  },
]

export const currentVersion = releaseNotes[0].version
