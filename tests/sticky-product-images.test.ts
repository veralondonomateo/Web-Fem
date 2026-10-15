import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'cheerio';
import {transformStorefront} from '../server/transform.ts';
import {restoreProductCutouts} from '../server/product-cutouts.ts';
import {renderNativeSection} from '../server/native-home.ts';

const entries=JSON.parse(readFileSync('server/product-cutouts.json','utf8')) as {root:string;asset:string;stickyFrames:{media:string;width:number;height:number;className:string;viewBox:string}[]}[];
const variants=JSON.parse(readFileSync('server/product-cutout-variants.json','utf8')).images as Record<string,{variants:{asset:string}[]}>;
const pages=JSON.parse(readFileSync('tests/fixtures/navigation.json','utf8')) as {url:string;html:string}[];

test('The home fixed banner uses the new cutout in its original desktop and mobile image frames',()=>{
  const image={src:'old.png',width:460,height:690,alt:'Fem'};
  const handle='probiotico-vaginal-en-capsulas-x100-unidades';
  const $=load(renderNativeSection('home',{[handle]:{url:'/products/'+handle,title:'Probióticos Fem',vendor:'Fem Probiotics',featured_image:image,selected_or_first_available_variant:{price:11000000,compare_at_price:14990000,featured_image:image}}}));
  const frames=$('.fem-featured__media [data-fem-sticky-product-photo]');
  assert.equal(frames.length,2);
  frames.each((_,element)=>{
    const frame=$(element);
    assert.equal(frame.attr('width'),'460');
    assert.equal(frame.attr('height'),'690');
    assert.equal(frame.find('image').attr('href'),'/__theme/fem-probioticos-why-transparent-v1-384.webp');
    assert.equal(frame.attr('preserveAspectRatio'),'xMidYMid meet');
    assert.ok(frame.attr('viewBox')!.split(' ').every(value=>Number.isFinite(Number(value))));
  });
  assert.equal($('.fem-featured__link').attr('href'),'/products/'+handle);
  assert.equal($('.fem-home-hero__image').attr('src'),'/__theme/fem-home-probiotics.webp');
});

test('Every existing PDP fixed banner uses its product cutout and keeps its responsive dimensions',()=>{
  let banners=0;
  for(const page of pages){
    const path=new URL(page.url).pathname;
    if(!path.startsWith('/products/'))continue;
    const $=load(transformStorefront(page.html,path));
    const photo=entries.find(entry=>$(`[data-fem-layout="PRODUCT_TEMPLATE"].${entry.root}`).length);
    if(!photo?.stickyFrames.length)continue;
    const frames=$('[data-fem-sticky-product-photo]');
    assert.equal(frames.length,photo.stickyFrames.length,path);
    for(const dimensions of photo.stickyFrames){
      const frame=$('.'+dimensions.media+' [data-fem-sticky-product-photo]').filter((_,el)=>$(el).attr('class')===dimensions.className).first();
      assert.equal(Number(frame.attr('width')),dimensions.width,path);
      assert.equal(Number(frame.attr('height')),dimensions.height,path);
      assert.equal(frame.attr('viewBox'),dimensions.viewBox,path);
      assert.equal(frame.find('image').attr('href'),'/__theme/'+variants[photo.asset].variants[0].asset,path);
    }
    const repeated=load(restoreProductCutouts($.html()));
    assert.equal(repeated('[data-fem-sticky-product-photo]').length,frames.length,path);
    banners++;
  }
  assert.equal(banners,15,'Every catalog fixture with an active fixed banner');
});
