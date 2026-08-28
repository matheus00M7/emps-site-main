import assert from 'node:assert/strict';
import test from 'node:test';

import { distanceInKm, formatDuration, formatTimer } from '../src/utils/formatters';

test('formata cronômetro de sessão', () => {
  assert.equal(formatTimer(754), '12:34');
  assert.equal(formatTimer(3723), '1:02:03');
});

test('formata duração de recibo em linguagem humana', () => {
  assert.equal(formatDuration(754), '12min 34s');
  assert.equal(formatDuration(3723), '1h 02min');
});

test('calcula distância geográfica sem depender de provedor externo', () => {
  const distance = distanceInKm(
    { latitude: -23.56158, longitude: -46.65593 },
    { latitude: -23.59555, longitude: -46.68517 },
  );
  assert.ok(distance > 4 && distance < 6);
});
