import {productPhotos} from './product-photo-data.ts';
export {productPhotos};

/** Resolve the product independently of its variant and localized URL prefix. */
export function productHandle(value:string):string {
  const path=value.split(/[?#]/)[0];
  return path.includes('/products/')?path.split('/products/')[1]?.split('/')[0]??'':path.replace(/^\/+|\/+$/g,'');
}

export function productPhoto(value:string,index=0){
  return productPhotos[productHandle(value)]?.[index];
}

/** Assets live beside fem-runtime.js in both the local preview and Shopify CDN. */
export function productPhotoUrl(value:string,assetBase:string,index=0):string|undefined {
  const photo=productPhoto(value,index);
  return photo?new URL(photo.asset,assetBase).href:undefined;
}
