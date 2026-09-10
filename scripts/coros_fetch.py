#!/usr/bin/env python3
"""
Сборщик недельного снимка данных Coros через CLI `coros-mcp`.

Тянет за последние 7 дней: тренировки плюс тренерский разбор Coros, форму,
восстановление, нагрузку, HRV сна, дневное здоровье и сон. Числа парсит
из форматированного текста инструментов, нарратив хранит как есть.
GPS-координаты в снимок НЕ попадают, только текстовая метка места.

Пишет:
  data/latest.json                 последний снимок
  data/history/week-YYYY-Www.json  архив недели (для трендов)

Ничего не деплоит и не шифрует, это делают следующие шаги пайплайна.
"""
from __future__ import annotations
import json
import re
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
HISTORY = DATA / "history"
DASH = chr(0x2014)  # разделитель полей в тексте Coros


def call_tool(name: str, args: dict | None = None) -> str:
    """Вызвать инструмент coros-mcp, вернуть текстовый payload."""
    args = args or {}
    proc = subprocess.run(
        ["coros-mcp", "call-tool", "--tool", name,
         "--arguments-json", json.dumps(args)],
        capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"{name} exit {proc.returncode}: {proc.stderr[:300]}")
    payload = json.loads(proc.stdout)
    if payload.get("isError"):
        raise RuntimeError(f"{name} returned isError: {payload}")
    text = payload["content"][0]["text"]
    # часть инструментов отдает text как JSON-строку (двойная кодировка):
    # ведущая кавычка и литеральные \n. Разворачиваем в обычный текст.
    if isinstance(text, str) and text[:1] == '"':
        try:
            text = json.loads(text)
        except Exception:
            text = text.strip('"').encode().decode("unicode_escape")
    return text


def num(pattern: str, text: str, cast=float, group: int = 1):
    m = re.search(pattern, text)
    if not m:
        return None
    try:
        return cast(m.group(group).replace(",", ""))
    except (ValueError, IndexError):
        return None


def grab(pattern: str, text: str):
    m = re.search(pattern, text)
    return m.group(1).strip() if m else None


# ---------- парсеры отдельных инструментов ----------

def parse_fitness(text: str) -> dict:
    return {
        "vo2max": num(r"VO2max:\s*([\d.]+)", text, float),
        "running_level": num(r"Running Level:\s*([\d.]+)", text, float),
        "threshold_pace": grab(r"Threshold Pace:\s*([\d:]+)", text),
        "pred_5k": grab(r"5 km Prediction:\s*([\d:]+)", text),
        "pred_10k": grab(r"10 km Prediction:\s*([\d:]+)", text),
        "pred_half": grab(r"Half Marathon Prediction:\s*([\d:]+)", text),
        "pred_marathon": grab(r"(?m)^\s*Marathon Prediction:\s*([\d:]+)", text),
    }


def parse_recovery(text: str) -> dict:
    return {
        "percent": num(r"Recovery:\s*([\d.]+)%", text, float),
        "level": grab(r"Level:\s*(.+)", text),
        "full_recovery_h": num(r"Estimated Full Recovery:\s*([\d.]+)h", text, float),
    }


def parse_training_load(text: str) -> list[dict]:
    out = []
    for m in re.finditer(
        r"(\d{4}-\d{2}-\d{2})\s*\n\s*Comment:\s*(.+?)\s*\n\s*"
        r"Short-Term Load:\s*([\d.]+)\s*\n\s*Long-Term Load:\s*([\d.]+)"
        r"\s*\n\s*Load Ratio:\s*([\d.]+)",
        text,
    ):
        out.append({
            "date": m.group(1),
            "comment": m.group(2).strip(),
            "short": float(m.group(3)),
            "long": float(m.group(4)),
            "ratio": float(m.group(5)),
        })
    return out


