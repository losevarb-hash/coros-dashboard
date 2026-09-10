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
