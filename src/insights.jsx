import React, { useMemo, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from "recharts";
import { sportRu } from "./i18n.js";

const tip = {
  contentStyle: { background: "#1f2630", border: "1px solid #2a323d", borderRadius: 8, color: "#e6edf3", fontSize: 12 },
  labelStyle: { color: "#93a1b1" },
};
const axis = { stroke: "#93a1b1", fontSize: 11 };
const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const PIE_COLORS = ["#ff6b52", "#4aa8ff", "#38d39f", "#f2c14e", "#a78bfa", "#f472b6", "#93a1b1"];

// парс "1:16:45" или "42:15" в минуты
function durToMin(s) {
  if (!s) return 0;
  const p = s.split(":").map(Number);
  if (p.length === 3) return p[0] * 60 + p[1] + p[2] / 60;
  if (p.length === 2) return p[0] + p[1] / 60;
  return 0;
}
const isRun = (st) => st != null && Math.floor(st / 100) === 1;
const isBike = (st) => st != null && Math.floor(st / 100) === 2;
// велозаезд с правдоподобной средней (иначе GPS-глюки Coros раздувают километраж)
const bikeOk = (a) => isBike(a.sport_type) && (a.avg_speed == null || a.avg_speed <= 42);
const km = (a) => a.distance_km || 0;
const round1 = (n) => Math.round(n * 10) / 10;

function Panel({ title, cap, children }) {
  return (
    <>
      {title ? <div className="section-title">{title}</div> : null}
      <div className="panel">
        {cap ? <p className="chart-cap">{cap}</p> : null}
        {children}
      </div>
    </>
  );
}

function Vol({ label, value, tone }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value" style={tone ? { color: tone } : null}>{value}<span className="unit">км</span></div>
    </div>
  );
}

