import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveOwnedItems} from '../apps/checkout/lib/owned-cart.ts';
import {handleCommerceProxy} from '../server/owned-commerce.ts';
import type {IncomingMessage, ServerResponse} from 'node:http';

const products = [{id: 1, title: 'FEM', images: [{src: '/__theme/product.webp'}], variants: [
  {id: 10, title: 'Compra Única', price: '110000.00', available: true},
  {id: 11, title: 'Suscripción', price: '99000.00', available: true},
]}];
const item = {id: 'forged', name: 'Injected title', image: 'https://invalid.test/image', shopifyVariantId: 10, quantity: 1, price: 110000};
const stock = [{variant_id: 10, price_cents: 11000000, available: true, stock: 2}];

test('Checkout uses canonical catalog fields and rejects tampered prices and unavailable stock', () => {
  const [result] = resolveOwnedItems([item], products, stock);
  assert.equal(result.id, '1');
  assert.equal(result.name, 'FEM');
  assert.equal(result.variant, 'Compra Única');
  assert.equal(result.image, '/__theme/product.webp');
  for (const changed of [{price: 1}, {price: NaN}, {quantity: -1}, {quantity: 1.5}, {shopifyVariantId: 999}]) {
    assert.throws(() => resolveOwnedItems([{...item, ...changed}], products, stock));
  }
  assert.throws(() => resolveOwnedItems([item], products, []));
  assert.throws(() => resolveOwnedItems([item], products, [{...stock[0], available: false}]));
});

test('Duplicate checkout lines share the same inventory limit and subscriptions cannot become single payments', () => {
  assert.equal(resolveOwnedItems([item, item], products, stock).length, 2);
  assert.throws(() => resolveOwnedItems([item, {...item, quantity: 2}], products, stock));
  assert.throws(() => resolveOwnedItems([{...item, shopifyVariantId: 11, price: 99000}], products,
    [{variant_id: 11, price_cents: 9900000, available: true, stock: 1}]), /suscripción/);
});

test('The internal checkout proxy preserves payment webhook signatures', async t => {
  const previousFetch = globalThis.fetch;
  const previousOrigin = process.env.CHECKOUT_INTERNAL_URL;
  const previousSecret = process.env.FEM_INTERNAL_SECRET;
  process.env.CHECKOUT_INTERNAL_URL = 'https://checkout.internal.invalid';
  process.env.FEM_INTERNAL_SECRET = 'test-only-internal-secret';
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousOrigin === undefined) delete process.env.CHECKOUT_INTERNAL_URL; else process.env.CHECKOUT_INTERNAL_URL = previousOrigin;
    if (previousSecret === undefined) delete process.env.FEM_INTERNAL_SECRET; else process.env.FEM_INTERNAL_SECRET = previousSecret;
  });
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://checkout.internal.invalid/api/webhooks/mercadopago?data.id=123');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('x-signature'), 'ts=1,v1=test-signature');
    assert.equal(headers.get('x-request-id'), 'payment-request-123');
    assert.equal(headers.get('x-fem-internal'), 'test-only-internal-secret');
    assert.equal(Buffer.from(init?.body as Uint8Array).toString(), '{"id":123}');
    return Response.json({received: true});
  }) as typeof fetch;
  const req = {method: 'POST', headers: {'content-type': 'application/json', 'x-signature': 'ts=1,v1=test-signature', 'x-request-id': 'payment-request-123'}} as unknown as IncomingMessage;
  let responseBody = '';
  const res = {statusCode: 0, setHeader() {}, end(value: Buffer) {responseBody = value.toString();}} as unknown as ServerResponse;
  assert.equal(await handleCommerceProxy(req, res, new URL('https://fem.test/api/webhooks/mercadopago?data.id=123'), async () => Buffer.from('{"id":123}')), true);
  assert.equal(calls, 1);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(responseBody), {received: true});
});
