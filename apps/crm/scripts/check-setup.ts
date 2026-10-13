/**
 * Comprueba de una pasada que el CRM está bien conectado.
 *
 *   ./_run.sh npx tsx scripts/check-setup.ts
 *   ./_run.sh npx tsx scripts/check-setup.ts hola@fem.com.co 'laClave'
 *
 * Verifica, en este orden: variables presentes, Postgres accesible por Prisma,
 * tablas creadas, usuarias enlazadas con Supabase Auth, flujos sembrados y —si
 * se pasan credenciales— que el inicio de sesión de verdad devuelve un token.
 */
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

const [email, password] = process.argv.slice(2);

let fallos = 0;
const ok   = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string) => { fallos++; console.log(`  FALLO ${m}`); };

async function main() {
  console.log('\nVariables de entorno');
  const requeridas = ['DATABASE_URL', 'DIRECT_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET', 'CRON_SECRET'];
  for (const v of requeridas) {
    process.env[v] ? ok(v) : fail(`${v} — sin valor`);
  }
  if (fallos) {
    console.log('\nFaltan variables: rellena .env.local antes de seguir.\n');
    process.exit(1);
  }

  const prisma = new PrismaClient();

  console.log('\nBase de datos');
  try {
    await prisma.$queryRaw`select 1`;
    ok('Postgres responde');
  } catch (e: any) {
    fail(`no se pudo conectar — ${e.message.split('\n')[0]}`);
    console.log('\nRevisa DATABASE_URL.\n');
    process.exit(1);
  }

  const tablas = await prisma.$queryRaw<{ n: bigint }[]>`
    select count(*) as n from information_schema.tables where table_schema = 'public'`;
  Number(tablas[0].n) >= 15
    ? ok(`${tablas[0].n} tablas en public`)
    : fail(`solo ${tablas[0].n} tablas — corre: npm run db:push`);

  console.log('\nUsuarias del CRM');
  const usuarias = await prisma.crmUser.findMany({ orderBy: { role: 'asc' } });
  if (!usuarias.length) fail('ninguna — corre: npm run seed:admin <email> <nombre> <clave>');
  for (const u of usuarias) {
    u.authUserId && u.isActive
      ? ok(`${u.email} · ${u.role}`)
      : fail(`${u.email} · ${!u.authUserId ? 'sin enlazar a Supabase Auth' : 'inactiva'}`);
  }
  usuarias.some(u => u.role === 'ADMIN' && u.isActive) || fail('no hay ninguna ADMIN activa');

  console.log('\nFlujos');
  const flujos = await prisma.flowTemplate.findMany();
  flujos.length >= 9
    ? ok(`${flujos.length} sembrados (${flujos.filter(f => f.isActive).length} encendidos)`)
    : fail(`solo ${flujos.length} — corre: npm run seed:flows`);

  if (email && password) {
    console.log('\nInicio de sesión');
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      fail(`${email} — ${error?.message ?? 'sin usuaria'}`);
    } else {
      const fila = await prisma.crmUser.findFirst({
        where: { OR: [{ authUserId: data.user.id }, { email }] },
      });
      fila?.isActive ? ok(`${email} entra como ${fila.role}`) : fail(`${email} autentica pero no tiene fila activa en crm_users`);
    }
  } else {
    console.log('\nInicio de sesión\n  —     omitido (pasa email y contraseña para probarlo)');
  }

  await prisma.$disconnect();
  console.log(fallos ? `\n${fallos} fallo(s).\n` : '\nTodo en orden.\n');
  process.exit(fallos ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