def parse_hrv(text: str) -> list[dict]:
    out = []
    pat = (r"(\d{4}-\d{2}-\d{2}):\s*\n\s*HRV Avg:\s*([\d.]+)\s*ms\s*" + DASH +
           r"\s*(.+?)\s*\n\s*Normal Range:\s*([\d.]+)\s*-\s*([\d.]+)\s*ms"
           r"\s*\n\s*Baseline:\s*([\d.]+)")
    for m in re.finditer(pat, text):
        out.append({
            "date": m.group(1),
            "avg": float(m.group(2)),
            "status": m.group(3).strip(),
            "normal_low": float(m.group(4)),
            "normal_high": float(m.group(5)),
            "baseline": float(m.group(6)),
        })
    return out


def parse_daily(text: str) -> dict:
    resting = num(r"Resting HR:\s*([\d.]+)\s*bpm", text, float)
    hrv_baseline = num(r"HRV Baseline:\s*([\d.]+)\s*ms", text, float)
    days = []
    parts = re.split(r"---\s*(\d{8})\s*---", text)
    # parts = [head, date1, body1, date2, body2, ...]
    for i in range(1, len(parts) - 1, 2):
        raw_date, body = parts[i], parts[i + 1]
        date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}"
        entry = {
            "date": date,
            "steps": num(r"Steps:\s*([\d,]+)", body, int),
            "calories": num(r"Calories:\s*([\d,]+)\s*kcal", body, int),
            "exercise": grab(r"Exercise:\s*(.+)", body),
        }
        total = re.search(
            r"Total:\s*(.+?)\s*\|\s*Deep:\s*(.+?)\s*\|\s*Light:\s*(.+?)"
            r"\s*\|\s*REM:\s*(.+?)\s*\|\s*Awake:\s*(.+?)\n", body)
        if total:
            entry["sleep"] = {
                "total": total.group(1).strip(),
                "deep": total.group(2).strip(),
                "light": total.group(3).strip(),
                "rem": total.group(4).strip(),
                "awake": total.group(5).strip(),
            }
            shr = re.search(
                r"Sleep HR:\s*Avg\s*([\d.]+).*?Min\s*([\d.]+).*?Max\s*([\d.]+)",
                body)
            if shr:
                entry["sleep"]["hr_avg"] = float(shr.group(1))
                entry["sleep"]["hr_min"] = float(shr.group(2))
                entry["sleep"]["hr_max"] = float(shr.group(3))
        days.append(entry)
    return {"resting_hr": resting, "hrv_baseline": hrv_baseline, "days": days}


def parse_sport_records(text: str) -> list[dict]:
    out = []
    chunks = re.split(r"\n\s*\d+\.\s+", text)
    for ch in chunks[1:]:
        first = ch.split("\n")[0].strip()  # "Gravel Bike <dash> 2026-09-10"
        sm = re.match(r"(.+?)\s+" + DASH + r"\s+(\d{4}-\d{2}-\d{2})", first)
        rec = {
            "sport": sm.group(1).strip() if sm else first,
            "date": sm.group(2) if sm else None,
            "location": grab(r"Location:\s*(.+)", ch),
            "duration": grab(r"Duration:\s*([\d:]+)", ch),
            "distance_km": num(r"Distance:\s*([\d.]+)\s*km", ch, float),
            "avg_speed": num(r"Average Speed:\s*([\d.]+)\s*km/h", ch, float),
            "avg_pace": grab(r"Average Pace:\s*([\d:]+)\s*/km", ch),
            "avg_hr": num(r"Avg HR:\s*([\d.]+)\s*bpm", ch, float),
            "calories": num(r"Calories:\s*([\d,]+)\s*kcal", ch, int),
            "label_id": grab(r"LabelId:\s*(\d+)", ch),
            "sport_type": num(r"SportType:\s*(\d+)", ch, int),
        }
        out.append(rec)
    return out


def parse_devices(text: str) -> list[dict]:
    out = []
    for m in re.finditer(
            r"\d+\.\s*(.+?)\n\s*Bluetooth ID:.*?Model Name:\s*(.+?)\n",
            text, re.S):
        out.append({"name": m.group(1).strip(), "model": m.group(2).strip()})
    return out


