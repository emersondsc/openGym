import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { effPushLang, restOverPayload, dayReminderPayload } from './push-copy.js';

describe('push-copy bilingual PT-BR default & langChosen migration', () => {
  it('defaults null, empty, and legacy unchosen en states to PT-BR', () => {
    assert.equal(effPushLang(null), 'pt');
    assert.equal(effPushLang({}), 'pt');
    assert.equal(effPushLang({ lang: 'en' }), 'pt');
    assert.equal(effPushLang({ lang: 'en', langChosen: false }), 'pt');
    assert.equal(effPushLang({ lang: 'pt', langChosen: true }), 'pt');
  });

  it('keeps EN only when explicitly chosen', () => {
    assert.equal(effPushLang({ lang: 'en', langChosen: true }), 'en');
  });

  it('builds restOverPayload in PT-BR vs EN', () => {
    assert.deepEqual(restOverPayload({ lang: 'en' }), {
      title: 'Descanso acabou 💪', body: 'Hora da próxima série.', tag: 'rest-timer'
    });
    assert.deepEqual(restOverPayload({ lang: 'en', langChosen: true }), {
      title: 'Rest over 💪', body: 'Time for your next set.', tag: 'rest-timer'
    });
  });

  it('builds dayReminderPayload with and without routine in PT-BR and EN', () => {
    const routine = { emoji: '🏋️', name: 'Push' };
    assert.deepEqual(dayReminderPayload({ lang: 'en' }, routine), {
      title: '🏋️ Push hoje', body: 'Está no seu plano — bora 💪', tag: 'day-reminder'
    });
    assert.deepEqual(dayReminderPayload(null, null), {
      title: 'Treino planejado hoje', body: 'Está no seu plano — bora 💪', tag: 'day-reminder'
    });
    assert.deepEqual(dayReminderPayload({ lang: 'en', langChosen: true }, routine), {
      title: '🏋️ Push today', body: "It's on your plan — let's go 💪", tag: 'day-reminder'
    });
    assert.deepEqual(dayReminderPayload({ lang: 'en', langChosen: true }, null), {
      title: 'Workout planned today', body: "It's on your plan — let's go 💪", tag: 'day-reminder'
    });
  });
});
