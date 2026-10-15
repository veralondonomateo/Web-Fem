import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {load} from 'cheerio';
import {transformStorefront} from '../server/transform.ts';
import {renderNativeSection} from '../server/native-home.ts';

const pages=JSON.parse(readFileSync('tests/fixtures/navigation.json','utf8')) as {url:string;html:string}[];
const photos=JSON.parse(readFileSync('server/product-images.json','utf8')) as Record<string,{asset:string;width:number;height:number;alt?:string}>;

test('Product galleries retain their assigned photos and serve complete local image files',()=>{
  let checked=0;
  for(const page of pages){
    if(!new URL(page.url).pathname.startsWith('/products/'))continue;
    // These products replace Shopify's original galleries with six supplied files, checked below.
    if(['/products/probiotico-vaginal-en-capsulas-x100-unidades','/products/fem-mom-impulso-natural-de-leche-materna'].includes(new URL(page.url).pathname)){checked++;continue;}
    const source=load(page.html),result=load(transformStorefront(page.html,new URL(page.url).pathname));
    const assignedFile:Record<string,string>={'/products/gomitas-sindrome-premestrual-x60':'gomas-gallery.json','/products/ovulos-vaginales-fem':'ovulos-gallery.json','/products/duo-perfecto':'duo-gallery.json','/products/combo-premestrual-x-fem':'gomas-pro-gallery.json','/products/combo-fem-x-ovulos':'ovulos-pro-gallery.json','/products/combo-ovulos-x-jabon':'ovulos-jab-gallery.json','/products/combo-completo':'combo-compl-gallery.json','/products/combo-dia-de-la-mujer':'pro-gom-jab-gallery.json','/products/probiotico-jabon-ovulos':'pro-jab-ovu-gallery.json','/products/combo-gomas-jabon':'gomas-jab-gallery.json','/products/combo-mama':'combo-mama-gallery.json'};
    const assignedPhotos=assignedFile[new URL(page.url).pathname]?JSON.parse(readFileSync('server/'+assignedFile[new URL(page.url).pathname],'utf8')):undefined;
    const before=source('[data-instant-layout="PRODUCT_TEMPLATE"] [data-instant-type="slider"] img,[data-instant-layout="PRODUCT_TEMPLATE"] [data-instant-type="thumbnails"] img').filter('[data-instant-dynamic-content-source="REPEATER"]');
    const after=result('[data-fem-product-gallery] img').filter('[data-fem-dynamic-content-source="REPEATER"]');
    if(!before.length)continue;
    assert.equal(after.length,before.length,page.url);
    before.each((index,image)=>{
      const original=source(image).attr('src')!,url=new URL(original,'https://femprobiotics.co');
      const current=after.eq(index);
      const photo=assignedPhotos?.[Number(current.attr('data-fem-repeater-index'))]??photos[url.pathname.split('/').pop()+'?v='+(url.searchParams.get('v')??'')];
      if(photo){
        assert.equal(current.attr('src'),'/__theme/'+photo.asset,page.url);
        assert.ok(existsSync('theme-source/assets/'+photo.asset),photo.asset);
        assert.equal(Number(current.attr('width')),photo.width);
        assert.equal(Number(current.attr('height')),photo.height);
      }else assert.match(current.attr('src')??'',/^https:\/\//);
      assert.equal(current.attr('alt'),photo?.alt||source(image).attr('alt')||result('[data-fem-dynamic-content-source="TITLE"]').first().text().trim());
    });
    assert.ok(result('[data-fem-product-gallery="thumbnails"]').length,page.url);
    checked++;
  }
  assert.ok(checked>=17,'Check the full set of product templates');
});

test('The probiotic and Fem Mom products use all six supplied images in the same order in every gallery view',()=>{
  for(const [route,manifest,section] of [
    ['/products/probiotico-vaginal-en-capsulas-x100-unidades','probioticos-gallery.json','fem-product-probioticos'],
    ['/products/fem-mom-impulso-natural-de-leche-materna','fem-mom-gallery.json','fem-product-mom']
  ]){
    const page=pages.find(page=>new URL(page.url).pathname===route)!;
    const photos=JSON.parse(readFileSync('server/'+manifest,'utf8')) as {asset:string;width:number;height:number;alt:string}[];
    assert.equal(photos.length,6);
    const $=load(transformStorefront(page.html,route));
    for(const role of ['thumbnails','main','zoom']){
      const view=$(`[data-fem-product-gallery="${role}"]`).first();
      const images=view.find('img[data-fem-dynamic-content-source="REPEATER"]').filter((_,image)=>$(image).closest('[data-fem-product-gallery]')[0]===view[0]);
      assert.equal(images.length,6,route+' '+role);
      images.each((index,image)=>{
        const img=$(image),photo=photos[index];
        assert.equal(img.attr('src'),'/__theme/'+photo.asset,role);
        assert.equal(img.attr('alt'),photo.alt);
        assert.equal(Number(img.attr('width')),photo.width);assert.equal(Number(img.attr('height')),photo.height);
        assert.equal(img.attr('data-fem-repeater-index'),String(index));
        assert.ok(existsSync('theme-source/assets/'+photo.asset));
      });
    }
    const buttons=$('[data-fem-product-gallery="main"] > .fem-view-slider-wrapper > * > button');
    assert.deepEqual(buttons.map((_,button)=>$(button).attr('data-fem-overlay-active-slide')).get(),['0','1','2','3','4','5']);
    const thumbnailId=$('[data-fem-product-gallery="thumbnails"]').first().attr('id');
    const config=JSON.parse($(`script[id="fem-view-slider-${thumbnailId}-params"]`).text());
    assert.ok(Object.values(config.breakpoints).every((point:any)=>point.slidesPerView===5));
    const native=load(readFileSync(`theme-source/sections/${section}.liquid`,'utf8'));
    const nativeConfig=JSON.parse(native(`script[id="fem-view-slider-${thumbnailId}-params"]`).text());
    assert.ok(Object.values(nativeConfig.breakpoints).every((point:any)=>point.slidesPerView===5));
  }
});

test('Pages share the home header structure with a purple variant for maternal products',()=>{
  const routes=['/','/collections/todos-los-productos','/search','/pages/contact','/products/jabon-intimo-ph-neutro','/products/probiotico-vaginal-en-capsulas-x100-unidades','/products/fem-mom-impulso-natural-de-leche-materna','/products/fem-mom-2-unidades','/products/combo-mama'];
  const maternal=new Set(['fem-mom-impulso-natural-de-leche-materna','fem-mom-2-unidades','combo-mama']);
  const defaultHeader=renderNativeSection('header',{},'/');
  for(const route of routes){
    const header=renderNativeSection('header',{},route),$=load(header);
    assert.equal($('.fem-header').attr('data-fem-header-theme'),maternal.has(route.split('/products/')[1])?'maternal':'default',route);
    assert.equal(header.replace('data-fem-header-theme="maternal"','data-fem-header-theme="default"'),defaultHeader,route);
  }
  const expected=load(defaultHeader)('.fem-header').html();
  for(const page of pages){
    const $=load(transformStorefront(page.html,new URL(page.url).pathname));
    assert.equal($('.fem-header').length,1,page.url);
    assert.equal($('.fem-header').html(),expected,page.url);
  }
});

test('Gallery configuration survives removal of the builder and retains five thumbnails',()=>{
  const html='<html><head></head><body><main><section data-instant-id="test" data-instant-layout="PRODUCT_TEMPLATE"><script type="application/json" id="instant-slider-ithumbs-params">{"breakpoints":{"0":{"slidesPerView":5,"spaceBetween":14}},"thumbs":{"swiper":".instant-slider-main"}}</script><div id="ithumbs" data-instant-type="thumbnails" data-instant-slider-id="main"><div class="instant-slider-wrapper"><div><img src="https://femprobiotics.co/cdn/shop/files/test.webp" alt="Test" data-instant-dynamic-content-source="REPEATER"></div></div></div></section></main></body></html>';
  const $=load(transformStorefront(html,'/products/test'));
  const config=JSON.parse($('#fem-view-slider-ithumbs-params').text());
  assert.equal(config.breakpoints['0'].slidesPerView,5);
  assert.equal(config.breakpoints['0'].spaceBetween,14);
  assert.equal(config.thumbs,undefined);
  assert.equal($('#ithumbs').attr('data-fem-type'),'thumbnails');
});

test('The Ecuador template keeps the shared header visible and removes its duplicate navigation',()=>{
  const html='<html><body><div id="header-group"><div data-instant-id="Kikh7VzmQY85iams">Old theme header</div></div><main><section data-instant-id="bmPzy6K28rNrqB8Y" data-instant-layout="PRODUCT_TEMPLATE"><style>/* HEADER */ .shopify-section-group-header-group, header { display: none !important; } /* FOOTER */ footer { display: none !important; }</style><div id="ikuG5rUTUFtiEv7Gd">Duplicate navigation</div><div id="i5MX4XVtpzDy5o1qF">Duplicate mobile menu</div><h1>Alimento con probióticos</h1></section></main></body></html>';
  const $=load(transformStorefront(html,'/products/alimento-con-probioticos-prebioticos-ecu'));
  assert.equal($('.fem-header').length,1);
  assert.equal($('#ikuG5rUTUFtiEv7Gd,#i5MX4XVtpzDy5o1qF').length,0);
  assert.doesNotMatch($('style').text(),/shopify-section-group-header-group/);
  assert.match($('style').text(),/footer \{ display: none !important/);
  assert.equal($('main h1').text(),'Alimento con probióticos');
});