def iso_week(d: datetime) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


_HRV_RU = {"Above normal": "выше нормы", "Normal": "в норме", "Below normal": "ниже нормы"}


def _sleep_min(s: str | None) -> int:
    if not s:
        return 0
    h = re.search(r"(\d+)\s*h", s)
    m = re.search(r"(\d+)\s*min", s)
    return (int(h.group(1)) * 60 if h else 0) + (int(m.group(1)) if m else 0)


def _comma(x) -> str:
    return str(x).replace(".", ",")


def build_insights(snap: dict, now: datetime) -> dict:
    """Детерминированные выводы недели из метрик. Считаются кодом, поэтому
    обновляются сами при еженедельном headless-прогоне."""
    rec = snap.get("recovery") or {}
    hrv = snap.get("hrv") or []
    daily = (snap.get("daily") or {}).get("days") or []
    load = snap.get("training_load") or []
    ay = snap.get("activities_year") or []
    lines = []

    rp = rec.get("percent")
    hstatus = hrv[0]["status"] if hrv else None
    if rp is not None:
        if rp >= 75 and (hstatus or "") != "Below normal":
            verdict = "организм готов к качественной или длинной тренировке"
        elif rp >= 50:
            verdict = "умеренная нагрузка, без максимальных усилий"
        else:
            verdict = "приоритет восстановлению, лучше отдых или легкое"
        extra = f", HRV {_HRV_RU.get(hstatus, hstatus)}" if hstatus else ""
        lines.append({"label": "Готовность",
                      "text": f"восстановление {int(rp)}%{extra}. Сегодня {verdict}."})

    tots = [_sleep_min((d.get("sleep") or {}).get("total")) for d in daily if d.get("sleep")]
    avg_sleep = sum(tots) / len(tots) if tots else 0
    if tots:
        h = _comma(f"{avg_sleep / 60:.1f}")
        if avg_sleep < 420:
            txt = f"в среднем {h} ч, это меньше 7 ч, стоит добавить сна"
        elif avg_sleep <= 540:
            txt = f"в среднем {h} ч, в норме"
        else:
            txt = f"в среднем {h} ч, много"
        lines.append({"label": "Сон", "text": txt})

    ratio = load[0]["ratio"] if load else None
    if ratio is not None:
        if ratio < 0.8:
            txt = f"снижена (соотношение {_comma(ratio)}), возможна растренированность"
        elif ratio <= 1.3:
            txt = f"сбалансирована (соотношение {_comma(ratio)})"
        elif ratio <= 1.5:
            txt = f"растет (соотношение {_comma(ratio)}), следи за восстановлением"
        else:
            txt = f"высокая (соотношение {_comma(ratio)}), риск перегрузки"
        lines.append({"label": "Нагрузка", "text": txt})

    def wk_of(dstr):
        y, m, d = map(int, dstr.split("-"))
        return datetime(y, m, d).isocalendar()[1]

    def km_week(wk):
        tot = 0.0
        for a in ay:
            if not a.get("date") or wk_of(a["date"]) != wk:
                continue
            st = a.get("sport_type") or 0
            grp = st // 100
            if grp not in (1, 2):
                continue
            if grp == 2 and a.get("avg_speed") is not None and a["avg_speed"] > 42:
                continue
            tot += a.get("distance_km") or 0
        return tot

    cur_wk = now.isocalendar()[1]
    tw, lw = km_week(cur_wk), km_week(cur_wk - 1)
    if tw or lw:
        trend = "больше" if tw > lw else "меньше" if tw < lw else "столько же"
        lines.append({"label": "Объем",
                      "text": f"эта неделя {tw:.0f} км, прошлая {lw:.0f} км ({trend})"})

    rec_line = None
    if rp is not None:
        good_load = ratio is None or ratio <= 1.3
        if rp >= 75 and good_load and avg_sleep >= 420:
            rec_line = "Хорошее окно для качественной или длинной тренировки."
        elif rp < 50 or (ratio is not None and ratio > 1.5) or (tots and avg_sleep < 390):
            rec_line = "Сделай акцент на восстановлении: сон и легкие объемы."
        else:
            rec_line = "Поддерживающая неделя: умеренные тренировки, следи за сном."

    return {"lines": lines, "recommendation": rec_line}


