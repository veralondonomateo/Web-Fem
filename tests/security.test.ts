import test from 'node:test';
import assert from 'node:assert/strict';
import {privacyMarkup} from '../server/privacy.ts';
test('Optional pixels cannot run before consent, including noscript beacons',()=>{
 const html=privacyMarkup('<html><body><script src="https://connect.facebook.net/en_US/fbevents.js"></script><script>fbq("track","PageView")</script><noscript><img src="https://www.facebook.com/tr?id=1"></noscript><script src="/cart.js"></script></body></html>');
 assert.ok(!html.includes('fbevents.js'));assert.ok(!html.includes('PageView'));assert.ok(!html.includes('facebook.com/tr'));assert.ok(html.includes('/cart.js'));assert.ok(html.includes('fem-consent.js'));
});
test('Explicit optional consent permits tracker, malformed or similar cookie does not',()=>{
 const source='<html><body><script src="https://connect.facebook.net/fbevents.js"></script></body></html>';
 assert.ok(privacyMarkup(source,'fem_consent=all').includes('fbevents.js'));
 for(const cookie of ['fem_consent=essential','other_fem_consent=all','fem_consent=allx'])assert.ok(!privacyMarkup(source,cookie).includes('fbevents.js'));
});
