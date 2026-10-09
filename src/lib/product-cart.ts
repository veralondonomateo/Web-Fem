/** Replace the legacy checkout links with native cart controls, retaining their content and styling. */
export function productCartControls(source:string,fallbackHandle?:string):string {
  const currentHandle=fallbackHandle??source.match(/data-fem-form-product-url="\/products\/([-\w]+)"/)?.[1];
  return source.replace(/<a\b([^>]*\bhref="[^">]+"[^>]*)>([\s\S]*?)<\/a\s*>/gi,(_link,attributes:string,content:string)=>{
    const href=attributes.match(/\bhref="([^"]+)"/)?.[1];if(!href)return _link;
    let destination:URL;try{destination=new URL(href.replaceAll('&amp;','&'),'https://femprobiotics.co');}catch{return _link;}
    const legacy=destination.hostname==='checkoutfem.com'&&/^\/(?:ec\/)?checkout$/.test(destination.pathname);
    const subscription=destination.hostname==='checkout.treli.co'&&destination.pathname.startsWith('/pl/');
    const permalink=destination.hostname==='femprobiotics.co'?destination.pathname.match(/^\/cart\/(\d+):\d+$/):null;
    if(!legacy&&!subscription&&!permalink)return _link;
    // One published combo link has an accidental closing brace after its handle.
    const handle=legacy?(destination.searchParams.get('product')?.replace(/\}+$/,'')??currentHandle):currentHandle;
    if(!handle||handle!==currentHandle&&!/^[-\w]+$/.test(handle))return _link;
    const variant=destination.searchParams.get('variant')??permalink?.[1];
    const kept=attributes.replace(/\s(?:href|target|rel|type|aria-label)="[^"]*"/g,'');
    const fallback=variant&&/^\d+$/.test(variant)?` data-variant-id="${variant}"`:'';
    return `<button${kept} type="button" data-fem-cart-add data-fem-cart-product-handle="${handle}"${fallback} aria-label="Agregar al carrito">${content}</button>`;
  });
}
