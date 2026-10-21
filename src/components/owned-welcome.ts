import {enhanceScratchPromotion} from './scratch-promotion.ts';
/** Own welcome form, using the existing scratch-card design and opening schedule. */
export function initializeOwnedWelcome(){
 if(!document.documentElement.hasAttribute('data-fem-independent'))return;
 window.addEventListener('fem:welcome-open',()=>{
  let dialog=document.querySelector<HTMLDialogElement>('#fem-owned-welcome');
  if(!dialog){
   dialog=document.createElement('dialog');dialog.id='fem-owned-welcome';dialog.setAttribute('aria-label','Tu descuento de bienvenida');
   dialog.innerHTML='<button type="button" class="klaviyo-close-form" aria-label="Cerrar">×</button><div data-testid="POPUP"><form data-testid="klaviyo-form-QX2wGL" action="/contact" method="post"><div class="fem-owned-welcome-layout"><div class="details"><div data-testid="form-row"><label for="fem-welcome-email">Correo electrónico</label><input id="fem-welcome-email" type="email" name="email" placeholder="Tu correo electrónico" autocomplete="email" required></div><div data-testid="form-row"><p><label><input type="checkbox" name="privacyAccepted" required> Acepto la <a href="/pages/policy-privac">política de privacidad</a>.</label></p></div><div data-testid="form-row"><button data-action-id="submit" type="submit">Lo quiero</button></div><div data-testid="form-row"><button data-action-id="dismiss" data-fem-scratch-dismiss type="button">Seguir explorando</button></div><p role="status" data-welcome-status></p></div></div></form></div>';
   document.body.append(dialog);enhanceScratchPromotion(dialog);
   const close=()=>dialog!.close();dialog.querySelector('.klaviyo-close-form')!.addEventListener('click',close);dialog.querySelector('[data-fem-scratch-dismiss]')!.addEventListener('click',close);
   const form=dialog.querySelector('form')!;
   form.addEventListener('submit',async event=>{
    event.preventDefault();if(!form.reportValidity())return;
    const button=form.querySelector<HTMLButtonElement>('button[type="submit"]')!,status=form.querySelector<HTMLElement>('[data-welcome-status]')!;
    button.disabled=true;status.textContent='Guardando…';
    try{const response=await fetch('/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:(new FormData(form)).get('email'),type:'welcome',privacyAccepted:true}),signal:AbortSignal.timeout(15000)});const result=await response.json();if(!response.ok)throw Error(result.error??'No pudimos guardar tu correo.');status.textContent='Tu código es '+result.code+'. Úsalo al finalizar tu compra.';}catch(error){status.textContent=error instanceof Error?error.message:'Inténtalo nuevamente.';}finally{button.disabled=false;}
   });
  }
  dialog.showModal();
 });
}
