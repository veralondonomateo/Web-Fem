import { prisma } from '@/lib/prisma';
import { fetchMetaTemplates } from '@/services/whatsapp';

// Meta usa MARKETING/UTILITY/AUTHENTICATION; el CRM tiene categorías propias.
// La categoría solo se asigna al crear — si luego la cambian a mano, se respeta.
const CATEGORY_MAP: Record<string, 'PROMOTIONAL' | 'SUPPORT'> = {
  MARKETING: 'PROMOTIONAL',
  UTILITY: 'SUPPORT',
  AUTHENTICATION: 'SUPPORT',
};

const STATUS_MAP: Record<string, 'APPROVED' | 'PENDING' | 'REJECTED'> = {
  APPROVED: 'APPROVED',
  PENDING: 'PENDING',
  IN_APPEAL: 'PENDING',
  REJECTED: 'REJECTED',
  PAUSED: 'REJECTED',
  DISABLED: 'REJECTED',
};

export class MetaNoConfigurado extends Error {}

/**
 * Trae de Meta el estado de todas las plantillas y lo guarda en el CRM.
 *
 * No es solo para la pantalla de plantillas: el motor de flujos consulta este
 * estado antes de enviar, y si se quedara viejo esperaría por una plantilla
 * que Meta ya aprobó. Por eso lo corre también el cron horario.
 */
export async function sincronizarPlantillas(): Promise<number> {
  const metaTemplates = await fetchMetaTemplates();
  if (!metaTemplates) throw new MetaNoConfigurado('WhatsApp no está configurado');

  let synced = 0;
  for (const t of metaTemplates) {
    const body = t.components?.find(c => c.type === 'BODY')?.text || '';
    const variables = Array.from(new Set(
      Array.from(body.matchAll(/{{\s*(\w+)\s*}}/g)).map(m => m[1])
    ));
    // Cabecera y botones: sin esto el envío manual desde la bandeja salía
    // incompleto y Meta lo rechazaba con 132012.
    const header = t.components?.find(c => c.type === 'HEADER') as { format?: string } | undefined;
    const buttons = t.components?.find(c => c.type === 'BUTTONS') as
      { buttons?: { type?: string; text?: string; url?: string }[] } | undefined;
    const hasUrlButton = Boolean(
      buttons?.buttons?.some(b => b.type === 'URL' && /\{\{\s*\d+\s*\}\}/.test(b.url ?? '')),
    );

    const data = {
      name: t.name,
      language: t.language,
      content: body,
      variables,
      status: STATUS_MAP[t.status] || ('PENDING' as const),
      metaTemplateId: t.id,
      headerFormat: header?.format ?? null,
      hasUrlButton,
      // Enteros, no solo para saber si hay uno dinámico: es lo que permite
      // enseñar en la bandeja el mismo botón que le llegó a la clienta.
      botones: (buttons?.buttons ?? []) as unknown as object,
    };

    const existing = await prisma.messageTemplate.findFirst({
      where: { OR: [{ metaTemplateId: t.id }, { name: t.name, language: t.language }] },
    });

    if (existing) {
      await prisma.messageTemplate.update({ where: { id: existing.id }, data });
    } else {
      await prisma.messageTemplate.create({
        data: { ...data, category: CATEGORY_MAP[t.category] || 'SUPPORT', channels: ['WHATSAPP'] },
      });
    }
    synced++;
  }

  return synced;
}
