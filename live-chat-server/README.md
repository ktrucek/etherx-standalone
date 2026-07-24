# EtherX LIVE chat server

Odvojeni PM2 servis za `live.kriptoentuzijasti.io`. Browser lokalno čita samo
nove TikTok LIVE retke, a servis u svojem RAM-u drži sesiju i računa sažetke.
Svakih 30 sekundi radi lokalni snapshot za oporavak nakon PM2 restarta; aktivna
obrada i dalje ostaje u RAM-u.

Dashboard od servera dohvaća kompaktne minutne sažetke, pa za grafove ne mora
držati cijeli chat u rendereru. Cijela zadržana sesija dohvaća se stranicama
samo kada korisnik pokrene Detailed dashboard JSON export.

Poddomena je pripremljena, ali dodavanje ovih datoteka ne pokreće servis i ne
radi deploy. Prije prvog pokretanja obavezno pročitati
[SECURITY-SETUP.md](./SECURITY-SETUP.md).

## Mrežni raspored

- javni WebSocket: `wss://live.kriptoentuzijasti.io/v1/live`
- javni health check: `https://live.kriptoentuzijasti.io/health`
- privatni Node listener: `127.0.0.1:8791`
- PM2 proces: `etherx-live-chat`
- PM2 način: jedna `fork` instanca jer je stanje trenutačno u RAM-u

## Obavezna varijabla

`LIVE_AUTH_TOKEN` u privatnom `.env` mora biti slučajna vrijednost od najmanje
32 znaka. `server.js` tu datoteku učitava pri pokretanju. Token se ne stavlja u
URL, nego se šalje u prvoj WebSocket poruci nakon TLS spajanja.

Stvarni token smije postojati samo u serverskoj datoteci `.env` i u šifriranoj
lokalnoj pohrani vlasnikove instalacije EtherX browsera. Nikada se ne upisuje u
`server.js`, `ecosystem.config.cjs`, `.env.example`, dokumentaciju, issue, commit
ili GitHub Actions log.

## Kasnije pokretanje

Kada poddomena i proxy budu spremni, u ovoj mapi treba instalirati samo
produkcijsku `ws` ovisnost, postaviti `LIVE_AUTH_TOKEN`, pokrenuti
`ecosystem.config.cjs` kroz PM2 te spremiti PM2 stanje. Token koji se postavi na
serveru upisuje se i u EtherX postavku **Pristupni token**.

Nemoj pokretati više PM2 instanci ovog procesa dok se sesije drže samo u RAM-u.
Za cluster način prvo treba dodati Redis ili drugi zajednički session store.

## Plesk dodatne nginx direktive

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

Servis nije pokrenut niti deployan samim dodavanjem ovih datoteka.
