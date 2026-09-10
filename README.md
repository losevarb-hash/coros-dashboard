# Coros Dashboard

Приватный (по PIN) недельный дашборд по данным Coros: тренировки с тренерским
разбором, готовность, сон, HRV, нагрузка, VO2max и прогнозы гонок.
Устройства: COROS DURA (велокомпьютер) и COROS APEX 4.

## Как это устроено

```
coros-mcp (локально, токен на маке)
  -> scripts/coros_fetch.py      тянет неделю, пишет data/*.json (в .gitignore)
  -> scripts/encrypt_data.mjs    шифрует снимок PIN-ключом -> public/coros.enc.json
  -> git push                    в репозиторий уходит ТОЛЬКО зашифрованный файл
  -> GitHub Actions              npm run build -> Pages
```

Открытые данные и токен Coros с компьютера не уезжают. В публичном
репозитории и на Pages лежит только `public/coros.enc.json`.

## Приватность

Сайт публичный (ссылку можно кидать кому угодно, вход и аккаунт не нужны),
но данные зашифрованы AES-256-GCM. Ключ выводится из 4-значного PIN
(PBKDF2-HMAC-SHA256, 200000 итераций). В браузере данные расшифровываются
после ввода PIN. Это защита от случайных зевак, а не крипто-стойкость:
4 цифры перебираются, и данные технически лежат в статике.

Дать доступ: скинуть ссылку и сказать PIN. Сменить PIN: перегенерировать
`public/coros.enc.json` с новым `COROS_PIN` и обновить значение в клиенте.

## Еженедельное обновление

`scripts/weekly_refresh.sh` запускается по понедельникам через launchd
(`~/Library/LaunchAgents/com.losev.coros-dashboard.plist`): тянет свежий
снимок, шифрует, пушит. Actions пересобирает Pages. История недель копится
в `data/history/` локально и целиком входит в зашифрованный пакет, поэтому
тренды растут со временем.

## Локально

```
npm install
python3 scripts/coros_fetch.py      # нужен залогиненный coros-mcp
node scripts/encrypt_data.mjs
npm run build && npm run preview
```

PIN по умолчанию 0000 (env `COROS_PIN`).
