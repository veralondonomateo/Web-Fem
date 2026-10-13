"use client";
import {useEffect, useRef, useState} from "react";

export default function LoveShare({url,total,preview=false,onClose}:{url:string;total:number;preview?:boolean;onClose:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null);
 const [notice,setNotice]=useState("");
 const message=`Tengo un antojito de bienestar 💗 ¿Me consientes con este pedido de FEM? Ya elegí todo; tú solo haces el pago.`;
 useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close()},[]);
 async function copy(instagram=false){try{await navigator.clipboard.writeText(`${message}\n${url}`);setNotice(instagram?'Mensaje copiado. Pégalo en tu chat de Instagram 💗':'¡Enlace copiado! Listo para enviarlo.')}catch{setNotice('Selecciona y copia el enlace de abajo.')}}
 async function share(){if(!navigator.share)return copy();try{await navigator.share({title:'Un detallito FEM para mí 💗',text:message,url})}catch(e){if((e as Error).name!=='AbortError')setNotice('Puedes copiar el enlace y enviarlo por tu app favorita.')}}
 return <dialog ref={dialog} className="fem-love-dialog" onCancel={onClose} onClick={e=>{if(e.target===dialog.current)onClose()}}>
  <button type="button" className="fem-love-close" aria-label="Cerrar tarjeta" onClick={onClose}>×</button>
  <div className="fem-love-art"><img src="/__theme/fem-logo-fem-web-a760cdd1.svg" className="fem-love-logo" width="86" height="28" alt="FEM"/><span className="fem-love-orbit" aria-hidden="true">♡</span><p>MI FORMA FAVORITA DE DECIR</p><h2>¿Me consientes<br/>un poquito?</h2><div className="fem-love-stamp">Elegido por mí.<br/>Con amor, de ti.</div></div>
  <div className="fem-love-body"><h3>Un detallito que me hace bien 💗</h3><p>{preview?"Así se verá tu tarjeta. En la compra real, primero guardas tus datos de entrega y luego compartes el enlace de pago.":"Tu pedido está listo para compartir. Esa persona paga con Mercado Pago; los datos de entrega ya quedan guardados."}</p>
  <div className="fem-love-total"><span>Total del pedido</span><strong>{new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(total)}</strong></div>
  {preview&&<p className="fem-love-demo">Vista previa: no crea pedidos ni cobra. Este enlace local solo abre en este computador.</p>}
  <div className="fem-love-actions"><a target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(message+'\n'+url)}`}>WhatsApp ↗</a><button type="button" onClick={()=>copy(true)}>Instagram ♡</button><button type="button" onClick={()=>copy()}>Copiar enlace</button><button type="button" onClick={share}>Compartir…</button></div>
  <p className="fem-love-help">Instagram: copia el mensaje y pégalo en un DM. En el celular también puedes elegir una app desde Compartir.</p>
  <input aria-label="Enlace para compartir" readOnly value={url} onFocus={e=>e.target.select()}/><p role="status" className="fem-love-notice">{notice}</p>
  <p className="fem-love-help">Comparte en privado. El enlace permite ver el pedido y pagarlo. Mercado Pago puede pedir los datos de quien paga.</p>
  </div>
 </dialog>
}
