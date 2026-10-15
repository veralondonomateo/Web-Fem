import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {load} from 'cheerio';
import {Liquid} from 'liquidjs';
import {transformStorefront} from '../server/transform.ts';
import {restoreProductCardPhotos} from '../server/product-card-photos.ts';
import {renderNativeSection} from '../server/native-home.ts';
import {productPhotos,productPhotoUrl} from '../src/lib/product-photos.ts';

const pages=JSON.parse(readFileSync('tests/fixtures/navigation.json','utf8')) as {url:string;html:string}[];
test('Homepage retains its original banner while product cards use the collection photos',()=>{
  const image={src:'https://store.test/old-product.png',width:600,height:600,alt:'Previous photo'};
  const products=Object.fromEntries(Object.keys(productPhotos).map(handle=>[handle,{url:'/products/'+handle,title:handle,vendor:'Fem',featured_image:image,selected_or_first_available_variant:{price:10000,compare_at_price:12000,featured_image:image}}]));
  const $=load(renderNativeSection('home',products));
  assert.equal($('.fem-home-hero__image').attr('src'),'/__theme/fem-home-probiotics.webp');
  assert.equal($('.fem-home-hero__image').attr('width'),'662');
  assert.equal($('.fem-home-hero__image').attr('height'),'969');
  let cards=0;
  $('.fem-bestsellers__media').each((_,node)=>{
    const link=$(node),handle=link.attr('href')!.split('/products/')[1];
    assert.equal(link.find('img').attr('src'),'/__theme/'+productPhotos[handle][0].asset);
    cards++;
  });
  assert.equal(cards,8);
});

