# EtherX LIVE: sigurnost, GitHub i postavljanje servera

Ovaj dokument je kontrolna lista za privatni EtherX LIVE servis na
`live.kriptoentuzijasti.io`. Ne sadrži stvarnu lozinku, token ni privatni ključ.

## Dogovoreni sigurnosni model

- Endpoint nije tajna i smije biti u javnom kodu:
  `wss://live.kriptoentuzijasti.io/v1/live`.
- Health endpoint je `https://live.kriptoentuzijasti.io/health`.
- Stvarni `LIVE_AUTH_TOKEN` nikada ne ide u GitHub, distribucijski paket ni
  dokumentaciju.
- Javni browser release dolazi s praznim poljem **Pristupni token**.
- Samo vlasnik servera upisuje token u svoju lokalnu instalaciju.
- Browser token sprema u EtherX `SecretStore`, a ne u obični renderer
  `localStorage`.
- Produkcija koristi isključivo `wss://`; obični `ws://` dopušten je samo za
  lokalni `localhost` test.
- Jedna PM2 `fork` instanca je obavezna dok su sesije u RAM-u. Za više instanci
  prvo treba uvesti Redis ili drugi zajednički session store.

Poznavanje endpointa ne daje pristup. Server mora odbiti svaku vezu bez valjanog
tokena.

## Što smije, a što ne smije u GitHub

Smije se commitati:

- `server.js`
- `package.json`
- `ecosystem.config.cjs`
- `.env.example` s placeholder vrijednostima
- `README.md`
- ovaj sigurnosni vodič

Ne smije se commitati:

- `live-chat-server/.env` ili bilo koji stvarni environment file
- stvarni `LIVE_AUTH_TOKEN`
- TLS privatni ključevi i certifikati
- `data/live-sessions.json` i drugi snapshoti razgovora
- PM2 ili aplikacijski logovi
- datoteke naziva `token`, `secret`, `private` ili njihove kopije
- snimke zaslona i upute koje prikazuju token

Glavni i lokalni `.gitignore` već blokiraju navedene datoteke. `.env.example`
je iznimka i mora sadržavati samo lažne vrijednosti.

Prije svakog pushanja provjeriti:

```bash
git status --short --ignored
git diff --cached
git grep -n "LIVE_AUTH_TOKEN="
```

Rezultat pretrage smije prikazati samo placeholder iz `.env.example` ili naziv
varijable u kodu, nikada stvarnu vrijednost.

Na GitHub repozitoriju uključiti:

- Secret scanning
- Push protection
- zaštitu glavne grane
- zabranu spremanja produkcijskih tajni u Actions workflow datoteke

Ako token ikada završi u commitu, brisanje samo zadnje verzije datoteke nije
dovoljno. Token se odmah smatra kompromitiranim: treba ga promijeniti na
serveru, restartati proces, ažurirati lokalni browser i tek zatim očistiti Git
povijest.

## Priprema privatnog `.env`

Na serveru se iz `.env.example` napravi privatna `.env` datoteka. Pravi token
generira se na serveru ili u pouzdanom password manageru. Primjer naredbe koja
se smije izvršiti tek tijekom odobrenog postavljanja:

```bash
openssl rand -hex 48
```

Dobivena vrijednost ima 96 znakova. Ne kopirati je u chat, issue, dokumentaciju
ili terminalsku naredbu koja se sprema u shell history. Upisuje se samo u:

```dotenv
LIVE_AUTH_TOKEN=OVDJE_IDE_STVARNA_PRIVATNA_VRIJEDNOST
```

Preporučene dozvole:

```bash
chmod 600 .env
chmod 700 data
```

Osnovne produkcijske vrijednosti:

```dotenv
LIVE_HOST=127.0.0.1
LIVE_PORT=8791
LIVE_MAX_EVENTS_PER_SESSION=10000
LIVE_SESSION_TTL_MINUTES=360
LIVE_MAX_CLIENTS=50
LIVE_MAX_SESSIONS=200
LIVE_MAX_CONNECTIONS_PER_IP=5
LIVE_AUTH_WINDOW_SECONDS=60
LIVE_AUTH_MAX_FAILURES=8
LIVE_AUTH_BLOCK_MINUTES=15
LIVE_MESSAGE_WINDOW_SECONDS=10
LIVE_MAX_MESSAGES_PER_WINDOW=120
LIVE_MAX_TIMELINE_BUCKETS=360
LIVE_SNAPSHOT_SECONDS=30
LIVE_DATA_DIR=
LIVE_ALLOWED_ORIGINS=
LIVE_HEALTH_DETAILS=false
```

