import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { createMetaTemplate } from '@/services/whatsapp';

type MetaCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
type CrmCategory = 'CONFIRMATION' | 'LOGISTICS' | 'REPURCHASE' | 'SUPPORT' | 'PROMOTIONAL';

const CRM_CATEGORIES: CrmCategory[] = ['CONFIRMATION', 'LOGISTICS', 'REPURCHASE', 'SUPPORT', 'PROMOTIONAL'];
const META_CATEGORIES: MetaCategory[] = ['UTILITY', 'MARKETING', 'AUTHENTICATION'];

// Categoría de negocio del CRM → categoría que exige Meta (si no se especifica override).
const CRM_TO_META: Record<CrmCategory, MetaCategory> = {
  CONFIRMATION: 'UTILITY',
  LOGISTICS: 'UTILITY',
  SUPPORT: 'UTILITY',
  REPURCHASE: 'MARKETING',
  PROMOTIONAL: 'MARKETING',
};

// Valida el cuerpo según las reglas de Meta y devuelve las variables numeradas detectadas.
function validateBody(body: string): { ok: true; variables: string[] } | { ok: false; error: string } {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: 'El cuerpo del mensaje no puede estar vacío.' };
  if (trimmed.length > 1024) return { ok: false, error: 'El cuerpo no puede superar los 1024 caracteres.' };

  // Meta no permite una variable al principio o al final del cuerpo.
  if (/^\s*\{\{/.test(trimmed)) return { ok: false, error: 'El mensaje no puede empezar con una variable. Antepón texto (por ejemplo "Hola ").' };
  if (/\}\}\s*$/.test(trimmed)) return { ok: false, error: 'El mensaje no puede terminar con una variable. Agrega texto después.' };

  // Ni dos variables seguidas.
  if (/\}\}\s*\{\{/.test(trimmed)) return { ok: false, error: 'No puede haber dos variables juntas; sepáralas con texto.' };

  const nums = Array.from(trimmed.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).map(m => Number(m[1]));
  // Detecta variables con nombre (no soportadas en este formulario)
  if (/\{\{\s*[a-zA-Z]/.test(trimmed)) {
    return { ok: false, error: 'Usa variables numeradas: {{1}}, {{2}}, {{3}}…' };
  }

  const unique = Array.from(new Set(nums)).sort((a, b) => a - b);
  // Deben ser secuenciales empezando en 1: {{1}}, {{2}}, …
  for (let i = 0; i < unique.length; i++) {
    if (unique[i] !== i + 1) {
      return { ok: false, error: `Las variables deben ir en orden empezando en 1 (falta {{${i + 1}}}).` };
    }
  }

  return { ok: true, variables: unique.map(String) };
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category');
  const where: any = {};
  if (category) where.category = category;

  const templates = await prisma.messageTemplate.findMany({ where, orderBy: { name: 'asc' } });
  return NextResponse.json(templates);
}

// Crea una plantilla: la envía a Meta para revisión Y la guarda en el CRM (estado PENDING).
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const input = await req.json().catch(() => null);
  if (!input) return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });

  const name = String(input.name || '').trim().toLowerCase();
  const language = String(input.language || 'es').trim() || 'es';
  const bodyText = String(input.body || '');
  const header = input.header ? String(input.header).trim() : undefined;
  const footer = input.footer ? String(input.footer).trim() : undefined;
  const examples: string[] = Array.isArray(input.examples) ? input.examples.map((e: unknown) => String(e ?? '').trim()) : [];

  // Nombre: solo minúsculas, números y guion bajo (regla de Meta).
  if (!/^[a-z0-9_]{1,512}$/.test(name)) {
    return NextResponse.json({ error: 'El nombre solo puede tener minúsculas, números y guion bajo (sin espacios ni tildes).' }, { status: 400 });
  }

  const crmCategory = input.category as CrmCategory;
  if (!CRM_CATEGORIES.includes(crmCategory)) {
    return NextResponse.json({ error: 'Categoría inválida.' }, { status: 400 });
  }

  // Categoría para Meta: override explícito o la derivada de la categoría del CRM.
  const metaCategory: MetaCategory =
    input.metaCategory && META_CATEGORIES.includes(input.metaCategory) ? input.metaCategory : CRM_TO_META[crmCategory];

  const validation = validateBody(bodyText);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const variables = validation.variables;

  // Meta exige un ejemplo por cada variable del cuerpo.
  if (variables.length > 0) {
    if (examples.length !== variables.length || examples.some(e => !e)) {
      return NextResponse.json({ error: 'Debes dar un valor de ejemplo para cada variable.' }, { status: 400 });
    }
  }

  if (header && /\{\{/.test(header)) {
    return NextResponse.json({ error: 'Por ahora el encabezado no admite variables. Déjalo como texto fijo.' }, { status: 400 });
  }

  // Evita duplicados: Meta rechaza nombre+idioma repetidos y ensuciaría el CRM.
  const dup = await prisma.messageTemplate.findFirst({ where: { name, language } });
  if (dup) {
    return NextResponse.json({ error: `Ya existe una plantilla llamada "${name}" en ${language}.` }, { status: 409 });
  }

  // 1) Crear en Meta (queda en revisión).
  let meta: { id: string; status: string; category: string };
  try {
    meta = await createMetaTemplate({
      name,
      language,
      category: metaCategory,
      body: bodyText,
      bodyExamples: variables.length ? examples : undefined,
      header,
      footer,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al crear la plantilla en Meta';
    // "no configurado" es un 503; el resto son errores de validación de Meta → 422.
    const status = /no está configurado/.test(msg) ? 503 : 422;
    return NextResponse.json({ error: msg }, { status });
  }

  // 2) Guardar en el CRM ya enlazada al id de Meta.
  const template = await prisma.messageTemplate.create({
    data: {
      name,
      category: crmCategory,
      content: bodyText,
      variables,
      language,
      status: 'PENDING',
      channels: ['WHATSAPP'],
      metaTemplateId: meta.id,
    },
  });

  return NextResponse.json(template, { status: 201 });
}
