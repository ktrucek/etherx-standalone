# EtherX LIVE chat server

Odvojeni PM2 servis za `live.kriptoentuzijasti.io`. Browser lokalno čita nove
TikTok LIVE događaje, a servis ih trajno sprema u privatnu SQLite bazu u WAL
načinu. RAM ostaje brzi radni sloj za aktivnu sesiju, dok arhiva zadržava
sesije, događaje, korisničke statistike, giftove, coinse, detektorske alarme i
uzorke gledatelja i nakon restarta ili RAM TTL čišćenja.

Zaštićeni dashboard podatke dohvaća stranicama iz arhive i ne mora držati
cijeli chat u rendereru. API token ostaje u `sessionStorage` pregledničke
kartice; ne sprema se u URL ni trajni browser storage.

Prije svakog produkcijskog održavanja provjerite aktualni PM2 proces, privatni
health endpoint i javni TLS/WSS endpoint te pročitajte
[SECURITY-SETUP.md](./SECURITY-SETUP.md).

## Mrežni raspored

- dashboard: `https://live.kriptoentuzijasti.io/dashboard`
- arhivski API: `https://live.kriptoentuzijasti.io/v1/archive/...`
- javni WebSocket: `wss://live.kriptoentuzijasti.io/v1/live`
- javni health check: `https://live.kriptoentuzijasti.io/health`
- privatni Node listener: `127.0.0.1:8791`
- PM2 proces: `etherx-live-chat`
- baza: `LIVE_DATA_DIR/live-archive.sqlite` uz `-wal` i `-shm` datoteke
- PM2 način: jedna `fork` instanca

## Obavezna varijabla

`LIVE_AUTH_TOKEN` u privatnom `.env` mora biti slučajna vrijednost od najmanje
32 znaka. `LIVE_ARCHIVE_API_TOKEN` treba biti drugi slučajni token za dashboard
i read-only arhivski API. Ako arhivski token nije postavljen, servis radi
kompatibilnosti koristi `LIVE_AUTH_TOKEN`. Token se nikada ne stavlja u URL.

Stvarni token smije postojati samo u serverskoj datoteci `.env` i u šifriranoj
lokalnoj pohrani vlasnikove instalacije EtherX browsera. Nikada se ne upisuje u
`server.js`, `ecosystem.config.cjs`, `.env.example`, dokumentaciju, issue, commit
ili GitHub Actions log.

## PM2 održavanje

Najprije provjerite koji PM2 daemon stvarno posjeduje proces; nemojte pretpostaviti
korisnika samo iz putanje projekta:

```bash
pm2 status etherx-live-chat
pm2 logs etherx-live-chat --lines 50 --nostream
pm2 restart etherx-live-chat
pm2 save
```

Restartajte samo `etherx-live-chat`, nikada sve PM2 procese. Privatni health check:

```bash
curl http://127.0.0.1:8791/health
```

Telegram komande za trajnu bazu:

- `/menu` — glavni izbornik s Telegram gumbima
- `/db` — ukupna serverska statistika
- `/creators`, `/creator @kreator` — popis i profil kreatora
- `/creatorstreams`, `/creatorgrowth`, `/beststream`, `/worststream`, `/besttime`, `/retention`
- `/sessions [broj]` — zadnje spremljene sesije
- `/session <broj|id>` — detalji jedne sesije
- `/events <broj|id> [broj]` — zadnji događaji sesije
- `/users <broj|id> [broj]` — korisnici i njihove statistike
- `/viewers` — kreatori i broj njihove spremljene publike
- `/viewers @kreator [stranica]` — publika jednog kreatora kroz sve sesije
- `/viewers @kreator all` — CSV sa svim spremljenim viewers tog kreatora
- `/viewers all` — jedan CSV sa svim viewers, odvojeno po kreatorima
- `/viweres ...` — podržani alias za istu naredbu
- `/userdata @user` — cijela spremljena povijest korisnika
- `/userdata @user @kreator 2026-07-28` — korisnik kod kreatora određenog dana
- `/userdata @user stream:live-...` — korisnik u točno određenom streamu
- `/userdata "Ime s razmakom" @kreator` — pretraga po prikazanom imenu
- `/userstreams @user @kreator` — streamovi korisnika kod kreatora
- `/newviewers`, `/returning`, `/loyal`, `/inactive`, `/whales` — segmenti publike
- `/crossviewers @kreator1 @kreator2` — preklapanje publike
- `/daily`, `/weekly`, `/monthly` — izvještaji po periodu i kreatoru
- `/search`, `/questions`, `/keywords`, `/sentiment` — pretraga i analiza razgovora
- `/gifts`, `/gifters` — arhivska gift statistika
- `/watchuser`, `/unwatchuser`, `/watchlist` — serverska watchlista
- `/export creator|user|stream`, `/chart growth` — CSV i SVG dokumenti
- `/serverstatus`, `/dbstatus`, `/backupstatus`, `/backup` — stanje i sigurnosna kopija
- `/forgetuser @user` — privatnost; zahtijeva dodatnu potvrdu i prvo radi backup
- `/alert ...` — pragovi i automatski dnevni/tjedni izvještaji