`LIVE_ALLOWED_ORIGINS` ne postavljati napamet. Prvo treba utvrditi točan
`Origin` koji šalje potpisana Electron aplikacija, zatim dopustiti samo točne
vrijednosti. Ne koristiti `*`. Origin je dodatna zaštita, a ne zamjena za token.

## Plesk/nginx proxy

Privatni Node servis sluša samo na `127.0.0.1:8791`. Javno su dostupne samo
nginx rute preko TLS-a:

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

Node port `8791` ne otvarati javno u firewallu. TLS certifikat ostaje pod
Pleskom/nginxom i ne kopira se u repozitorij.

## PM2 postupak kada deploy bude izričito odobren

Ove naredbe su upute; samo zapisivanje dokumenta ih ne izvršava:

```bash
cd /PUTANJA/DO/live-chat-server
npm install --omit=dev
pm2 start ecosystem.config.cjs
pm2 save
pm2 status etherx-live-chat
pm2 logs etherx-live-chat --lines 50 --nostream
```

Proces mora biti jedna `fork` instanca pod namjenskim korisnikom, bez root
ovlasti. `.env`, `data/` i logovi moraju ostati izvan Git repozitorija.

## Obavezne provjere prije produkcije

1. `https://live.kriptoentuzijasti.io/health` mora raditi preko valjanog TLS-a.
2. `ws://live.kriptoentuzijasti.io` ne smije se koristiti u produkciji.
3. Veza bez tokena mora biti odbijena.
4. Veza s pogrešnim tokenom mora biti odbijena.
5. Veza s ispravnim tokenom mora dobiti `ready`.
6. Prevelika poruka mora biti odbijena.
7. Nakon prekida browser mora prijeći na lokalni fallback.
8. Nakon PM2 restarta snapshot se mora vratiti bez izlaganja preko HTTP-a.
9. U logovima ne smiju biti tokeni ni cijeli sadržaji privatnog chata.
10. Git status ne smije prikazati `.env`, `data/`, logove ili certifikate kao
    datoteke za commit.

Već je implementirano:

- ograničenje istodobnih veza po IP adresi
- ograničenje ukupnog broja zadržanih sesija za master token
- privremena blokada nakon ponavljanih neuspješnih autentikacija
- ograničenje broja WebSocket poruka po vremenskom prozoru
- sigurnosni zapis odbijanja bez tokena i sadržaja privatnog chata
- minimalan javni `/health` odgovor; detalji su dostupni samo kada se izričito
  postavi `LIVE_HEALTH_DETAILS=true`

Prije javnog korištenja još treba produkcijski provjeriti navedena ograničenja.
Ako servis kasnije dobije više vlasnika/korisnika, treba dodati pojedinačne
tokene, kvote i opoziv po računu ili uređaju.

## Upis tokena u EtherX browser

U javnoj aplikaciji endpoint može biti unaprijed postavljen, ali token mora biti
prazan. Vlasnik ga lokalno upisuje u:

`Settings → AI Live Chat → LIVE server → Pristupni token`

Nakon toga koristi se gumb **Spoji/testiraj**. Token se ne šalje u URL, nego tek
u prvoj autentikacijskoj poruci nakon uspostavljanja WSS veze.

Ne objavljivati instalaciju koja već sadrži vlasnikov token. Ni šifriranje
ugrađenog zajedničkog tokena ne rješava problem jer se tajna iz distribuirane
aplikacije može izvući.

## Rotacija tokena

Token treba promijeniti:

- odmah nakon sumnje na curenje
- nakon pristupa serveru od strane neovlaštene osobe
- nakon slučajnog commita ili prikaza u logu/snimci zaslona
- periodično prema dogovorenoj sigurnosnoj politici

Postupak:

1. generirati novu slučajnu vrijednost
2. zamijeniti `LIVE_AUTH_TOKEN` samo u serverskom `.env`
3. restartati jednu PM2 instancu
4. upisati novi token u vlasnikov EtherX browser
5. potvrditi da stari token više ne radi
6. pregledati logove i Git povijest

## Ako server kasnije koriste drugi korisnici

Jedan zajednički master token ne smije se dijeliti korisnicima. Potrebno je
uvesti:

- korisnički račun ili licencu
- HTTPS aktivacijski endpoint
- kratkotrajni potpisani pristupni token
- refresh token vezan uz korisnika i uređaj
- dozvole i kvote po korisniku
- pojedinačni opoziv uređaja

Master token ostaje samo server-to-server tajna. Javni klijent nikada ga ne
prima.
