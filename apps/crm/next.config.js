if(process.env.FEM_CRM_ENV_JSON) Object.assign(process.env,JSON.parse(process.env.FEM_CRM_ENV_JSON));
if(process.env.VERCEL) process.env.ALLOW_DEV_LOGIN='false';
module.exports={basePath:'/admin/crm'};