def main():
    now = datetime.now(timezone.utc)
    week_end = now.date()
    week_start = week_end - timedelta(days=6)

    records = parse_sport_records(call_tool("querySportRecords"))
    for r in records:
        if r.get("label_id") and r.get("sport_type") is not None:
            try:
                r["coach"] = call_tool("analyzeActivityDetail", {
                    "labelId": r["label_id"], "sportType": r["sport_type"],
                })
            except Exception as e:
                r["coach"] = f"(разбор недоступен: {e})"

    # добор истории тренировок за текущий год (без тренерского разбора):
    # питает календарь, месячные/годовые объемы, рекорды и тренд по неделям.
    year_records = parse_sport_records(call_tool("querySportRecords", {
        "startDate": f"{now.year}0101",
        "endDate": now.strftime("%Y%m%d"),
        "limit": 500,
    }))

    # набор высоты по каждому заезду. Высота есть только в детали, поэтому
    # кэшируем ее по label_id в data/elevation_cache.json: первый прогон
    # добирает всю историю, дальше деталь дергается только для новых заездов.
    DATA.mkdir(parents=True, exist_ok=True)
    elev_path = DATA / "elevation_cache.json"
    elev_cache = json.loads(elev_path.read_text()) if elev_path.exists() else {}
    fetched = 0
    for r in year_records:
        lid, st = r.get("label_id"), r.get("sport_type")
        if not lid or st is None:
            continue
        if lid in elev_cache:
            r["elevation"] = elev_cache[lid]
            continue
        try:
            detail = call_tool("getActivityDetail", {"labelId": lid, "sportType": st})
            mm = re.search(r"Elevation Gain\s*/\s*Loss:\s*([\d.]+)\s*m", detail)
            elev = float(mm.group(1)) if mm else 0.0
        except Exception:
            elev = None
        r["elevation"] = elev
        if elev is not None:
            elev_cache[lid] = elev
        fetched += 1
        if fetched % 25 == 0:  # периодически сохраняем прогресс
            elev_path.write_text(json.dumps(elev_cache, ensure_ascii=False))
    elev_path.write_text(json.dumps(elev_cache, ensure_ascii=False))

    snapshot = {
        "schema": 1,
        "generated_at": now.isoformat(),
        "week": {"start": week_start.isoformat(), "end": week_end.isoformat(),
                 "iso": iso_week(now)},
        "devices": parse_devices(call_tool("queryDevices")),
        "fitness": parse_fitness(call_tool("queryFitnessAssessmentOverview")),
        "recovery": parse_recovery(call_tool("queryRecoveryStatus")),
        "training_load": parse_training_load(call_tool("queryTrainingLoadAssessment")),
        "hrv": parse_hrv(call_tool("querySleepHrv")),
        "daily": parse_daily(call_tool("queryDailyHealthData")),
        "activities": records,
        "activities_year": year_records,
    }
    snapshot["insights"] = build_insights(snapshot, now)

    DATA.mkdir(parents=True, exist_ok=True)
    HISTORY.mkdir(parents=True, exist_ok=True)
    (DATA / "latest.json").write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2))
    (HISTORY / f"week-{snapshot['week']['iso']}.json").write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2))

    print(f"OK: {len(records)} activities, "
          f"{len(snapshot['hrv'])} hrv days, "
          f"{len(snapshot['daily']['days'])} daily entries")
    print(f"VO2max={snapshot['fitness']['vo2max']} "
          f"recovery={snapshot['recovery']['percent']}% "
          f"resting_hr={snapshot['daily']['resting_hr']}")


if __name__ == "__main__":
    sys.exit(main())
