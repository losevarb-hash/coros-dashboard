import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import { decryptBundle } from "./crypto.js";
import { sportRu, hrvStatusRu, loadCommentRu, recoveryLevelRu, coachRu } from "./i18n.js";
import Insights from "./insights.jsx";

// ---------- helpers ----------
const NA = String.fromCharCode(0x2014);
const md = (iso) => (iso ? iso.slice(5) : "");
const sortByDate = (arr) => [...arr].sort((a, b) => (a.date < b.date ? -1 : 1));

// "6h 44min" / "1h 0min" / "11 min" -> минуты
function durMin(s) {
  if (!s) return 0;
  const h = /(\d+)\s*h/.exec(s);
  const m = /(\d+)\s*min/.exec(s);
  return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0);
}
const fmtH = (min) => `${Math.floor(min / 60)}ч ${min % 60}м`;

const tip = {
  contentStyle: { background: "#1f2630", border: "1px solid #2a323d", borderRadius: 8, color: "#e6edf3", fontSize: 12 },
  labelStyle: { color: "#93a1b1" },
};
const axis = { stroke: "#93a1b1", fontSize: 11 };

// ---------- PIN gate ----------
function Gate({ onOk }) {
  const [enc, setEnc] = useState(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}coros.enc.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setEnc)
      .catch(() => setLoadErr("Не удалось загрузить данные дашборда."));
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!enc || pin.length < 4) return;
    setBusy(true);
    setErr("");
    try {
      const bundle = await decryptBundle(enc, pin);
      onOk(bundle);
    } catch {
      setErr("Неверный PIN.");
      setPin("");
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <h1>Coros Dashboard</h1>
        <p>Введите PIN, чтобы открыть данные</p>
        <input
          className="pin-input"
          type="password"
          inputMode="numeric"
          autoFocus
          maxLength={8}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder="0000"
        />
        <button className="gate-btn" disabled={busy || !enc || pin.length < 4}>
          {busy ? "Расшифровка..." : "Открыть"}
        </button>
        <div className="gate-err">{loadErr || err}</div>
      </form>
    </div>
  );
}

// ---------- small pieces ----------
function Kpi({ label, value, unit, foot, tone }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value" style={tone ? { color: tone } : null}>
        {value}
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
      {foot ? <div className="foot">{foot}</div> : null}
    </div>
  );
}