export default function Insights({ bundle }) {
  const year = bundle.latest.activities_year || [];
  const now = new Date(bundle.latest.generated_at);
  const curMonth = now.getMonth();
  const curYear = now.getFullYear();

  // ---- объемы: месяц и год ----
  const vol = useMemo(() => {
    let rM = 0, bM = 0, rY = 0, bY = 0;
    for (const a of year) {
      if (!a.date) continue;
      const m = +a.date.slice(5, 7) - 1;
      if (isRun(a.sport_type)) { rY += km(a); if (m === curMonth) rM += km(a); }
      if (bikeOk(a)) { bY += km(a); if (m === curMonth) bM += km(a); }
    }
    return { rM, bM, rY, bY };
  }, [year, curMonth]);

  // ---- помесячные объемы бег/вело ----
  const byMonth = useMemo(() => {
    const arr = Array.from({ length: curMonth + 1 }, (_, i) => ({ m: MONTHS[i], run: 0, bike: 0 }));
    for (const a of year) {
      const m = +a.date.slice(5, 7) - 1;
      if (m > curMonth) continue;
      if (isRun(a.sport_type)) arr[m].run += km(a);
      if (bikeOk(a)) arr[m].bike += km(a);
    }
    return arr.map((x) => ({ ...x, run: round1(x.run), bike: round1(x.bike) }));
  }, [year, curMonth]);

  // ---- объем по ISO-неделям ----
  const byWeek = useMemo(() => {
    const map = new Map();
    for (const a of year) {
      const dt = new Date(a.date + "T00:00:00");
      const d = new Date(dt);
      d.setDate(d.getDate() + 4 - (d.getDay() || 7));
      const wk = Math.ceil(((d - new Date(d.getFullYear(), 0, 1)) / 86400000 + 1) / 7);
      const key = `${a.date.slice(5, 7)}/${String(wk).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, { wk: `W${wk}`, run: 0, bike: 0, sort: wk });
      const o = map.get(key);
      if (isRun(a.sport_type)) o.run += km(a);
      if (bikeOk(a)) o.bike += km(a);
    }
    return [...map.values()].sort((x, y) => x.sort - y.sort)
      .map((x) => ({ ...x, run: round1(x.run), bike: round1(x.bike) }));
  }, [year]);

  // ---- время по видам спорта (часы) ----
  const bySport = useMemo(() => {
    const map = new Map();
    for (const a of year) {
      const h = durToMin(a.duration) / 60;
      map.set(a.sport, (map.get(a.sport) || 0) + h);
    }
    return [...map.entries()].map(([s, h]) => ({ name: sportRu(s), hours: round1(h) }))
      .sort((x, y) => y.hours - x.hours);
  }, [year]);

  // ---- рекорды ----
  const records = useMemo(() => {
    // фильтры правдоподобия: Coros в сводке иногда отдает битые поля
    const paceOk = (p) => { const m = durToMin(p); return m >= 3 && m <= 15; };
    const runs = year.filter((a) => isRun(a.sport_type) && km(a) > 0 && (!a.avg_pace || paceOk(a.avg_pace)));
    // велозаезды с физически правдоподобной средней (иначе GPS-глюки Coros
    // раздувают и дистанцию, и скорость)
    const bikes = year.filter((a) => isBike(a.sport_type) && km(a) > 0 && (a.avg_speed == null || a.avg_speed <= 42));
    const paced = runs.filter((a) => a.avg_pace && paceOk(a.avg_pace) && km(a) >= 3);
    const speedy = bikes.filter((a) => a.avg_speed != null && a.avg_speed >= 5 && a.avg_speed <= 42 && km(a) >= 10);
    const maxBy = (arr, f) => (arr.length ? arr.reduce((b, x) => (f(x) > f(b) ? x : b)) : null);
    const minPace = paced.length
      ? paced.reduce((b, x) => (durToMin(x.avg_pace) < durToMin(b.avg_pace) ? x : b)) : null;
    return {
      longestBike: maxBy(bikes, km),
      longestRun: maxBy(runs, km),
      fastestRun: minPace,
      topSpeed: maxBy(speedy, (a) => a.avg_speed),
      mostKcal: maxBy(year.filter((a) => a.calories != null), (a) => a.calories),
    };
  }, [year]);

  // ---- тренды формы по неделям ----
  const form = useMemo(() => {
    const snaps = bundle.history && bundle.history.length ? bundle.history : [bundle.latest];
    const seen = new Set();
    const out = [];
    for (const s of snaps) {
      const iso = s.week?.iso;
      if (!iso || seen.has(iso)) continue;
      seen.add(iso);
      const hrvs = (s.hrv || []).map((h) => h.avg).filter(Boolean);
      out.push({
        wk: iso.replace(/^\d+-/, ""),
        vo2max: s.fitness?.vo2max ?? null,
        resting: s.daily?.resting_hr ?? null,
        hrv: hrvs.length ? round1(hrvs.reduce((a, b) => a + b, 0) / hrvs.length) : null,
      });
    }
    return out;
  }, [bundle]);

  // ---- календарь ----
  const actByDate = useMemo(() => {
    const m = new Map();
    for (const a of year) {
      if (!a.date) continue;
      if (!m.has(a.date)) m.set(a.date, []);
      m.get(a.date).push(a);
    }
    return m;
  }, [year]);

  const healthByDate = useMemo(() => {
    const m = new Map();
    const snaps = [bundle.latest, ...(bundle.history || [])];
    for (const s of snaps) {
      for (const day of (s.daily?.days || [])) {
        if (day.date && !m.has(day.date)) m.set(day.date, day);
      }
    }
    return m;
  }, [bundle]);

  const [calM, setCalM] = useState(curMonth);
  const [calY, setCalY] = useState(curYear);
  const [sel, setSel] = useState(bundle.latest.week?.end || null);

  const cells = useMemo(() => {
    const first = new Date(calY, calM, 1);
    const startPad = (first.getDay() || 7) - 1; // Пн=0
    const days = new Date(calY, calM + 1, 0).getDate();
    const arr = [];
    for (let i = 0; i < startPad; i++) arr.push(null);
    for (let d = 1; d <= days; d++) {
      const iso = `${calY}-${String(calM + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      arr.push({ d, iso, acts: actByDate.get(iso) || [] });
    }
    return arr;
  }, [calM, calY, actByDate]);

  const selActs = sel ? (actByDate.get(sel) || []) : [];
  const selHealth = sel ? healthByDate.get(sel) : null;
  const stepMonth = (delta) => {
    let m = calM + delta, y = calY;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    setCalM(m); setCalY(y);
  };

  return (
    <>
      <div className="section-title">Объемы</div>
      <div className="kpis">
        <Vol label="Бег, этот месяц" value={round1(vol.rM)} tone="var(--accent)" />
        <Vol label="Вело, этот месяц" value={round1(vol.bM)} tone="var(--blue)" />
        <Vol label="Бег, год" value={round1(vol.rY)} tone="var(--accent)" />
        <Vol label="Вело, год" value={round1(vol.bY)} tone="var(--blue)" />
      </div>
      <Panel cap="Километраж по месяцам">
        <div className="chart-h">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byMonth} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="#2a323d" strokeDasharray="3 3" />
              <XAxis dataKey="m" {...axis} />
              <YAxis {...axis} />
              <Tooltip {...tip} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#93a1b1" }} />
              <Bar dataKey="bike" fill="#4aa8ff" name="вело" />
              <Bar dataKey="run" fill="#ff6b52" name="бег" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="section-title">Календарь</div>
      <div className="panel">
        <div className="cal-head">
          <button className="cal-nav" onClick={() => stepMonth(-1)}>‹</button>
          <span className="cal-title">{MONTHS[calM]} {calY}</span>
          <button className="cal-nav" onClick={() => stepMonth(1)}>›</button>
        </div>
        <div className="cal-grid">
          {WD.map((w) => <div key={w} className="cal-wd">{w}</div>)}
          {cells.map((c, i) => c ? (
            <button
              key={c.iso}
              className={"cal-day" + (c.acts.length ? " has" : "") + (c.iso === sel ? " sel" : "")}
              onClick={() => setSel(c.iso)}
              disabled={!c.acts.length}
            >
              <span>{c.d}</span>
              {c.acts.length ? <i className="cal-dot" /> : null}
            </button>
          ) : <div key={"p" + i} />)}
        </div>
        <div className="cal-detail">
          {!sel ? <span className="muted">Выберите день</span> : (
            <>
              <div className="cal-detail-date">{sel}</div>
              {selActs.length ? selActs.map((a, i) => (
                <div key={i} className="cal-act">
                  <b>{sportRu(a.sport)}</b>
                  <span>{[a.distance_km != null ? `${a.distance_km} км` : null, a.duration,
                    a.avg_hr != null ? `${a.avg_hr} уд/мин` : null,
                    a.calories != null ? `${a.calories} ккал` : null].filter(Boolean).join("  ·  ")}</span>
                </div>
              )) : <div className="muted">Тренировок нет</div>}
              {selHealth ? (
                <div className="cal-health">
                  {selHealth.steps != null ? `Шаги ${selHealth.steps.toLocaleString("ru-RU")}` : ""}
                  {selHealth.sleep ? `  ·  Сон ${selHealth.sleep.total}` : ""}
                </div>
              ) : <div className="cal-health muted">Данных о здоровье за этот день нет</div>}
            </>
          )}
        </div>
      </div>

      <div className="grid-2">
        <Panel title="Объем по неделям" cap="Километраж бег и вело">
          <div className="chart-h">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={byWeek} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="#2a323d" strokeDasharray="3 3" />
                <XAxis dataKey="wk" {...axis} interval="preserveStartEnd" />
                <YAxis {...axis} />
                <Tooltip {...tip} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#93a1b1" }} />
                <Line type="monotone" dataKey="bike" stroke="#4aa8ff" strokeWidth={2} dot={false} name="вело" />
                <Line type="monotone" dataKey="run" stroke="#ff6b52" strokeWidth={2} dot={false} name="бег" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Время по видам спорта" cap="Часы за год">
          <div className="chart-h">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={bySport} dataKey="hours" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e) => `${e.name.split(" (")[0]} ${e.hours}ч`} labelLine={false}>
                  {bySport.map((e, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip {...tip} formatter={(v) => `${v} ч`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="section-title">Рекорды года</div>
      <div className="panel">
        <div className="pred">
          {records.longestBike && <div><div className="p-lab">Самый длинный заезд</div><div className="p-val">{records.longestBike.distance_km} км</div></div>}
          {records.longestRun && <div><div className="p-lab">Самый длинный бег</div><div className="p-val">{records.longestRun.distance_km} км</div></div>}
          {records.fastestRun && <div><div className="p-lab">Быстрый бег (темп)</div><div className="p-val">{records.fastestRun.avg_pace} /км</div></div>}
          {records.topSpeed && <div><div className="p-lab">Макс. средняя скорость</div><div className="p-val">{records.topSpeed.avg_speed} км/ч</div></div>}
          {records.mostKcal && <div><div className="p-lab">Больше всего калорий</div><div className="p-val">{records.mostKcal.calories} ккал</div></div>}
        </div>
      </div>

      <Panel title="Тренды формы по неделям" cap="Накапливаются с каждым замером">
        <div className="chart-h">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={form} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="#2a323d" strokeDasharray="3 3" />
              <XAxis dataKey="wk" {...axis} />
              <YAxis {...axis} />
              <Tooltip {...tip} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#93a1b1" }} />
              <Line type="monotone" dataKey="vo2max" stroke="#38d39f" strokeWidth={2} name="VO2max" connectNulls />
              <Line type="monotone" dataKey="resting" stroke="#f2c14e" strokeWidth={2} name="пульс покоя" connectNulls />
              <Line type="monotone" dataKey="hrv" stroke="#ff6b52" strokeWidth={2} name="HRV" connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </>
  );
}
