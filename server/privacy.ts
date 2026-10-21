import {load} from 'cheerio';
/** Optional trackers are removed before HTML reaches the browser; the preference is read on every response. */
export function privacyMarkup(html:string,cookie=''):string {
 const allowed=/(?:^|;\s*)fem_consent=all(?:;|$)/.test(cookie);
 const $=load(html);
 if(!allowed){
  const tracker=/facebook\.com\/tr|connect\.facebook|fbevents|fbq\s*\(|tiktok|ttq\.|klaviyo|googletagmanager|google-analytics|gtag\s*\(|web-pixels-manager|web-pixels|ShopifyAnalytics|trekkie/i;
  $('script,iframe,img,link,noscript').each((_,node)=>{const e=$(node);if(tracker.test((e.attr('src')||'')+' '+(e.attr('href')||'')+' '+(node.tagName==='script'||node.tagName==='noscript'?e.html()||'':'')))e.remove();});
 }
 $('footer, .fem-footer__section').first().append('<nav aria-label="Información legal" style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center;padding:20px;color:#56323d;background:#fff8f9"><a href="/policies/refund-policy">Reembolsos</a><a href="/policies/terms-of-service">Términos del servicio</a><a href="/pages/politica-de-cookies">Política de cookies</a></nav>');
 $('body').append('<script defer src="/__theme/fem-consent.js"></script>');return $.html();
}
export {cookiePolicy} from './cookie-policy.ts';
