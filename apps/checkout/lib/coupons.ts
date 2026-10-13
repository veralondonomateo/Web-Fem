// Fuente única de los cupones.
//
// Antes esta tabla estaba escrita dos veces: en CheckoutPageClient (para
// mostrar el descuento) y en /api/checkout (para validarlo). Editar solo una
// dejaba al cliente aplicando un descuento que el servidor rechazaba, o al
// revés. Con un único módulo importado por ambos, eso no puede pasar.
//
// El servidor sigue siendo la autoridad: el descuento se recalcula ahí y nunca
// se confía en el monto que manda el navegador.

/** Código → porcentaje de descuento (0.1 = 10%). */
export const COUPON_CODES: Record<string, number> = {
  FEM10: 0.1,
  MISTERIOSO: 0.05,
  AIDA: 0.2,
  NEW10: 0.1,
  QUIEROFEM: 0.1,
  AMORXFEM: 0.2,
  // Exclusivo de la recuperación de carritos por WhatsApp. Va aparte de FEM10
  // para poder medir cuántas ventas trajo esa operación y poder apagarlo sin
  // tocar los cupones que se usan en otros canales.
  VUELVE10: 0.1,
};

/** Máximo de usos por cliente (email). Sin entrada aquí = sin límite. */
export const COUPON_USAGE_LIMITS: Record<string, number> = {
  NEW10: 1,
  QUIEROFEM: 2,
  VUELVE10: 1,
};

/** Normaliza como se guarda en la base: sin espacios y en mayúsculas. */
export function normalizeCoupon(code: string): string {
  return code.trim().toUpperCase();
}

/** Porcentaje del cupón, o undefined si no existe. */
export function getCouponRate(code: string): number | undefined {
  return COUPON_CODES[normalizeCoupon(code)];
}
