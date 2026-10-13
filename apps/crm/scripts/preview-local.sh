#!/bin/zsh
# Vista previa del CRM sin conectarlo a nada.
#
#   ./scripts/preview-local.sh          arranca (reutiliza los datos)
#   ./scripts/preview-local.sh --reset  borra y vuelve a sembrar la demo
#
# Levanta un Postgres propio en el puerto 55432, siembra datos de mentira y
# abre el CRM en http://localhost:3111 con acceso local activado.
set -e

cd "$(dirname "$0")/.."
DB_DIR="${TMPDIR:-/tmp}/fem-preview-db"

export DATABASE_URL="postgresql://fem:fem@127.0.0.1:55432/femcrm"
export DIRECT_URL="$DATABASE_URL"
export JWT_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))")"
export ALLOW_DEV_LOGIN="true"
export NEXT_PUBLIC_APP_URL="http://localhost:3111"

# ── Postgres embebido ────────────────────────────────────────────────────────
if [ ! -d "$DB_DIR/node_modules" ]; then
  echo "Instalando el Postgres de la vista previa…"
  mkdir -p "$DB_DIR"
  (cd "$DB_DIR" && npm init -y >/dev/null && npm install embedded-postgres --no-audit --no-fund >/dev/null)
fi

cat > "$DB_DIR/start.mjs" <<'JS'
import EmbeddedPostgres from 'embedded-postgres';
const dir = process.env.PREVIEW_DB_DIR;
const pg = new EmbeddedPostgres({
  databaseDir: `${dir}/data`, user: 'fem', password: 'fem', port: 55432, persistent: true,
});
import { existsSync } from 'node:fs';
if (!existsSync(`${dir}/data/PG_VERSION`)) await pg.initialise();
await pg.start();
try { await pg.createDatabase('femcrm'); } catch {}
console.log('postgres listo');
process.stdin.resume();
JS

if ! nc -z 127.0.0.1 55432 2>/dev/null; then
  echo "Arrancando Postgres…"
  PREVIEW_DB_DIR="$DB_DIR" node "$DB_DIR/start.mjs" > "$DB_DIR/pg.log" 2>&1 &
  for i in $(seq 1 30); do nc -z 127.0.0.1 55432 2>/dev/null && break; sleep 1; done
fi

# ── Esquema y datos ──────────────────────────────────────────────────────────
npx prisma db push --skip-generate >/dev/null

if [ "$1" = "--reset" ] || [ ! -f "$DB_DIR/.seeded" ]; then
  echo "Sembrando datos de demostración…"
  npx tsx scripts/seed-demo.ts
  npx tsx scripts/seed-flows.ts >/dev/null
  node -e "
    const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
    p.crmUser.upsert({where:{email:'hola@fem.com.co'},
      create:{email:'hola@fem.com.co',name:'Equipo Fem',role:'ADMIN',isActive:true},
      update:{isActive:true}}).then(()=>p.\$disconnect());"
  touch "$DB_DIR/.seeded"
fi

# ── App ──────────────────────────────────────────────────────────────────────
npx next build
echo ""
echo "  ▸ http://localhost:3111/login"
echo "  ▸ correo: hola@fem.com.co   ·   contraseña: cualquiera (acceso local)"
echo ""
exec npx next start -p 3111 -H 127.0.0.1
