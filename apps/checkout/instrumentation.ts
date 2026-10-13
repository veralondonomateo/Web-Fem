export async function register(){
 const raw=process.env.FEM_CHECKOUT_ENV_JSON;
 if(raw)Object.assign(process.env,JSON.parse(raw));
 if(process.env.VERCEL)process.env.ALLOW_DEV_LOGIN="false";
}
