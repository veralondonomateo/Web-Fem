import {readFileSync,writeFileSync} from 'node:fs';

const galleries:Record<string,string>={
  'jabon-intimo-ph-neutro':'jabon-gallery.json',
  'probiotico-vaginal-en-capsulas-x100-unidades':'probioticos-gallery.json',
  'gomitas-sindrome-premestrual-x60':'gomas-gallery.json',
  'ovulos-vaginales-fem':'ovulos-gallery.json',
  'duo-perfecto':'duo-gallery.json',
  'combo-premestrual-x-fem':'gomas-pro-gallery.json',
  'combo-fem-x-ovulos':'ovulos-pro-gallery.json',
  'combo-ovulos-x-jabon':'ovulos-jab-gallery.json',
  'combo-completo':'combo-compl-gallery.json',
  'combo-dia-de-la-mujer':'pro-gom-jab-gallery.json',
  'probiotico-jabon-ovulos':'pro-jab-ovu-gallery.json',
  'combo-gomas-jabon':'gomas-jab-gallery.json',
  'combo-mama':'combo-mama-gallery.json',
  'fem-mom-impulso-natural-de-leche-materna':'fem-mom-gallery.json'
};
const photos:Record<string,{asset:string;width:number;height:number}[]>={};
for(const [handle,file] of Object.entries(galleries)){
  const gallery=JSON.parse(readFileSync(new URL('../server/'+file,import.meta.url),'utf8')) as {asset:string;width:number;height:number}[];
  photos[handle]=gallery.map(({asset,width,height})=>({asset,width,height}));
}
writeFileSync(new URL('../src/lib/product-photo-data.ts',import.meta.url),
  '// Generated from the supplied product galleries by scripts/sync-product-photos.ts.\n'+
  'export const productPhotos:Record<string,{asset:string;width:number;height:number}[]>='+JSON.stringify(photos,null,2)+';\n');
const cases=Object.entries(photos).map(([handle,gallery])=>
  `    when '${handle}'\n      assign photos = '${gallery.map(photo=>[photo.asset,photo.width,photo.height].join('|')).join(',')}' | split: ','`
).join('\n');
writeFileSync(new URL('../theme-source/snippets/fem-product-photo-data.liquid',import.meta.url),`{% doc %}
Generated product photo lookup, kept in sync with the supplied galleries.
@param {product} card_product - Product whose photo is requested.
@param {string} [product_handle] - Explicit product handle.
@param {number} [photo_index] - Photo position, starting at 1.
{% enddoc %}
{%- liquid
  assign photos = blank
  assign handle = product_handle | default: card_product.handle
  if handle == blank
    assign handle = card_product.url | split: '/products/' | last | split: '?' | first | split: '#' | first
  endif
  case handle
${cases}
  endcase
  assign position = photo_index | default: 1 | minus: 1
  if position >= 0
    echo photos[position]
  endif
-%}
`);
