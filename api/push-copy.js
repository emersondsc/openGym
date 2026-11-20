// Bilingual (PT-BR default / EN) web-push notification copy, mirroring frontend `effLang`.

export const effPushLang = s => (s?.langChosen && s.lang === 'en') ? 'en' : 'pt';

export function restOverPayload(s) {
  if (effPushLang(s) === 'en') {
    return { title: 'Rest over 💪', body: 'Time for your next set.', tag: 'rest-timer' };
  }
  return { title: 'Descanso acabou 💪', body: 'Hora da próxima série.', tag: 'rest-timer' };
}

export function dayReminderPayload(s, routine) {
  if (effPushLang(s) === 'en') {
    return {
      title: routine ? `${routine.emoji || '🏋️'} ${routine.name} today` : 'Workout planned today',
      body: "It's on your plan — let's go 💪",
      tag: 'day-reminder'
    };
  }
  return {
    title: routine ? `${routine.emoji || '🏋️'} ${routine.name} hoje` : 'Treino planejado hoje',
    body: 'Está no seu plano — bora 💪',
    tag: 'day-reminder'
  };
}
