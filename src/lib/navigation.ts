export const STORE_ORIGIN = 'https://femprobiotics.co';
export const STORE_DOMAIN = 'fd668e-73.myshopify.com';
export const routes = {
  home: '/', products: '/collections/todos-los-productos', collections: '/collections',
  bestSellers: '/collections/mas-vendidos', contact: '/pages/contact',
  quiz: '/pages/quiz1', subscription: '/pages/planes-or-fem',
  privacy: '/pages/policy-privac', terms: '/pages/terminos-y-condiciones-de-suscripcion',
  cart: '/cart', search: '/search',
} as const;
export interface LinkRepair { selectorClass: string; destination: string; liquidDestination?: string; reason: string }
export const linkRepairs: readonly LinkRepair[] = [
  {selectorClass:'i9Yc6VbPwbKTXHsCL',destination:'/products/duo-perfecto',liquidDestination:'{{ product_lsKt9KsE2awWHXJm.url }}',reason:'CTA de la tarjeta del dúo'},
  {selectorClass:'iH0lqC4xTs0n5Xet5',destination:'/products/probiotico-vaginal-en-capsulas-x100-unidades',liquidDestination:'{{ product_JPtOhIoDynPiVwqb.url }}',reason:'CTA del producto en preguntas frecuentes'},
  ...['izqxGjoOoWxLILAGI','i51JVMLO3xjdJPQ7y','iEUGDdW3P9twYxj1Y','iL0osH0KyAujjYHOy','iSR4UNpUS1ZIiyDBQ','inWkCm3KTrD3K4kGW','ihSSk9uNaToZEl4QA'].map(selectorClass=>({selectorClass,destination:routes.bestSellers,reason:'Enlace «Más vendido» sin destino'})),
];
export const nonNavigationClasses = ['iKKm2nh8UsWlkUH9V','ioGSbf8BcmxPG5Yj5','i2rvpcquursJjQQKu','ilc9i7MxDPwWEykWi','ipWMBvNfOCI940U8M'] as const;
/** Only storefront navigation is localised. Payments, login and third parties stay official. */
export function localHref(href: string): string {
  if (!/^(https?:)?\/\//i.test(href)) return href;
  const url = new URL(href, STORE_ORIGIN);
  if (![new URL(STORE_ORIGIN).hostname, STORE_DOMAIN, 'www.femprobiotics.co'].includes(url.hostname)) return href;
  if (/^\/checkouts?(\/|$)/.test(url.pathname)) return '/checkout';
  if (/^\/(account|customer_authentication|discount|apps|challenge)(\/|$)/.test(url.pathname)) return href;
  return url.pathname + url.search + url.hash;
}
/** Targeted source edits preserve all Liquid expressions, CSS selectors and app hooks. */
export function repairNavigation(source: string, liquid = false): string {
  let result = source.replace(/<a\b[^>]*>/g, tag => {
    const classes = tag.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    const repair = linkRepairs.find(r => classes.includes(r.selectorClass));
    if (repair) return tag.replace(/href="[^"]*"/, `href="${liquid ? repair.liquidDestination ?? repair.destination : repair.destination}"`);
    return tag.replace(/href="([^"]*)"/, (_, href: string) => `href="${localHref(href)}"`);
  });
  for (const className of nonNavigationClasses) {
    // These are content wrappers, not CTAs. The legal wrapper contains a real mailto link.
    const pattern = new RegExp(`<a\\b(?=[^>]*class="[^"]*\\b${className}\\b)[^>]*>[\\s\\S]*?<\\/a\\s*>`, 'g');
    if (className === 'ipWMBvNfOCI940U8M') {
      const start = result.search(new RegExp(`<a\\b(?=[^>]*class="[^"]*${className})`));
      if (start >= 0) {
        const closing = /<\/div\s*><\/a\b/.exec(result.slice(start));
        if (closing) {
          const end=start+closing.index;
          const part=result.slice(start,end).replace(/^<a\b[^>]*>/,tag=>tag.replace(/^<a\b/,'<div').replace(/\s(?:href|rel|as)="[^"]*"/g,''));
          result=result.slice(0,start)+part+result.slice(end).replace(/^(<\/div\s*>)<\/a\b/,'$1</div');
        }
      }
    } else {
      result = result.replace(pattern, part => part.replace(/^<a\b/, '<div').replace(/\s(?:href|rel)="[^"]*"/, '').replace(/<\/a\s*>$/, '</div>'));
    }
  }
  return result;
}
