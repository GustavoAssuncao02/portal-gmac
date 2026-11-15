// The groups of the side menu (src/main.jsx), in the order of the menu. A screen inside a closed group is only clickable
// after its group is opened; Operação starts open, the others start closed.
export const sidebarGroups = {
  'Gestão Operacional': ['Máquinas', 'Serviços', 'Etapas', 'Estoque', 'Pedidos de material'],
  Cadastros: ['Fornecedores', 'Administradores', 'Funcionários', 'Setores', 'Clientes', 'Solicitantes', 'Compradores', 'Modelos de e-mail', 'Bancos', 'Razões de pausas'],
  'Operação': ['Serviços em andamento', 'Serviços concluídos', 'Ofertas e serviços', 'Planejamento'],
  'Gestão Financeira': ['Contas a Pagar', 'Contas a Receber', 'Tesouraria', 'Fluxo de caixa', 'Baixa em Lote', 'Conciliação bancária', 'Business Intelligence', 'DRE', 'Ajustes da DRE', 'Grupos de contas', 'Classificações'],
}

export const sidebarGroupOf = (label) => Object.keys(sidebarGroups).find((group) => sidebarGroups[group].includes(label))

// Clicks a screen of the side menu, opening its group first when it is closed.
export async function openSidebarItem(page, label) {
  const sidebar = page.locator('.sidebar')
  const item = sidebar.getByRole('button', { name: label, exact: true })
  const group = sidebarGroupOf(label)
  if (group && !await item.isVisible()) await sidebar.getByRole('button', { name: group, exact: true }).click()
  await item.click()
}
