/**
 * Crea la primera usuaria administradora del CRM.
 *
 *   ./_run.sh npx tsx scripts/seed-admin.ts hola@fem.com.co "Mateo Vera" 'unaClaveLarga'
 *
 * El login del CRM valida contra Supabase Auth y luego busca la fila en
 * `crm_users`. Hacen falta las dos: este script crea ambas y las enlaza por
 * `auth_user_id`. Es idempotente — si la usuaria ya existe, la reutiliza.
 */
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

const [email, name, password] = process.argv.slice(2);

if (!email || !name || !password) {
  console.error('Uso: npx tsx scripts/seed-admin.ts <email> <nombre> <contraseña>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('La contraseña debe tener al menos 8 caracteres.');
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  process.exit(1);
}

const prisma   = new PrismaClient();
const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  // 1 · Usuaria en Supabase Auth
  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  let authUserId = created?.user?.id;

  if (error) {
    // Ya existía: se busca en el listado para recuperar su id.
    const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const found = list?.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (!found) {
      console.error('No se pudo crear ni encontrar la usuaria en Supabase Auth:', error.message);
      process.exit(1);
    }
    authUserId = found.id;
    console.log(`Supabase Auth: ya existía (${authUserId})`);
  } else {
    console.log(`Supabase Auth: creada (${authUserId})`);
  }

  // 2 · Fila en el CRM
  const user = await prisma.crmUser.upsert({
    where:  { email },
    create: { email, name, role: 'ADMIN', authUserId, isActive: true },
    update: { name, role: 'ADMIN', authUserId, isActive: true },
  });

  console.log(`CRM: ${user.name} <${user.email}> · rol ${user.role} · activa`);
  console.log('\nListo. Entra en /login con ese correo y esa contraseña.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
