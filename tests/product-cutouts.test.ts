import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {load} from 'cheerio';
import {transformStorefront} from '../server/transform.ts';
import {restoreProductCutouts} from '../server/product-cutouts.ts';

const cutouts=JSON.parse(readFileSync('server/product-cutouts.json','utf8')) as {section:string;root:string;media:string;asset:string;width:number;height:number}[];
const pages=JSON.parse(readFileSync('tests/fixtures/navigation.json','utf8')) as {url:string;html:string}[];

test('All twenty native product templates have a dedicated transparent Why photo',()=>{
  assert.equal(cutouts.length,20);
  for(const photo of cutouts){
    const source=readFileSync(`theme-source/sections/${photo.section}.liquid`,'utf8');
    const $=load(source),media=$('[data-fem-product-cutout]');
    assert.equal(media.length,1,photo.section);
    assert.equal(media.attr('class'),photo.media);
    assert.equal(media.find('img').length,1,'One photo serves all breakpoints');
    assert.equal(media.find('img').attr('src'),`{{ '${photo.asset}' | asset_url }}`);
    assert.equal(media.find('img').attr('data-fem-preserve-photo'),'');
    assert.equal(Number(media.find('img').attr('width')),photo.width);
    assert.equal(Number(media.find('img').attr('height')),photo.height);
    assert.ok(source.includes("'fem-product-cutouts.css' | asset_url | stylesheet_tag"));
    assert.ok(existsSync('theme-source/assets/'+photo.asset),photo.asset);
  }
});

test('Every catalog PDP uses its own cutout without replacing gallery images or portraits',()=>{
  let checked=0;
  for(const page of pages){
    const path=new URL(page.url).pathname;
    if(!path.startsWith('/products/'))continue;
    const $=load(transformStorefront(page.html,path));
    const photo=cutouts.find(photo=>$(`[data-fem-layout="PRODUCT_TEMPLATE"].${photo.root}`).length);
    if(!photo)continue;
    const media=$('[data-fem-product-cutout]');
    assert.equal(media.length,1,path);
    assert.equal(media.find('img[data-fem-preserve-photo]').attr('src'),'/__theme/'+photo.asset,path);
    assert.equal($('[data-fem-product-gallery] [data-fem-preserve-photo]').length,0,path);
    assert.equal($('link[href="/__theme/fem-product-cutouts.css"]').length,1,path);
    const repeated=load(restoreProductCutouts($.html()));
    assert.equal(repeated('[data-fem-product-cutout] img').length,1,path);
    assert.equal(repeated('link[href="/__theme/fem-product-cutouts.css"]').length,1,path);
    checked++;
  }
  assert.equal(checked,18,'All catalog fixtures with a Why section, including double packs and soda');
});
