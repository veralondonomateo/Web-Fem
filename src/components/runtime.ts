import {enhanceCommunityVideos} from './community-video.ts';
import {enhanceAnniversaryVideo} from './anniversary-video.ts';
import {loadPresentComponents,bindLazySearchShortcut} from './loader.ts';
import {enhanceAccessibility} from './accessibility.ts';
import {enhanceNativeInteractions} from './native-interactions.ts';
import {enhanceCartDrawer} from './cart-drawer.ts';
import {enhancePurchaseSelection} from './purchase-selection.ts';
import {enhanceCatalogInteractions} from './catalog-interactions.ts';
import {enhanceCatalogFilters} from './catalog-filters.ts';
import {enhanceScratchPromotion,initializeScratchPromotion} from './scratch-promotion.ts';
import {initializeOwnedWelcome} from './owned-welcome.ts';
function boot(): void {
  enhanceCartDrawer();
  if(document.body.hasAttribute('data-fem-open-cart-on-load'))document.querySelector<HTMLElement>('[data-fem-cart-open]')?.click();
  enhancePurchaseSelection();
  loadPresentComponents();
  bindLazySearchShortcut();
  enhanceAccessibility();
  enhanceCommunityVideos();
  enhanceAnniversaryVideo();
  enhanceNativeInteractions();
  enhanceCatalogInteractions();
  enhanceCatalogFilters();
  initializeOwnedWelcome();
  initializeScratchPromotion();
  document.documentElement.classList.remove('no-js');
  new MutationObserver(records => {
    const roots=new Set<Element>();
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof HTMLElement) {
        if(record.target.hasAttribute('open'))roots.add(record.target);
      }
      for (const added of record.addedNodes) if (added instanceof Element && added.isConnected)roots.add(added);
    }
    for(const root of roots){
      let parent=root.parentElement,covered=false;
      while(parent){if(roots.has(parent)){covered=true;break;}parent=parent.parentElement;}
      if(!covered){
        loadPresentComponents(root);
        enhanceAccessibility(root);
        enhanceCommunityVideos(root);
        enhanceAnniversaryVideo(root);
        enhanceNativeInteractions(root);
        enhancePurchaseSelection(root);
        enhanceCatalogInteractions(root);
        enhanceCatalogFilters(root);
        enhanceScratchPromotion(root);
      }
    }
  }).observe(document.body, {childList:true,subtree:true,attributes:true,attributeFilter:['open']});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
