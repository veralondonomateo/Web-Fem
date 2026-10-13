// Only server processes import this module. No values are bundled into public assets.
export function serviceEnvironment(name){return process.env[name]?JSON.parse(process.env[name]):{};}