function CoachBlock({ text, sport }) {
  const c = coachRu(text, { sport });
  if (!c) return null;
  return (
    <div className="act-coach">
      <div className="coach-line"><b>Вывод:</b> {c.conclusion}</div>
      {c.findings.length ? (
        <ul className="coach-list">
          {c.findings.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      ) : null}
      {c.recommendation ? (
        <div className="coach-line"><b>Рекомендация:</b> {c.recommendation}</div>
      ) : null}
    </div>
  );
}

function Panel({ cap, children }) {
  return (
    <div className="panel">
      {cap ? <p className="chart-cap">{cap}</p> : null}
      {children}
    </div>
  );
}

// ---------- dashboard ----------
function Dashboard({ bundle }) {
  const d = bundle.latest;
  const f = d.fitness || {};
  const rec = d.recovery || {};
  const daily = (d.daily && d.daily.days) || [];

  const hrv = useMemo(() => sortByDate(d.hrv || []).map((h) => ({
    date: md(h.date), avg: h.avg, baseline: h.baseline,
    low: h.normal_low, high: h.normal_high, status: h.status,
  })), [d]);

  const load = useMemo(() => sortByDate(d.training_load || []).map((l) => ({
    date: md(l.date), short: l.short, long: l.long, ratio: l.ratio, comment: l.comment,
  })), [d]);

  const sleep = useMemo(() => sortByDate(daily)
    .filter((x) => x.sleep)
    .map((x) => ({
      date: md(x.date),
      deep: durMin(x.sleep.deep), light: durMin(x.sleep.light), rem: durMin(x.sleep.rem),
      total: durMin(x.sleep.total), hr: x.sleep.hr_avg,
    })), [daily]);

  const latestHrv = hrv.length ? hrv[hrv.length - 1] : null;
  const avgSleep = sleep.length ? Math.round(sleep.reduce((s, x) => s + x.total, 0) / sleep.length) : 0;
  const weekLoad = load.length ? load[load.length - 1] : null;

  const recTone = rec.percent >= 75 ? "var(--green)" : rec.percent >= 50 ? "var(--amber)" : "var(--accent)";
  const acts = d.activities || [];

  return (
    <>
      <div className="head">
        <div className="head-inner">
          <h1>Coros <span className="dot">•</span> Неделя {d.week?.iso}</h1>
          <span className="sub">
            {d.week?.start} .. {d.week?.end}
            {"  ·  "}
            {(d.devices || []).map((x) => x.name).join(", ")}
          </span>
        </div>
      </div>

      <div className="wrap">
        <div className="kpis">
          <Kpi label="VO2max" value={f.vo2max ?? NA} foot={f.threshold_pace ? `порог ${f.threshold_pace}/км` : null} />
          <Kpi label="Восстановление (Recovery)" value={rec.percent != null ? `${rec.percent}` : NA} unit="%" tone={recTone}
               foot={recoveryLevelRu(rec.level)} />
          <Kpi label="Пульс покоя (Resting HR)" value={d.daily?.resting_hr ?? NA} unit="уд/мин" />
          <Kpi label="HRV сна (Sleep HRV)" value={latestHrv ? latestHrv.avg : NA} unit="мс"
               foot={latestHrv ? hrvStatusRu(latestHrv.status) : null}
               tone={latestHrv && latestHrv.avg >= latestHrv.high ? "var(--green)" : null} />
          <Kpi label="Средний сон (Sleep)" value={avgSleep ? fmtH(avgSleep) : NA} foot={`${sleep.length} ночей`} />
          <Kpi label="Тренировок" value={acts.length}
               foot={weekLoad ? `нагрузка: ${loadCommentRu(weekLoad.comment)}` : null} />
        </div>

        <div className="section-title">Готовность и нагрузка</div>
        <div className="grid-2">
          <Panel cap="HRV сна (мс): среднее и базовая линия">
            <div className="chart-h">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={hrv} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="#2a323d" strokeDasharray="3 3" />
                  <XAxis dataKey="date" {...axis} />
                  <YAxis domain={["dataMin - 5", "dataMax + 5"]} {...axis} />
                  <Tooltip {...tip} />
                  <Line type="monotone" dataKey="baseline" stroke="#93a1b1" strokeDasharray="4 4" dot={false} name="базовая" />
                  <Line type="monotone" dataKey="avg" stroke="#ff6b52" strokeWidth={2} dot={{ r: 3 }} name="HRV" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel cap="Тренировочная нагрузка: короткая и длинная">
            <div className="chart-h">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={load} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="#2a323d" strokeDasharray="3 3" />
                  <XAxis dataKey="date" {...axis} />
                  <YAxis {...axis} />
                  <Tooltip {...tip} />
                  <Legend wrapperStyle={{ fontSize: 11, color: "#93a1b1" }} />
                  <Line type="monotone" dataKey="short" stroke="#4aa8ff" strokeWidth={2} dot={false} name="короткая" />
                  <Line type="monotone" dataKey="long" stroke="#38d39f" strokeWidth={2} dot={false} name="длинная" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>

        <div className="section-title">Сон</div>
        <div className="grid-2">
          <Panel cap="Фазы сна по ночам (минуты)">
            <div className="chart-h">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sleep} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="#2a323d" strokeDasharray="3 3" />
                  <XAxis dataKey="date" {...axis} />
                  <YAxis {...axis} />
                  <Tooltip {...tip} formatter={(v) => fmtH(v)} />
                  <Legend wrapperStyle={{ fontSize: 11, color: "#93a1b1" }} />
                  <Bar dataKey="deep" stackId="s" fill="#4aa8ff" name="глубокий" />
                  <Bar dataKey="light" stackId="s" fill="#3b4a5e" name="легкий" />
                  <Bar dataKey="rem" stackId="s" fill="#ff6b52" name="REM" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel cap="Пульс во сне (уд/мин) и пульс покоя">
            <div className="chart-h">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sleep} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="#2a323d" strokeDasharray="3 3" />
                  <XAxis dataKey="date" {...axis} />
                  <YAxis domain={["dataMin - 3", "dataMax + 3"]} {...axis} />
                  <Tooltip {...tip} />
                  {d.daily?.resting_hr ? (
                    <ReferenceLine y={d.daily.resting_hr} stroke="#93a1b1" strokeDasharray="4 4"
                                   label={{ value: "покой", fill: "#93a1b1", fontSize: 10, position: "insideTopRight" }} />
                  ) : null}
                  <Line type="monotone" dataKey="hr" stroke="#38d39f" strokeWidth={2} dot={{ r: 3 }} name="пульс сна" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>

        <Insights bundle={bundle} />

        {(f.pred_5k || f.pred_10k) && (
          <>
            <div className="section-title">Прогнозы гонок</div>
            <Panel>
              <div className="pred">
                {[["5 км", f.pred_5k], ["10 км", f.pred_10k], ["Полумарафон", f.pred_half], ["Марафон", f.pred_marathon]]
                  .filter(([, v]) => v)
                  .map(([lab, v]) => (
                    <div key={lab}><div className="p-lab">{lab}</div><div className="p-val">{v}</div></div>
                  ))}
              </div>
            </Panel>
          </>
        )}

        <div className="section-title">Тренировки за неделю ({acts.length})</div>
        <div className="acts">
          {acts.map((a, i) => (
            <div className="act" key={i}>
              <div className="act-top">
                <div>
                  <div className="act-sport">{sportRu(a.sport)}</div>
                  {a.location ? <div className="act-loc">{a.location}</div> : null}
                </div>
                <div className="act-date">{a.date}</div>
              </div>
              <div className="act-stats">
                {a.distance_km != null && <div className="act-stat"><b>{a.distance_km}</b><span>км</span></div>}
                {a.duration && <div className="act-stat"><b>{a.duration}</b><span>время</span></div>}
                {a.avg_speed != null && <div className="act-stat"><b>{a.avg_speed}</b><span>км/ч</span></div>}
                {a.avg_pace && <div className="act-stat"><b>{a.avg_pace}</b><span>темп/км</span></div>}
                {a.avg_hr != null && <div className="act-stat"><b>{a.avg_hr}</b><span>пульс</span></div>}
                {a.calories != null && <div className="act-stat"><b>{a.calories}</b><span>ккал</span></div>}
              </div>
              <CoachBlock text={a.coach} sport={a.sport} />
            </div>
          ))}
        </div>

        <div className="foot-note">
          Снимок обновлен: {new Date(d.generated_at).toLocaleString("ru-RU")}. Данные Coros, обновляются раз в неделю.
        </div>
      </div>
    </>
  );
}

export default function App() {
  const [bundle, setBundle] = useState(null);
  return bundle ? <Dashboard bundle={bundle} /> : <Gate onOk={setBundle} />;
}
