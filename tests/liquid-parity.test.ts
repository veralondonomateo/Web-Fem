import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'cheerio';
import {transformStorefront} from '../server/transform.ts';
import {productsFromStorefront,renderNativeSection} from '../server/native-home.ts';
import {productPhotos} from '../src/lib/product-photos.ts';
const fixture=readFileSync(new URL('./fixtures/native-home.html',import.meta.url),'utf8');
const original=load(fixture);
const rendered=load(transformStorefront(fixture,'/'));
const normalized=(text:string)=>text.replace(/\s+/g,'');

test('Native homepage keeps every product, live price and product destination',()=>{
 const products=productsFromStorefront(fixture);
 const cards=rendered('.fem-bestsellers__section article');
 assert.equal(cards.length,8);
 cards.each((_,node)=>{
   const card=rendered(node),href=card.find('a').first().attr('href')!;
   const product=products[href.split('/products/')[1]];
   assert.ok(product,href);
   assert.ok(card.text().includes(product.title));
   assert.ok(card.text().includes('$'+new Intl.NumberFormat('es-CO',{minimumFractionDigits:2}).format(product.selected_or_first_available_variant.price/100)));
   assert.equal(card.find('a').last().attr('href'),href);
   assert.equal(card.find('img').attr('src'),'/__theme/'+productPhotos[href.split('/products/')[1]][0].asset);
 });
 assert.equal(rendered('.fem-native a[href=""],.fem-native img[src=""]').length,0);
});

test('Native homepage has no Instant runtime, stylesheet, attributes or remote media',()=>{
 assert.equal(rendered('[data-instant-id],.__instant').length,0);
 for(const node of rendered('[src],[href],[data-src]').toArray())for(const key of ['src','href','data-src'])assert.doesNotMatch(node.attribs[key]??'',/instant\.so|instant-.*\.(js|css)/i);
 assert.equal(rendered('[data-fem-carousel]').length,3);
 assert.equal(rendered('.fem-faq__section [data-fem-accordion-item]').length,4);
 assert.equal(rendered('.fem-anniversary,video[src$="fem-anniversary-video.mp4"]').length,0);
 assert.equal(rendered('.fem-home-hero h1').text(),'Salud femenina');
 assert.deepEqual(rendered('.fem-home-hero__actions a').map((_,el)=>rendered(el).attr('href')).get(),['/collections/todos-los-productos','/pages/quiz1']);
 assert.equal(rendered('.fem-home-hero__image').attr('loading'),'eager');
 assert.equal(rendered('.fem-home-hero__benefits li').length,0);
});

test('FAQ copy, article destinations and SVG references survive the migration',()=>{
 const before=original('[data-instant-id="QpL8HGFa3rotk5kl"]');
 const oldAnswers=before.find('[data-instant-type="accordion-content"]').map((_,e)=>normalized(original(e).text())).get();
 const answers=rendered('.fem-faq__section [data-fem-accordion-content]').map((_,e)=>normalized(rendered(e).text())).get();
 assert.deepEqual(answers,oldAnswers);
 const destinations=(root:ReturnType<typeof load>,selector:string)=>root(selector).find('a[href^="https://www."]').map((_,e)=>root(e).attr('href')).get();
 assert.deepEqual(destinations(rendered,'.fem-press__section'),destinations(original,'.iqAioqgfc8sFe8FBL'));
 rendered('.fem-native use[href^="#fem-"]').each((_,e)=>assert.equal(rendered(rendered(e).attr('href')!).length,1));
});

test('A product without a discount hides its badge and comparison price',()=>{
 const products=productsFromStorefront(fixture),product=products['duo-perfecto'];
 product.selected_or_first_available_variant.compare_at_price=null;
 const $=load(renderNativeSection('home',products));
 const card=$('.fem-bestsellers__section article').first();
 assert.match(card.find('.fem-bestsellers__layout-3').attr('style')??'',/display:\s*none/);
 assert.match(card.find('.fem-bestsellers__span-2').attr('style')??'',/display:\s*none/);
});

test('The second bestseller uses the current Shopify probiotic handle, its gallery and live price',()=>{
 const oldHandle='probiotico-vaginal-en-capsulas-x100-unidades';
 const handle='probiotico-vaginal-en-capsulas-x60-unidades';
 const home=load(transformStorefront(fixture.replaceAll(oldHandle,handle),'/'));
 const card=home('.fem-bestsellers__section article').eq(1);
 assert.equal(home('.fem-bestsellers__section article').length,8);
 assert.equal(card.find('a').first().attr('href'),'/products/'+handle);
 assert.equal(card.find('a').last().attr('href'),'/products/'+handle);
 assert.equal(card.find('.fem-bestsellers__product-title').text(),'Alimento con probióticos y prebióticos x 60 UND');
 assert.equal(card.find('.fem-bestsellers__price-2').text().trim(),'$110.000,00');
 assert.equal(card.find('img').attr('src'),'/__theme/'+productPhotos[handle][0].asset);
 assert.doesNotMatch(card.text(),/NaN/);
 assert.equal(home('.fem-featured__link').attr('href'),'/products/'+handle);
});

test('Unavailable bestseller products never render blank images, empty destinations or NaN prices',()=>{
 const products=productsFromStorefront(fixture);
 delete products['probiotico-vaginal-en-capsulas-x100-unidades'];
 const home=load(renderNativeSection('home',products));
 const cards=home('.fem-bestsellers__section');
 assert.equal(cards.find('article').length,7);
 assert.equal(cards.find('img[src=""],a[href=""]').length,0);
 assert.doesNotMatch(cards.text(),/NaN/);
});
