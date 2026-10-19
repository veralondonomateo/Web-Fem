import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'cheerio';
import {Liquid} from 'liquidjs';
import {productsFromStorefront,renderNativeSection} from '../server/native-home.ts';

test('Home leads with products and preserves catalog destinations without anonymous endorsements',()=>{
  const fixture=readFileSync('tests/fixtures/native-home.html','utf8');
  const products=productsFromStorefront(fixture);
  const $=load(renderNativeSection('home',products));
  const sections=$('.fem-home__root').children().filter((_,node)=>$(node).is('section,div')).toArray();
  assert.ok($(sections[0]).is('.fem-home-hero'));
  assert.ok($(sections[1]).is('.fem-bestsellers__section'));
  assert.equal($('.fem-marquee__section,.fem-home-hero__benefits,.fem-home-specialists').length,0);
  assert.equal($('.fem-home-hero__image').attr('src'),'/__theme/fem-home-probiotics.webp');
  assert.deepEqual($('.fem-home-hero__actions a').map((_,a)=>$(a).attr('href')).get(),['/collections/todos-los-productos','/pages/quiz1']);
  for(const handle of ['duo-perfecto','probiotico-vaginal-en-capsulas-x100-unidades','jabon-intimo-ph-neutro']) {
    assert.ok($(`.fem-bestsellers__section a[href="/products/${handle}"]`).length>0);
  }
  assert.doesNotMatch($('.fem-home__root').text(),/Respaldado por expertos|Respaldado por estudios clínicos|Sin contraindicaciones/);
});

test('Trust cards identify the official source and retain usable product and support paths',()=>{
  const $=load(renderNativeSection('home',{}));
  assert.equal($('.fem-home-sources__card').length,3);
  const registry=$('.fem-home-sources a[href="https://www.invima.gov.co/consulta-registros-sanitarios"]');
  assert.equal(registry.length,1);
  assert.equal(registry.attr('target'),'_blank');
  assert.match(registry.attr('rel')??'',/noopener/);
  assert.match($('.fem-home-sources').text(),/Instituto Nacional de Vigilancia/);
  assert.equal($('.fem-home-sources a[href="/pages/contact"]').length,1);
  assert.equal($('.fem-home-sources a[href="/collections/todos-los-productos"]').length,1);
});

test('Expert profiles require an identity, credentials and source and escape merchant content',()=>{
  const engine=new Liquid();
  engine.registerTag('doc',{parse(_token,tokens){this.liquid.parser.parseStream(tokens).on('tag:enddoc',function(){this.stop();}).start();},render(){return '';}});
  const source=readFileSync('theme-source/snippets/fem-home-experts.liquid','utf8');
  const complete={type:'expert',settings:{name:'Perfil de prueba <script>',credentials:'Especialidad de prueba',affiliation:'Institución de prueba',contribution:'Colaboración documentada',source_url:'https://example.com/perfil'}};
  const missing=['name','credentials','source_url'].map(field=>({...complete,settings:{...complete.settings,[field]:''}}));
  const $=load(engine.parseAndRenderSync(source,{section:{id:'test',blocks:[complete,...missing]}}));
  assert.equal($('.fem-home-specialist').length,1);
  assert.equal($('.fem-home-specialist h3').text(),'Perfil de prueba <script>');
  assert.equal($('script').length,0);
  assert.equal($('.fem-home-specialist__credentials').text(),'Especialidad de prueba');
  assert.equal($('.fem-home-specialist a').attr('href'),'https://example.com/perfil');
  const absent=load(engine.parseAndRenderSync(source,{section:{id:'test',blocks:missing}}));
  assert.equal(absent('.fem-home-specialists').length,0);
});
