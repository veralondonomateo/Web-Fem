import test from 'node:test';import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,limited} from '../integrations/auth.mjs';
test('Salted scrypt hashes verify without plaintext and reject malformed input',()=>{const a=hashPassword('local-test-password'),b=hashPassword('local-test-password');assert.notEqual(a,b);assert.equal(verifyPassword('local-test-password',a),true);for(const value of ['wrong',null,{},'x'.repeat(1025)])assert.equal(verifyPassword(value,a),false);assert.equal(verifyPassword('secret','scrypt$bad$bad'),false);});
test('Eleventh login attempt is rate limited',()=>{const key=crypto.randomUUID();for(let i=0;i<10;i++)assert.equal(limited(key),false);assert.equal(limited(key),true);});
