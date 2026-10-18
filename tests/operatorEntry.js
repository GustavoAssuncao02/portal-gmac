// Identifies an operator on the shared account the way the tablet does: Entrar, the 4 digits on the keypad, OK.
export async function typeOperatorCode(page, code) {
  const keypad = page.locator('.operator-keypad')
  for (const digit of code) await keypad.getByRole('button', { name: digit, exact: true }).click()
  await keypad.getByRole('button', { name: 'OK', exact: true }).click()
}

export async function enterOperatorCode(page, code) {
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await typeOperatorCode(page, code)
  await page.locator('.operator-entry').waitFor({ state: 'detached' })
}

// Opens an OS from the list; the list gives way to the OS screen.
export async function openOrder(page, text) {
  await page.locator('.operator-project').filter({ hasText: text }).click()
  await page.locator('.operator-steps').waitFor()
}

// Step 1 opens the machine/service screen; choosing returns to the OS. Step 2 starts the work.
export async function chooseResource(page, group, name) {
  await page.getByRole('button', { name: /Selecionar máquina \/ serviço/ }).click()
  const option = page.getByRole('region', { name: group, exact: true }).getByRole('button', { name, exact: true })
  await option.click()
  await page.locator('.operator-steps').waitFor()
}

export async function startWork(page, group, name) {
  await chooseResource(page, group, name)
  await page.getByRole('button', { name: /Iniciar trabalho/ }).click()
}

// Session value of an operator already identified, for pages opened straight on the project list.
export const identifiedOperator = ({ id, name, identification }) => ['gmac-operator-employee', JSON.stringify({ id, name, identification })]
