import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {load} from 'cheerio';
import {Liquid} from 'liquidjs';
import {renderPlansPage} from '../server/native-home.ts';
import {transformStorefront} from '../server/transform.ts';

const destinations=[
  'https://checkout.treli.co/pl/pl_ogk6mvoz2vcjtaNDwkskk3wz',
  'https://checkout.treli.co/pl/pl_DayDD9T9aNzNcZegdD6tZYIb',
  'https://checkout.treli.co/pl/pl_rOi5wrxTpHtlDvvgwHtn1aia',
  'https://checkout.treli.co/pl/pl_8AKDDwxC9aUxayrCuIrbY3TL'
];

test('Plans render native cards, local photos and accessible benefits with the original destinations',()=>{
  const html=renderPlansPage(),$=load(html);
  assert.doesNotMatch(html,/instant|fem-view|data-fem-id|<script/i);
  assert.equal($('h1').text(),'Planes fem');
  assert.equal($('.fem-plan').length,4);
  assert.equal($('.fem-plan__badge').length,1);
  assert.equal($('.fem-plan--purple').length,1);
  assert.deepEqual($('.fem-plan__name').map((_,node)=>$(node).text()).get(),['Dúo Fem','Alimento con probióticos','Dúo Fem doble','Fem Mom']);
  assert.deepEqual($('.fem-plan__price strong').map((_,node)=>$(node).text()).get(),['$114.900','$89.900','$189.900','$89.900']);
  assert.deepEqual($('.fem-plan__price-period').map((_,node)=>$(node).text()).get(),Array(4).fill('/mes'));
  assert.equal($('.fem-plan__header .fem-plan__contents').length,4);
  assert.deepEqual($('.fem-plan__button').map((_,node)=>$(node).attr('href')).get(),destinations);
  assert.equal($('[data-fem-cart-add]').length,0);
  const photos=[
    ['fem-duo-gallery-1.webp',1254,1254],
    ['fem-probioticos-gallery-1.webp',2000,2000],
    ['fem-collection-promotions.webp',600,910],
    ['fem-fem-mom-gallery-1.webp',1761,1761]
  ];
  $('.fem-plan__image').each((index,node)=>{
    const image=$(node),src=image.attr('src')!;
    const [asset,width,height]=photos[index];
    assert.equal(src,'/__theme/'+asset);
    assert.ok(existsSync('theme-source/assets/'+src.split('/').pop()));
    assert.ok(image.attr('alt'));
    assert.equal(Number(image.attr('width')),width);
    assert.equal(Number(image.attr('height')),height);
  });
  assert.equal($('details.fem-plans__benefit').length,6);
  assert.equal($('details[open]').length,0);
  assert.equal($('details > summary').length,6);
});

test('Preview replaces Planes independently of legacy markup and keeps shared navigation',()=>{
  const fixture=JSON.parse(readFileSync('tests/fixtures/navigation.json','utf8')).find((page:{url:string})=>new URL(page.url).pathname==='/pages/planes-or-fem');
  const $=load(transformStorefront(fixture.html,'/pages/planes-or-fem'));
  assert.equal($('main .fem-plans').length,1);
  assert.doesNotMatch($('main').html()??'',/instant|fem-view|data-fem-id/i);
  assert.equal($('.fem-header').length,1);
  assert.equal($('.fem-footer').length,1);
  assert.equal($('#fem-cart-drawer').length,1);
  assert.equal($('link[href="/__theme/fem-subscription-plans.css"]').length,1);
  assert.deepEqual($('main .fem-plan__button').map((_,node)=>$(node).attr('href')).get(),destinations);
  const independent=load(transformStorefront('<!doctype html><head><link rel="canonical" href="https://femprobiotics.co/pages/planes-or-fem"></head><body><main>Contenido anterior eliminado</main></body>'));
  assert.equal(independent('main .fem-plan').length,4);
  const native=JSON.parse(readFileSync('theme-source/templates/page.planes-fem.json','utf8'));
  const compatible=JSON.parse(readFileSync('theme-source/templates/page.instant-zX2zkAycloBh8C5v.json','utf8'));
  assert.deepEqual(compatible,native);
});

test('Merchant image, content, price and destination overrides render in the native section',()=>{
  const engine=new Liquid();
  engine.registerTag('schema',{parse(_token,tokens){this.liquid.parser.parseStream(tokens).on('tag:endschema',function(){this.stop();}).start();},render(){return '';}});
  engine.registerFilter('asset_url',(name:string)=>'/assets/'+name);
  engine.registerFilter('stylesheet_tag',()=> '');
  engine.registerFilter('image_url',(image:{src:string})=>image.src);
  engine.registerFilter('t',(key:string)=>key);
  const source=readFileSync('theme-source/sections/fem-subscription-plans.liquid','utf8');
  const context={section:{id:'custom',settings:{heading:'Mis planes'},blocks:[{id:'custom-plan',type:'plan',settings:{title:'Plan personalizado',contents:'2 productos',benefits:'Envío gratis\nRegalos',price:'$99.900',link:'https://checkout.treli.co/pl/custom',image:{src:'/custom.webp',width:900,height:900}}}]},routes:{root_url:'/'}};
  const $=load(engine.parseAndRenderSync(source,context));
  assert.equal($('h1').text(),'Mis planes');
  assert.equal($('.fem-plan__image').attr('src'),'/custom.webp');
  assert.equal($('.fem-plan__image').attr('alt'),'Plan personalizado');
  assert.equal($('.fem-plan__price strong').text(),'$99.900');
  assert.equal($('.fem-plan__name').text(),'Plan personalizado');
  assert.match($('.fem-plan__contents').text(),/2 productos/);
  assert.equal($('.fem-plan__button').attr('href'),'https://checkout.treli.co/pl/custom');
  assert.equal($('.fem-plan__features li').length,2);
});
