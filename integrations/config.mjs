import {hashPassword} from './auth.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';
export const root=resolve(import.meta.dirname,'..');
export const envFile=p=>p&&existsSync(p)?parseEnv(readFileSync(p,'utf8')):{};
const local=envFile(resolve(root,'.env.unified.local'));
export const config={...local,...process.env};
export const checkoutEnv=config.FEM_CHECKOUT_ENV_JSON?JSON.parse(config.FEM_CHECKOUT_ENV_JSON):envFile(config.FEM_CHECKOUT_ENV);
export const crmEnv=config.FEM_CRM_ENV_JSON?JSON.parse(config.FEM_CRM_ENV_JSON):envFile(config.FEM_CRM_ENV);
export const dropEnv=envFile(config.FEM_DROP_ENV);
export const adminPassword=config.FEM_ADMIN_PASSWORD||checkoutEnv.ADMIN_PASSWORD||dropEnv.ADMIN_PASSWORD;
export const preview=config.FEM_LIVE_CHECKOUT!=='true';
export const port=Number(config.FEM_PORT||3000);
export const publicOrigin=config.FEM_PUBLIC_ORIGIN||(process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:`http://localhost:${port}`);

export const adminPasswordHash=config.FEM_ADMIN_PASSWORD_HASH||(adminPassword?hashPassword(adminPassword):null);
