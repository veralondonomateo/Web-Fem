export async function register(){
 const raw=process.env.FEM_CRM_ENV_JSON;
 if(raw)Object.assign(process.env,JSON.parse(raw));
 if(process.env.VERCEL)process.env.ALLOW_DEV_LOGIN="false";
}
