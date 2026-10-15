import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {Liquid} from 'liquidjs';
import {restoreProductCutouts} from '../server/product-cutouts.ts';

const entries=JSON.parse(readFileSync('server/product-cutouts.json','utf8')) as {section:string;root:string;media:string;asset:string;width:number;height:number}[];
const manifest=JSON.parse(readFileSync('server/product-cutout-variants.json','utf8')).images as Record<string,{original_bytes:number;original_sha256:string;variants:{asset:string;width:number;height:number;bytes:number}[]}>;

test('All cutout originals remain intact and mobile variants are smaller without upscaling',()=>{
  assert.equal(Object.keys(manifest).length,entries.length);
  for(const photo of entries){
    const original=readFileSync('theme-source/assets/'+photo.asset),data=manifest[photo.asset];
    assert.equal(createHash('sha256').update(original).digest('hex'),data.original_sha256,photo.asset);
    assert.equal(original.length,data.original_bytes);
    assert.ok(data.variants.length>=1&&data.variants.length<=2);
    assert.deepEqual(data.variants.map(v=>v.width),data.variants.map(v=>v.width).sort((a,b)=>a-b));
    if(original.length>=300*1024)assert.ok(data.variants.at(-1)!.bytes<original.length/2,photo.asset+' mobile bandwidth budget');
    for(const variant of data.variants){
      assert.equal(statSync('theme-source/assets/'+variant.asset).size,variant.bytes);
      assert.ok(variant.width<=photo.width);
      assert.equal(variant.height,Math.round(photo.height*variant.width/photo.width));
      assert.ok(variant.bytes<=original.length,variant.asset);
    }
  }
});

test('Native mobile sources use available widths while the original remains the desktop fallback',()=>{
  const engine=new Liquid();
  engine.registerTag('doc',{parse(_token,tokens){this.liquid.parser.parseStream(tokens).on('tag:enddoc',function(){this.stop();}).start();},render(){return '';}});
  engine.registerFilter('asset_url',(asset:string)=>'/__theme/'+asset);
  const source=readFileSync('theme-source/snippets/fem-cutout-sources.liquid','utf8');
  for(const photo of entries){
    const $=load(readFileSync(`theme-source/sections/${photo.section}.liquid`,'utf8'));
    const picture=$('[data-fem-product-cutout] > picture');
    assert.equal(picture.length,1,photo.section);
    assert.equal(picture.find('img').attr('src'),`{{ '${photo.asset}' | asset_url }}`);
    const rendered=load(engine.parseAndRenderSync(source,{photo_asset:photo.asset,photo_width:photo.width}));
    const mobile=rendered('source');
    assert.equal(mobile.attr('media'),'(max-width: 767px)');
    assert.equal(mobile.attr('srcset'),manifest[photo.asset].variants.map(v=>`/__theme/${v.asset} ${v.width}w`).join(', '));
  }
});

test('Preview cutouts select mobile sources without changing geometry or applying sources to galleries',()=>{
  for(const photo of entries){
    const html=`<div data-fem-layout="PRODUCT_TEMPLATE" class="${photo.root}"><div class="${photo.media}"><img src="old.webp"></div><div data-fem-product-gallery="main"><img src="gallery.webp"></div></div>`;
    const $=load(restoreProductCutouts(html));
    const picture=$('[data-fem-product-cutout] > picture');
    assert.equal(picture.find('img').attr('src'),'/__theme/'+photo.asset);
    assert.equal(Number(picture.find('img').attr('width')),photo.width);
    assert.equal(Number(picture.find('img').attr('height')),photo.height);
    assert.equal(picture.find('source').attr('srcset'),manifest[photo.asset].variants.map(v=>`/__theme/${v.asset} ${v.width}w`).join(', '));
    assert.equal($('[data-fem-product-gallery] source').length,0);
    assert.equal($('[data-fem-product-gallery] img').attr('src'),'gallery.webp');
  }
});
