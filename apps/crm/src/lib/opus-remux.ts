/**
 * Reempaqueta el audio de MediaRecorder de WebM a Ogg, sin recodificar.
 *
 * Por qué hace falta: WhatsApp solo acepta audio en aac, mp4, mpeg, amr, ogg u
 * opus — «audio/webm» lo rechaza con un (#100). Y Chrome, que es lo que usan
 * las agentes, solo sabe grabar `audio/webm;codecs=opus`; el `audio/ogg` de
 * MediaRecorder únicamente existe en Firefox.
 *
 * La buena noticia es que dentro del WebM el audio YA está en Opus, que es
 * justo lo que Ogg transporta. Así que esto no recodifica nada: saca los
 * paquetes Opus del contenedor WebM y los vuelve a envolver en páginas Ogg.
 * Es rápido, no pierde calidad y no necesita ninguna librería.
 */

// ── Lectura de EBML (el formato de contenedor de WebM/Matroska) ─────────────

class Lector {
  constructor(private d: DataView, public pos = 0) {}
  get fin() { return this.pos >= this.d.byteLength; }
  byte() { return this.d.getUint8(this.pos++); }

  /** Identificador de elemento: los bits de marca forman parte del valor. */
  id(): number {
    const primero = this.byte();
    const largo = 8 - Math.floor(Math.log2(primero || 1));
    let v = primero;
    for (let i = 1; i < largo; i++) v = v * 256 + this.byte();
    return v;
  }

  /** Tamaño de elemento: los bits de marca se descartan. */
  tamano(): number {
    const primero = this.byte();
    if (primero === 0) return 0;
    const largo = 8 - Math.floor(Math.log2(primero));
    let v = primero & ((1 << (8 - largo)) - 1);
    for (let i = 1; i < largo; i++) v = v * 256 + this.byte();
    return v;
  }
}

/** Elementos que hay que abrir para llegar al audio, en vez de saltarlos. */
const CONTENEDORES = new Set([
  0x18538067, // Segment
  0x1654ae6b, // Tracks
  0xae,       // TrackEntry
  0x1f43b675, // Cluster
  0xa0,       // BlockGroup
]);

const CODEC_PRIVATE = 0x63a2; // la cabecera OpusHead original
const SIMPLE_BLOCK  = 0xa3;
const BLOCK         = 0xa1;

interface ContenidoWebm {
  cabecera: Uint8Array | null;
  paquetes: Uint8Array[];
}

function leerWebm(datos: Uint8Array): ContenidoWebm {
  const vista = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);
  const r = new Lector(vista);
  const res: ContenidoWebm = { cabecera: null, paquetes: [] };

  while (!r.fin) {
    let id: number, tam: number;
    try { id = r.id(); tam = r.tamano(); } catch { break; }

    if (CONTENEDORES.has(id)) continue;           // se entra, no se salta
    if (r.pos + tam > datos.length) break;        // grabación truncada

    if (id === CODEC_PRIVATE && !res.cabecera) {
      res.cabecera = datos.subarray(r.pos, r.pos + tam);
    } else if (id === SIMPLE_BLOCK || id === BLOCK) {
      // Cabecera del bloque: número de pista (vint) + 2 bytes de tiempo + 1 de flags.
      const inicio = r.pos;
      const sub = new Lector(vista, inicio);
      sub.tamano();                 // número de pista
      const flags = datos[sub.pos + 2];
      const datosDesde = sub.pos + 3;

      // Con «lacing» un bloque lleva varias tramas y habría que partirlo. Chrome
      // no lo usa para Opus, así que en vez de adivinar el reparto —y mandar un
      // audio distorsionado sin que nadie se entere— se corta aquí.
      if ((flags & 0b0110) !== 0) {
        throw new Error('La grabación usa un empaquetado que no se puede convertir.');
      }
      if (datosDesde < inicio + tam) {
        res.paquetes.push(datos.subarray(datosDesde, inicio + tam));
      }
    }
    r.pos += tam;
  }
  return res;
}

// ── Duración de un paquete Opus, para la posición granular de Ogg ───────────

/** Milisegundos por trama según la configuración del byte TOC. */
const MS_POR_TRAMA = [
  10, 20, 40, 60, 10, 20, 40, 60, 10, 20, 40, 60,  // SILK
  10, 20, 10, 20,                                   // híbrido
  2.5, 5, 10, 20, 2.5, 5, 10, 20,                   // CELT
  2.5, 5, 10, 20, 2.5, 5, 10, 20,
];

/** Muestras a 48 kHz que dura un paquete. Es lo que Ogg cuenta. */
function muestras(paquete: Uint8Array): number {
  if (!paquete.length) return 0;
  const toc = paquete[0];
  const ms = MS_POR_TRAMA[toc >> 3] ?? 20;
  const codigo = toc & 0b11;
  const tramas = codigo === 0 ? 1
    : codigo === 1 || codigo === 2 ? 2
    : (paquete[1] ?? 1) & 0b0011_1111;   // código 3: el conteo va en el byte siguiente
  return Math.round(ms * 48 * Math.max(tramas, 1));
}