test('Every collection card uses the supplied main and hover photos for its own product',()=>{
  let collections=0,cards=0;
  for(const page of pages){
    const path=new URL(page.url).pathname;
    if(!path.startsWith('/collections/'))continue;
    const $=load(transformStorefront(page.html,path));
    $('[data-fem-layout="COLLECTION_TEMPLATE"] [data-fem-form-product-url]').each((_,node)=>{
      const card=$(node),handle=card.attr('data-fem-form-product-url')!.split('/products/')[1]?.split(/[?#]/)[0];
      if(!productPhotos[handle])return;
      cards++;
      for(const [index,selector] of ['[data-fem-dynamic-content-source="FEATURED_IMAGE"]','[data-trigger="hover"]'].entries()){
        const image=card.find('img'+selector).first(),photo=productPhotos[handle][index];
        assert.equal(image.attr('src'),'/__theme/'+photo.asset,path+' '+handle);
        assert.equal(Number(image.attr('width')),photo.width);
        assert.equal(Number(image.attr('height')),photo.height);
        assert.equal(image.attr('srcset'),undefined);
        assert.ok(existsSync('theme-source/assets/'+photo.asset));
      }
    });
    collections++;
  }
  assert.ok(collections>=3,'Check all fixture collections');
  assert.ok(cards>=14,'Check the supplied products across collections');
});

test('Liquid renders the same supplied photos and preserves markup for products without replacements',()=>{
  const engine=new Liquid({root:'theme-source/snippets',extname:'.liquid'});
  engine.registerTag('doc',{parse(_token,tokens){this.liquid.parser.parseStream(tokens).on('tag:enddoc',function(){this.stop();}).start();},render(){return '';}});
  engine.registerFilter('asset_url',(name:string)=>'/__theme/'+name);
  for(const [handle,photos] of Object.entries(productPhotos)){
    for(const [index,photo] of photos.entries()){
      const card_product={url:'/products/'+handle,title:'Producto <Fem>'};
      const $=load(engine.renderFileSync('fem-product-image',{card_product,photo_index:index+1,fallback:'<img src="old.png">',image_class:'card-photo',image_attributes:'data-trigger="hover"',loading:'eager'}));
      assert.equal($('img').attr('src'),'/__theme/'+photo.asset,handle);
      assert.equal($('img').attr('alt'),'Producto <Fem>');
      assert.equal(Number($('img').attr('width')),photo.width);
      assert.equal(Number($('img').attr('height')),photo.height);
      assert.equal($('img').attr('data-trigger'),'hover');
      assert.equal($('img').attr('loading'),'eager');
    }
  }
  const fallback='<img src="original.png" width="600" height="800" alt="Otro producto">';
  assert.equal(engine.renderFileSync('fem-product-image',{card_product:{handle:'unknown-product'},fallback}).trim(),fallback);
});

test('Cart photos resolve correctly on Shopify, localized product URLs and the local preview',()=>{
  const handle='combo-gomas-jabon',photo=productPhotos[handle][0];
  assert.equal(productPhotoUrl('/es/products/'+handle+'?variant=12','https://store.test/cdn/shop/t/9/assets/fem-runtime.js?v=1'),'https://store.test/cdn/shop/t/9/assets/'+photo.asset);
  assert.equal(productPhotoUrl(handle,'http://localhost:3000/__theme/fem-runtime.js'),'http://localhost:3000/__theme/'+photo.asset);
  assert.equal(productPhotoUrl('unknown-product','https://store.test/assets/runtime.js'),undefined);
});

test('Product photos update without changing testimonial portraits, icons or PDP gallery images',()=>{
  const handle='duo-perfecto',photo=productPhotos[handle][0];
  const html=`<div data-fem-form-product-url="/products/${handle}" data-fem-type="container"><div data-fem-type="media"><img class="fem-view-media" src="old-product.png" width="600" height="600"></div><div data-fem-type="slider"><div data-fem-type="media"><img class="fem-view-media" src="testimonial.png" width="600" height="600"></div></div><div data-fem-type="icon"><img src="icon.svg"></div><div data-fem-product-gallery="main"><img src="gallery.png" data-fem-dynamic-content-source="REPEATER"></div></div>`;
  const $=load(restoreProductCardPhotos(html));
  assert.equal($('img').eq(0).attr('src'),'/__theme/'+photo.asset);
  assert.equal($('img').eq(1).attr('src'),'testimonial.png');
  assert.equal($('img').eq(2).attr('src'),'icon.svg');
  assert.equal($('img').eq(3).attr('src'),'gallery.png');
});

test('Transparent Why photos preserve the supplied gallery photos',()=>{
  const route='/products/probiotico-vaginal-en-capsulas-x100-unidades';
  const page=pages.find(page=>new URL(page.url).pathname===route)!;
  const source=load(page.html),{variants}=JSON.parse(readFileSync('tests/fixtures/purchase-options.json','utf8'));
  // The navigation fixture omits the variant JSON required by the product presentation.
  source('[data-instant-layout="PRODUCT_TEMPLATE"] form[data-instant-form-product-url]').first().append(`<script type="application/json" id="variants__cutout-test">${JSON.stringify(variants)}</script>`);
  const $=load(transformStorefront(source.html(),route));
  const cutout=$('#iU9C9YzYgpbCFqY83 img[data-fem-preserve-photo]');
  assert.equal(cutout.length,1);
  assert.equal(cutout.attr('src'),'/__theme/fem-probioticos-why-transparent-v1.webp');
  assert.equal($('[data-fem-product-gallery="main"] img').first().attr('src'),'/__theme/'+productPhotos[route.split('/products/')[1]][0].asset);
  const other=pages.find(page=>new URL(page.url).pathname==='/products/duo-perfecto')!;
  const duo=load(transformStorefront(other.html,'/products/duo-perfecto'));
  assert.equal(duo('[data-fem-product-cutout] img').attr('src'),'/__theme/fem-duo-why-transparent-v1.webp');
  assert.equal(duo('[data-fem-product-gallery="main"] img').first().attr('src'),'/__theme/'+productPhotos['duo-perfecto'][0].asset);
});