Produkcijski server koristi HTTPS webhook `/v1/telegram/webhook`, pa radi 24/7
bez pokrenutog desktop browsera. Telegram dopušta samo jedan webhook ili jednu
`getUpdates` polling instancu po bot tokenu; dok je produkcijski webhook aktivan
ne pokretati drugi PM2/desktop polling bot.

Nemoj pokretati više PM2 instanci nad istom SQLite datotekom. Za cluster način
prvo treba prijeći na zajednički PostgreSQL session store.

## Arhivski API

Svi arhivski endpointi traže zaglavlje `Authorization: Bearer <token>`:

- `GET /v1/archive/status`
- `GET /v1/archive/stream` — autorizirani SSE kanal za promjene arhive
- `GET /v1/archive/overview`
- `GET /v1/archive/live-state?sessionId=` — trenutno Redis/RAM stanje aktivne
  sesije (vieweri, peak, gift/coin counteri i ostali agregati)
- `GET /v1/archive/sessions?limit=100&offset=0&search=creator`
- `GET /v1/archive/sessions/:id`
- `GET /v1/archive/sessions/:id/dashboard?points=120` — gotovi KPI-jevi i
  SQL-agregirane/downsampled krivulje bez sirovih nizova
- `GET /v1/archive/sessions/:id/events`
- `GET /v1/archive/sessions/:id/users`
- `GET /v1/archive/sessions/:id/alerts`
- `GET /v1/archive/sessions/:id/viewers`
- `GET /v1/archive/creators`
- `GET /v1/archive/reports`
- `GET /v1/archive/search`
- `GET /v1/archive/creators/:owner/audience`
- `GET /v1/archive/audience/compare`

Dashboard otvara jedan `text/event-stream` kanal pomoću streaming `fetch`
zahtjeva s Bearer tokenom. Token se ne stavlja u URL. Server spaja brze izmjene
u batch poruke, šalje keepalive svakih 20 sekundi i dashboard učitava detalje
samo za promijenjenu odabranu sesiju. Ako se SSE prekine, automatski se ponovno
spaja uz eksponencijalni backoff, uz privremeni fallback refresh svakih 30
sekundi.

Početno otvaranje sesije koristi samo `/dashboard`: server u SQL-u računa
zbrojeve, prosjeke, stope po minuti, top giftove, top 25 korisnika, sažetak
alarma i bucketirane activity/viewer trendove. Broj točaka po krivulji ograničen
je na 240 (dashboard standardno traži 120), neovisno o broju sirovih redaka.
Sirovi događaji i alarmi ne ulaze u početni payload; učitavaju se tek otvaranjem
njihove kartice, u stranicama od najviše 100 zapisa.

## Redis live buffer

`LIVE_REDIS_URL` uključuje Redis sloj za često promjenjivo stanje aktivnog
LIVE-a. Server u Redis sprema trenutne viewere, peak, gift/coin countere,
brojeve događaja i broj korisnika. Redis zapisi se grupiraju u kratke batcheve,
a agregati se u SQLite zapisuju svakih `LIVE_ARCHIVE_FLUSH_SECONDS` (zadano 10
sekundi) te obavezno na `end_session`, cleanup i shutdown.

Sirovi eventovi i promijenjeni korisnički redovi i dalje se odmah zapisuju u
SQLite radi trajnosti. Ako Redis nije konfiguriran ili privremeno nije dostupan,
server automatski koristi lokalni RAM buffer i nastavlja raditi. Ključevi imaju
TTL `LIVE_REDIS_TTL_SECONDS`, a namespace se mijenja kroz `LIVE_REDIS_PREFIX`.

Admin POST endpointi dodatno traže `x-archive-admin-token`:

- `POST /v1/archive/admin/backup`
- `POST /v1/archive/admin/delete-user`
- `POST /v1/archive/admin/settings/:key`
- `POST /v1/archive/admin/watch-users`
- `POST /v1/archive/admin/audit`
- `GET /v1/archive/creators/:owner/viewers`
- `GET /v1/archive/users/:user?creator=&date=YYYY-MM-DD&sessionId=`

Baza i njezine WAL/SHM datoteke moraju ostati izvan javnog web root direktorija
i imati pristup samo servisnom korisniku. Za dosljedan backup koristi se SQLite
online backup ili se servis kratko zaustavi prije kopiranja sva tri fajla.

## Plesk proxy

Na ovom serveru javni TLS vhost poslužuje Apache, a nginx servis nije aktivan.
Zato se koristi [apache-vhost.conf.example](./apache-vhost.conf.example) kroz
Pleskove `vhost.conf` i `vhost_ssl.conf` datoteke. Nakon promjene:

```bash
plesk sbin httpdmng --reconfigure-domain live.kriptoentuzijasti.io
apache2ctl configtest
systemctl reload apache2
```

Ako se kasnije aktivira nginx kao Pleskov reverse proxy, ekvivalentne dodatne
nginx direktive su:

```nginx
location = /health {
    proxy_pass http://127.0.0.1:8791/health;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
}

location /v1/live {
    proxy_pass http://127.0.0.1:8791;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

Stvarni `.env`, snapshoti i PM2 logovi ostaju izvan Gita.
