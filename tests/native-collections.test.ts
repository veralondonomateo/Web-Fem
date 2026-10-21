import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {load} from 'cheerio';
import {Liquid} from 'liquidjs';
import {renderCollectionsPage} from '../server/native-home.ts';
import {transformStorefront} from '../server/transform.ts';

const cards=[
  ['Combos Fem','combo-fem','combos'],
  ['Más vendidos','mas-vendidos','bestsellers'],
  ['Promos Fem','frontpage','promotions'],
  ['Todos los productos','todos-los-productos','all']
];
const fixture=JSON.parse(readFileSync('tests/fixtures/navigation.json','utf8')).find((page:{url:string})=>new URL(page.url).pathname==='/collections');

test('Collections render native editable cards, comparison and FAQ without builder markup',()=>{
  const html=renderCollectionsPage(),$=load(html);
  assert.doesNotMatch(html,/instant|fem-view|data-fem-id|<script/i);
  assert.equal($('h1').text(),'Colecciones');
  assert.equal($('.fem-collection-card').length,4);
  cards.forEach(([title,handle,artwork],index)=>{
    const card=$('.fem-collection-card').eq(index);
    assert.equal(card.find('h2').text(),title);
    assert.equal(card.attr('href'),'/collections/'+handle);
    const image=card.find('.fem-collection-card-photo');
    assert.equal(image.attr('src'),'/__theme/fem-collection-'+artwork+'.webp');
    assert.ok(Number(image.attr('width'))>0&&Number(image.attr('height'))>0);
    assert.ok(existsSync('theme-source/assets/fem-collection-'+artwork+'.webp'));
  });
  assert.equal($('.fem-collections-table tbody tr').length,5);
  assert.equal($('.fem-collections-table tbody th[scope=row]').length,5);
  assert.equal($('.fem-collections-question').length,4);
  assert.equal($('.fem-collections-question[open]').length,1);
  assert.equal($('.fem-collections-contact').attr('href'),'/pages/contact');
  assert.match($('.fem-collections-answer').last().text(),/toda Colombia/);
});

test('Preview replaces the whole collections main, preserves the shared header and local links',()=>{
  const $=load(transformStorefront(fixture.html,'/collections'));
  assert.equal($('main .fem-collections-page').length,1);
  assert.equal($('main .fem-collections-comparison').length,1);
  assert.equal($('main .fem-collections-faq').length,1);
  assert.doesNotMatch($('main').html()??'',/instant|fem-view|data-fem-id/i);
  assert.equal($('link[href="/__theme/fem-collections.css"]').length,1);
  assert.equal($('.fem-header').length,1);
  assert.equal($('#fem-cart-drawer').length,1);
  assert.equal($('main a[href="null"],main a[href="undefined"],main a[href=""]').length,0);
  assert.equal(load(transformStorefront(fixture.html))('main h1').text(),'Colecciones');
});

test('Embedded collections retain search results and avoid duplicating the page heading',()=>{
  const html='<!doctype html><main><h1>Buscar</h1><form action="/search"><input name="q" value="Fem"></form><div data-instant-id="jk0iO6ALDrfmfm6c">Old page</div></main>';
  const $=load(transformStorefront(html,'/search'));
  assert.equal($('main h1').text(),'Buscar');
  assert.equal($('input[name=q]').attr('value'),'Fem');
  assert.equal($('.fem-collection-card').length,4);
  assert.equal($('.fem-collections-breadcrumb,.fem-collections-comparison,.fem-collections-faq').length,0);

});

test('Merchant collection/image overrides and URL fallback render without legacy dependencies',()=>{
  const engine=new Liquid();
  engine.registerTag('schema',{parse(_token,tokens){this.liquid.parser.parseStream(tokens).on('tag:endschema',function(){this.stop();}).start();},render(){return '';}});
  engine.registerFilter('asset_url',(name:string)=>'/assets/'+name);
  engine.registerFilter('stylesheet_tag',()=> '');
  engine.registerFilter('image_url',(image:{src:string})=>image.src);
  const source=readFileSync('theme-source/sections/fem-collections.liquid','utf8');
  const context={section:{id:'custom',settings:{heading:'Elige tu colección',embedded:false},blocks:[
    {settings:{collection:{url:'/collections/custom',title:'Título real'},image:{src:'/custom.webp',width:900,height:1200}}},
    {settings:{link:'/collections/offers',title:'Ofertas'}},
    {settings:{title:'Todos'}}
  ]},routes:{root_url:'/',all_products_collection_url:'/collections/all'}};
  const $=load(engine.parseAndRenderSync(source,context));
  assert.deepEqual($('.fem-collection-card').map((_,node)=>$(node).attr('href')).get(),['/collections/custom','/collections/offers','/collections/all']);
  assert.equal($('.fem-collection-card-title').first().text(),'Título real');
  assert.equal($('.fem-collection-card-photo').first().attr('src'),'/custom.webp');
});
