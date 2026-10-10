/** Replace the legacy checkout links with native cart controls, retaining their content and styling. */
export function productCartControls(source:string,fallbackHandle?:string):string {
  const currentHandle=fallbackHandle??source.match(/data-fem-form-product-url="\/products\/([-\w]+)"/)?.[1];
  const stickyShipping=(content:string)=>/^\+?\s*ENV[ÍI]O GRATIS\s*→?$/.test(content.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());
  const converted=source.replace(/<a\b([^>]*\bhref="[^">]+"[^>]*)>([\s\S]*?)<\/a\s*>/gi,(_link,attributes:string,content:string)=>{
    const href=attributes.match(/\bhref="([^"]+)"/)?.[1];if(!href)return _link;
    let destination:URL;try{destination=new URL(href.replaceAll('&amp;','&'),'https://femprobiotics.co');}catch{return _link;}
    const legacy=destination.hostname==='checkoutfem.com'&&/^\/(?:ec\/)?checkout$/.test(destination.pathname);
    const subscription=destination.hostname==='checkout.treli.co'&&destination.pathname.startsWith('/pl/');
    const permalink=destination.hostname==='femprobiotics.co'?destination.pathname.match(/^\/cart\/(\d+):\d+$/):null;
    const sticky=stickyShipping(content);
    if(!legacy&&!subscription&&!permalink&&!sticky)return _link;
    // One published combo link has an accidental closing brace after its handle.
    const handle=sticky?currentHandle:legacy?(destination.searchParams.get('product')?.replace(/\}+$/,'')??currentHandle):currentHandle;
    if(!handle||handle!==currentHandle&&!/^[-\w]+$/.test(handle))return _link;
    const variant=destination.searchParams.get('variant')??permalink?.[1];
    const kept=attributes.replace(/\s(?:href|target|rel|type|aria-label)="[^"]*"/g,'').replace(/[ \t]+(?=\r?\n)/g,'');
    const fallback=variant&&/^\d+$/.test(variant)?` data-variant-id="${variant}"`:'';
    return `<button${kept} type="button" data-fem-cart-add data-fem-cart-product-handle="${handle}"${fallback} aria-label="Agregar al carrito">${content}</button>`;
  });
  return converted.replace(/<button\b([^>]*)>([\s\S]*?)<\/button\s*>/gi,(original,attributes:string,content:string)=>{
    if(!stickyShipping(content))return original;
    const handle=attributes.match(/\bdata-fem-cart-product-handle="([^"]+)"/)?.[1]??currentHandle;
    if(!handle)return original;
    let kept=attributes.replace(/\s(?:type|aria-label)="[^"]*"/g,'').replace(/[ \t]+(?=\r?\n)/g,'');
    if(!/\bdata-fem-cart-add(?:\s|=|$)/.test(kept))kept+=' data-fem-cart-add';
    if(!/\bdata-fem-cart-product-handle=/.test(kept))kept+=` data-fem-cart-product-handle="${handle}"`;
    if(!/\bdata-fem-sticky-cart-add(?:\s|=|$)/.test(kept))kept+=' data-fem-sticky-cart-add';
    return `<button${kept} type="button" aria-label="Agregar al carrito">${content}</button>`;
  });
}
