import type {CheerioAPI} from 'cheerio';
import type {CatalogProduct} from './catalog.ts';
import {renderProductFaq} from './native-home.ts';

function usage(product:CatalogProduct):string {
  const handle=product.handle;
  if(/combo|duo|probiotico-jabon/.test(handle))return 'Sigue las indicaciones del empaque de cada producto del combo. Cada uno tiene su propio modo de uso; el jabón íntimo se utiliza únicamente en la zona externa y se enjuaga con abundante agua.';
  if(handle==='jabon-intimo-ph-neutro')return 'Aplica una pequeña cantidad en la mano, lava suavemente únicamente la zona externa de la vulva y enjuaga con abundante agua. Uso externo únicamente. No introducir.';
  if(handle==='ovulos-vaginales-fem')return 'Los óvulos son de uso vaginal. Sigue las instrucciones del empaque y las indicaciones del profesional que te acompaña.';
  if(handle.includes('soda'))return 'Es una bebida lista para consumir, preferiblemente fría. Sigue las indicaciones de consumo y conservación de la etiqueta.';
  if(handle.includes('gomitas'))return 'La información de esta presentación indica consumir 2 gomitas al día. Revisa las indicaciones de la etiqueta antes de incorporarlas a tu rutina.';
  if(handle.includes('fem-mom'))return 'La información de esta presentación indica tomar 2 tabletas al día. Sigue las indicaciones del empaque para su consumo.';
  if(handle.includes('probiotico'))return 'La información de esta presentación indica consumir 2 unidades al día. Sigue las indicaciones del empaque del producto.';
  return 'Sigue el modo de uso indicado en el empaque de esta presentación. Puedes consultar nuestros canales de atención si necesitas ayuda para encontrar esta información.';
}

/** Add one shared FAQ to each owned product page without changing purchase controls. */
export function addProductFaq($:CheerioAPI,product:CatalogProduct):void {
  if($('.fem-product-faq').length)return;
  const faq=renderProductFaq('fem-product-faq-'+product.id,[
    {question:'¿Cómo se usa?',answer:usage(product)},
    {question:'¿Qué incluye esta presentación?',answer:'La presentación que estás viendo es: '+product.title+'. Consulta las imágenes y la información del producto; si hay varias opciones, revisa la que seleccionaste antes de añadirla al carrito.'},
    {question:'¿Cómo debo conservarlo?',answer:'Consérvalo en su empaque original y sigue las condiciones de almacenamiento y la fecha de vencimiento indicadas en la etiqueta de cada producto.'},
    {question:'¿Cuánto tarda el envío?',answer:'El tiempo estimado de entrega es de 3 a 7 días hábiles, sin contar festivos. Confirma la cobertura y las condiciones de entrega de tu dirección antes de finalizar la compra.'},
    {question:'¿Dónde puedo recibir asesoría?',answer:'Puedes escribirnos por la Línea WhatsApp o enviarnos tu consulta desde PQRS. Los botones de esta sección te llevan a nuestros canales de atención.'},
  ]);
  const root=$('[data-fem-layout="PRODUCT_TEMPLATE"]').first();
  const blockForHeading=(pattern:RegExp)=>{
    const heading=root.find('h2,h3').filter((_,node)=>pattern.test($(node).text().trim())).first();
    return heading.parents().filter((_,node)=>$(node).parent().is('form[data-fem-type="root"], [data-fem-layout="PRODUCT_TEMPLATE"]')).first();
  };
  const family=blockForHeading(/^Haz parte de la familia Fem$/i);
  const testimonials=blockForHeading(/^Testimonios$/i);
  if(family.length)family.after(faq);
  else if(testimonials.length)testimonials.before(faq);
  else if(root.length)root.append(faq);
  else $('#MainContent').children().first().after(faq);
  $('head').append('<link rel="stylesheet" href="/__theme/fem-product-faq.css">');
}
