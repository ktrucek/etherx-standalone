# EtherX LIVE chat server

Odvojeni PM2 servis za `live.kriptoentuzijasti.io`. Browser lokalno čita samo
nove TikTok LIVE retke, a servis u svojem RAM-u drži sesiju i računa sažetke.
Svakih 30 sekundi radi lokalni snapshot za oporavak nakon PM2 restarta; aktivna
obrada i dalje ostaje u RAM-u.

Dashboard od servera dohvaća kompaktne minutne sažetke, pa za grafove ne mora
držati cijeli chat u rendereru. Cijela zadržana sesija dohvaća se stranicama
samo kada korisnik pokrene Detailed dashboard JSON export.

Produkcijski servis postavljen je 25. srpnja 2026. PM2 i Apache/WSS proxy rade
na serveru `135.181.51.25`. Javni DNS još mora biti prebačen s IONOS parking
adresa na taj A zapis. Prije održavanja obavezno pročitati
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

## PM2 održavanje

Servis radi pod korisnikom `kriptoen` i njegovim postojećim PM2 daemon procesom:

```bash
export PM2_HOME=/var/www/vhosts/kriptoentuzijasti.io/.pm2
pm2 status etherx-live-chat
pm2 logs etherx-live-chat --lines 50 --nostream
pm2 restart etherx-live-chat
pm2 save
```

Ove naredbe izvršavaju se kao `kriptoen`, ne kao root. Privatni health check:

```bash
curl http://127.0.0.1:8791/health
```

Nemoj pokretati više PM2 instanci ovog procesa dok se sesije drže samo u RAM-u.
Za cluster način prvo treba dodati Redis ili drugi zajednički session store.

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
