import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {renderOwnedPage} from '../server/owned-renderer.ts';
import {searchCatalog} from '../server/catalog.ts';

const page=(q:string)=>load(renderOwnedPage(new URL('/search?q='+encodeURIComponent(q),'https://fem.test'))!);
test('Independent search keeps its submit button, category and price controls',()=>{
  const $=page('jabón');
  assert.equal($('input[name="q"]').attr('value'),'jabón');
  assert.equal($('form[action="/search"] button[type="submit"]').length,1);
  assert.equal($('[data-fem-catalog-filters]').length,1);
  assert.ok($('input[type="number"]').length>=2);
});
test('Accent-insensitive search resolves the owned catalog without network calls',t=>{
  t.mock.method(globalThis,'fetch',()=>{throw Error('Search must not call a remote storefront');});
  const links=(q:string)=>{const $=page(q);return $('.fem-search-card').map((_,n)=>n.attribs.href).get();};
  assert.deepEqual(links('jabon'),links('jabón'));
  assert.ok(page('jabón')('.fem-search-card').length);
});
test('Search combines all query terms and links to the matching product pages',()=>{
  const query='probióticos jabón',$=page(query),matches=searchCatalog(query);
  assert.equal($('.fem-search-card').length,matches.length);
  assert.deepEqual($('.fem-search-card').map((_,n)=>n.attribs.href).get(),matches.map(p=>p.url));
});
test('An empty query leaves a usable search form and the collection links',()=>{
  const $=page('');assert.equal($('input[name="q"]').attr('value'),'');
  assert.equal($('.fem-search-card').length,0);assert.equal($('.fem-collection-card').length,4);
  assert.doesNotMatch($('main').text(),/No encontramos/);
});
test('No-match search explains the result and preserves the query',()=>{
  const $=page('producto-imposible-xyz');
  assert.equal($('.fem-search-card').length,0);assert.match($('main').text(),/No encontramos productos/);
  assert.equal($('input[name="q"]').attr('value'),'producto-imposible-xyz');
});
test('Search text cannot add HTML or collide with internal page markers',()=>{
  for(const q of ['"><img src=x onerror=alert(1)>','__FEM_RESULTS__ __FEM_ORIGIN__ __FEM_QUERY__']){
    const $=page(q);assert.equal($('input[name="q"]').attr('value'),q);assert.equal($('img[src="x"],[onerror]').length,0);
    assert.equal($('[data-fem-catalog-list]').length,1);
  }
});
test('Search cards keep their images, prices and product destinations local',()=>{
  const $=page('fem');assert.ok($('.fem-search-card').length);
  $('.fem-search-card').each((_,node)=>{
    assert.match($(node).attr('href')!,/^\/products\//);
    assert.match($(node).find('img').first().attr('src')!,/^\/__theme\//);
    assert.doesNotMatch($(node).text(),/NaN/);
  });
});
