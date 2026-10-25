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

// The stage brings the machine or service planned for it in the offer: step 1 shows it and step 2 starts the work there.
export async function startWork(page, resourceName) {
  if (resourceName) await page.locator('.operator-step--resource').getByText(resourceName, { exact: false }).waitFor()
  await page.getByRole('button', { name: /Iniciar trabalho/ }).click()
}

// The machine or service of every stage, planned in the offer: `plan` maps each stage code to a machine or service id.
export const stagePlans = (stages, choice) => Object.fromEntries(stages.map((code) => [code, choice]))

// Session value of an operator already identified, for pages opened straight on the project list.
export const identifiedOperator = ({ id, name, identification }) => ['gmac-operator-employee', JSON.stringify({ id, name, identification })]
