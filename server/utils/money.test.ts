import assert from 'node:assert/strict';
import test from 'node:test';
import { fromMicrodollars, readMicrodollars, toMicrodollars } from './money.js';

test('dollar conversion rounds once at the microdollar boundary', () => {
  for (const [usd, micros] of [[1, 1000000], [9.990001, 9990001], [0.000001, 1],
    [0.0000015, 2], [-0.0000015, -2], [-0.0000001, 0]]) {
    assert.equal(toMicrodollars(usd), micros);
  }
  assert.equal(fromMicrodollars('9990001'), 9.990001);
  assert.equal(fromMicrodollars(-1), -0.000001);
});

test('invalid or unsafe money values fail instead of losing precision', () => {
  for (const value of [null, undefined, '', '1.5', '9007199254740992', 1.5, NaN, Infinity]) {
    assert.throws(() => readMicrodollars(value));
  }
  for (const value of [NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => toMicrodollars(value));
  }
});
