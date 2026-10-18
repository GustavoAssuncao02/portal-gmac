// Hosting panels keep what was typed ("True", "Production "): switches are compared without case or surrounding spaces.
// Built-in modules only: scripts/ensure-build.mjs uses it before the dependencies are installed.
export const flag = (value) => String(value ?? '').trim().toLowerCase()
export const enabled = (value) => flag(value) === 'true'
export const isProduction = (env = process.env) => flag(env.NODE_ENV) === 'production'
