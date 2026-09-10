// Детерминированная локализация английских строк Coros на русский.
// Работает в браузере на готовом снимке, поэтому не требует ИИ и переживает
// headless-обновление. Неизвестные значения отдаются как есть, чтобы ничего
// не терялось.

const SPORTS = {
  "Gravel Bike": "Гравел (Gravel Bike)",
  "Outdoor Run": "Бег на улице (Outdoor Run)",
  "Indoor Run": "Бег в зале (Indoor Run)",
  "Trail Run": "Трейл (Trail Run)",
  "Bike": "Велосипед (Bike)",
  "Cycling": "Велосипед (Cycling)",
  "Indoor Bike": "Велостанок (Indoor Bike)",
  "Mountain Bike": "МТБ (Mountain Bike)",
  "Strength": "Силовая (Strength)",
  "Yoga": "Йога (Yoga)",
  "Hike": "Поход (Hike)",
  "Walk": "Ходьба (Walk)",
  "Pool Swim": "Бассейн (Pool Swim)",
  "Open Water": "Открытая вода (Open Water)",
  "Track Run": "Стадион (Track Run)",
};

const HRV_STATUS = {
  "Above normal": "Выше нормы",
  "Normal": "Норма",
  "Below normal": "Ниже нормы",
  "Balanced": "Сбалансировано",
  "Unbalanced": "Разбалансировано",
};

const LOAD_COMMENT = {
  "Maintaining": "Поддержание",
  "Optimized": "Оптимально",
  "Productive": "Продуктивно",
  "Detraining": "Растренированность",
  "Overreaching": "Переизбыток",
  "Recovery": "Восстановление",
  "Strained": "Перегрузка",
};

const RECOVERY_LEVEL = {
  "Moderate training recommended": "Рекомендована умеренная нагрузка",
  "High intensity training recommended": "Рекомендована высокая интенсивность",
  "Low intensity training recommended": "Рекомендована низкая интенсивность",
  "Rest recommended": "Рекомендован отдых",
  "Fully recovered": "Полностью восстановлен",
};

const RECOMMENDATION = {
  "Use the same route or workout type again if you want a cleaner baseline for comparing future sessions.":
    "Повторите тот же маршрут или тип тренировки, чтобы получить чистую базу для сравнения будущих сессий.",
  "If you want to improve this run, review pace consistency and heart-rate control together instead of looking at only one metric.":
    "Чтобы улучшить этот бег, смотрите на стабильность темпа и контроль пульса вместе, а не по одной метрике.",
  "If you want to improve this ride, review pace consistency and heart-rate control together instead of looking at only one metric.":
    "Чтобы улучшить этот заезд, смотрите на стабильность и контроль пульса вместе, а не по одной метрике.",
};

const map = (dict, v) => (v == null ? v : dict[v.trim()] || v);
export const sportRu = (v) => map(SPORTS, v);
export const hrvStatusRu = (v) => map(HRV_STATUS, v);
export const loadCommentRu = (v) => map(LOAD_COMMENT, v);
export const recoveryLevelRu = (v) => map(RECOVERY_LEVEL, v);

// Разбирает английский тренерский текст Coros в русские блоки.
// Возвращает {conclusion, findings:[...], recommendation}.
export function coachRu(text, ctx = {}) {
  if (!text) return null;
  const g = (re) => {
    const m = re.exec(text);
    return m ? m[1] : null;
  };
  const dist = g(/covered\s+([\d.]+)\s+km/);
  const dur = g(/in\s+([\d:]+)\b/);
  const lasted = g(/lasted\s+([\d:]+)/);
  const speed = g(/Average speed was\s+([\d.]+)\s+km\/h/);
  const pace = g(/Average pace was\s+([\d:]+)\s*\/km/);
  const hrAvg = g(/averaged\s+(\d+)\s+bpm/);
  const hrPeak = g(/peaking at\s+(\d+)\s+bpm/);
  const elev = g(/Elevation gain was\s+(\d+)\s+m/);
  const cad = g(/Average cadence was\s+(\d+)\s+spm/);
  const kcal = g(/energy cost was\s+(\d+)\s+kcal/);

  const findings = [];
  const hasDist = dist && parseFloat(dist) > 0;
  const dispDur = dur || lasted;
  if (hasDist && dispDur) findings.push(`Дистанция ${dist} км за ${dispDur}.`);
  else if (dispDur) findings.push(`Длительность ${dispDur}.`);
  if (speed) findings.push(`Средняя скорость ${speed} км/ч.`);
  if (pace) findings.push(`Средний темп ${pace} /км.`);
  if (hrAvg) findings.push(`Пульс: средний ${hrAvg} уд/мин${hrPeak ? `, пик ${hrPeak} уд/мин` : ""}.`);
  if (elev) findings.push(`Набор высоты ${elev} м.`);
  if (cad) findings.push(`Средний каденс ${cad}.`);
  if (kcal) findings.push(`Затрачено ${kcal} ккал.`);

  const sport = ctx.sport ? sportRu(ctx.sport) : "Тренировка";
  let conclusion;
  if (hasDist && dispDur) conclusion = `${sport}: ${dist} км за ${dispDur}.`;
  else if (dispDur) conclusion = `${sport}: длительность ${dispDur}.`;
  else conclusion = sport;

  const recEn = g(/Recommendation:\s*([^\n]+)/);
  let recommendation = null;
  if (recEn) {
    recommendation = RECOMMENDATION[recEn.trim()] ||
      "Повторяйте похожие сессии, чтобы отслеживать динамику по неделям.";
  }
  return { conclusion, findings, recommendation };
}