// ── Escritura de Ogg ────────────────────────────────────────────────────────

/** CRC de Ogg: polinomio 0x04c11db7, sin reflejar. */
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = c & 0x8000_0000 ? ((c << 1) ^ 0x04c1_1db7) >>> 0 : (c << 1) >>> 0;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc(datos: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < datos.length; i++) c = ((c << 8) ^ TABLA_CRC[((c >>> 24) ^ datos[i]) & 0xff]) >>> 0;
  return c >>> 0;
}

/**
 * Una página Ogg. Cada página lleva como mucho 255 segmentos de 255 bytes, lo
 * que sobra para los paquetes de voz que produce MediaRecorder.
 */
function pagina(
  cuerpos: Uint8Array[], tipo: number, granular: number, serie: number, secuencia: number,
): Uint8Array {
  const segmentos: number[] = [];
  for (const c of cuerpos) {
    let queda = c.length;
    while (queda >= 255) { segmentos.push(255); queda -= 255; }
    segmentos.push(queda);
  }

  const largoCuerpo = cuerpos.reduce((s, c) => s + c.length, 0);
  const p = new Uint8Array(27 + segmentos.length + largoCuerpo);
  const v = new DataView(p.buffer);

  p.set([0x4f, 0x67, 0x67, 0x53], 0);   // "OggS"
  p[4] = 0;                              // versión
  p[5] = tipo;                           // 2 = inicio, 4 = fin, 0 = normal
  // La posición granular son 64 bits; con audio de voz nunca pasa de 2^32
  // muestras (unas 24 horas), así que la parte alta va en cero.
  v.setUint32(6, granular >>> 0, true);
  v.setUint32(10, 0, true);
  v.setUint32(14, serie, true);
  v.setUint32(18, secuencia, true);
  v.setUint32(22, 0, true);              // CRC: se calcula con este campo en cero
  p[26] = segmentos.length;
  p.set(segmentos, 27);

  let off = 27 + segmentos.length;
  for (const c of cuerpos) { p.set(c, off); off += c.length; }

  v.setUint32(22, crc(p), true);
  return p;
}

const texto = (s: string) => new TextEncoder().encode(s);

/** OpusHead por defecto, por si el WebM no trajera CodecPrivate. */
function cabeceraPorDefecto(): Uint8Array {
  const h = new Uint8Array(19);
  h.set(texto('OpusHead'), 0);
  h[8] = 1;                                    // versión
  h[9] = 1;                                    // canales
  new DataView(h.buffer).setUint16(10, 312, true);   // pre-skip
  new DataView(h.buffer).setUint32(12, 48000, true); // frecuencia original
  return h;
}

function opusTags(): Uint8Array {
  const proveedor = texto('fem-crm');
  const t = new Uint8Array(8 + 4 + proveedor.length + 4);
  t.set(texto('OpusTags'), 0);
  const v = new DataView(t.buffer);
  v.setUint32(8, proveedor.length, true);
  t.set(proveedor, 12);
  v.setUint32(12 + proveedor.length, 0, true); // sin comentarios
  return t;
}

/**
 * Convierte una grabación WebM/Opus en un Blob Ogg/Opus listo para WhatsApp.
 * Si el navegador ya grabó en Ogg, devuelve el original sin tocarlo.
 */
export async function aOggOpus(blob: Blob): Promise<Blob> {
  if (blob.type.includes('ogg')) return blob;

  const { cabecera, paquetes } = leerWebm(new Uint8Array(await blob.arrayBuffer()));
  if (!paquetes.length) throw new Error('La grabación salió vacía.');

  const serie = (Math.random() * 0xffff_ffff) >>> 0;
  const partes: Uint8Array[] = [
    pagina([cabecera ?? cabeceraPorDefecto()], 2, 0, serie, 0),
    pagina([opusTags()], 0, 0, serie, 1),
  ];

  // Se agrupan varios paquetes por página para no inflar el archivo con
  // cabeceras: 50 paquetes son ~1 segundo de voz.
  const POR_PAGINA = 50;
  let granular = 0;
  let secuencia = 2;

  for (let i = 0; i < paquetes.length; i += POR_PAGINA) {
    const grupo = paquetes.slice(i, i + POR_PAGINA);
    for (const p of grupo) granular += muestras(p);
    const ultima = i + POR_PAGINA >= paquetes.length;
    partes.push(pagina(grupo, ultima ? 4 : 0, granular, serie, secuencia++));
  }

  return new Blob(partes as BlobPart[], { type: 'audio/ogg' });
}
