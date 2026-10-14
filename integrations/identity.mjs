// Central access is explicitly limited to the active Gerencia CRM account.
export const centralEmail='gerencia@grupomsm.co';
export async function centralUser(env,request=fetch){
 const url=new URL('/rest/v1/crm_users',env.SUPABASE_URL);
 url.searchParams.set('select','auth_user_id,email,role,is_active');url.searchParams.set('email','eq.'+centralEmail);
 const r=await request(url,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('No se pudo verificar el acceso');
 const [user]=await r.json();return user?.is_active&&user.role==='ADMIN'&&user.auth_user_id?user:null;
}
export async function authenticateCentral(email,password,env,request=fetch){
 if(typeof email!=='string'||email.trim().toLowerCase()!==centralEmail||typeof password!=='string'||!password||password.length>1024)return false;
 const r=await request(new URL('/auth/v1/token?grant_type=password',env.SUPABASE_URL),{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:centralEmail,password}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)return false;
 const data=await r.json(),user=await centralUser(env,request);
 return !!user&&data.user?.id===user.auth_user_id&&data.user?.email?.toLowerCase()===centralEmail;
}

export async function authenticateCRM(email,password,env,request=fetch){
 if(typeof email!=='string'||email.length>254||typeof password!=='string'||!password||password.length>1024)return false;
 const r=await request(new URL('/auth/v1/token?grant_type=password',env.SUPABASE_URL),{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:email.trim().toLowerCase(),password}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)return false;const data=await r.json();if(!data.user?.id)return false;
 const url=new URL('/rest/v1/crm_users',env.SUPABASE_URL);url.searchParams.set('select','is_active');url.searchParams.set('auth_user_id','eq.'+data.user.id);url.searchParams.set('email','eq.'+email.trim().toLowerCase());
 const user=await request(url,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY},signal:AbortSignal.timeout(10000)});if(!user.ok)return false;return (await user.json())[0]?.is_active===true;
}
