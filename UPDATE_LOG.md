# EtherX Browser - Dnevnik ažuriranja (12. ožujka 2026.)

Ovaj dokument sadrži pregled svih promjena i poboljšanja koja su napravljena u EtherX pregledniku tijekom ove sesije.

## 1. AI Asistent & Gemini API

- **Popravljeno učitavanje Gemini API ključa:** AI sažetak i agent sada ispravno čitaju API ključ iz postavki preglednika. Uklonjen je bug gdje je sustav javljao da ključ nije konfiguriran unatoč tome što je bio unesen.
- **Dodane nove mogućnosti AI agenta:** AI agentu su dodane lokalne brze naredbe koje se izvršavaju bez API poziva (štedi resurse i API kredite):
  - Upiši `pomoć`, `što možeš` ili `opcije` za prikaz svih mogućnosti.
  - Upiši `memorija` ili `potrošnja` za prikaz trenutne potrošnje radne memorije.
  - Upiši `otvori [link]` za brzo otvaranje web stranice u novom tabu putem chat sučelja.
- **Popravljen chat scroll:** Poruke u chatu s AI agentom sada automatski skrolaju prema dnu kako dolaze nove poruke, rješavajući problem gdje su poruke išle ispod trake za unos.

## 2. Postavke i UI Poboljšanja

- **Spremanje povijesti (History Retention):** Popravljeno je spremanje opcije za čuvanje povijesti. Sustav sada ispravno pamti kada se odabere opcija na 90 dana.
- **Uklonjeno zamućenje (Blur) ispod postavki:** Postavke su sada transparentne, ali bez `backdrop-filter: blur`, omogućujući jasniji pogled na web stranicu u pozadini prilikom mijenjanja postavki.
- **Premještena ikona "Tab Overview" (Pregled tabova):** Gumb za pregled svih otvorenih tabova premješten je na krajnju desnu stranu (pokraj gumba za dijeljenje) za lakši i prirodniji pristup.

## 3. Optimizacija i Memorija

- **Memory Saver (Štednja memorije):** Funkcionalnost Memory Savera je potpuno popravljena. Sustav sada ispravno stavlja neaktivne tabove u stanje mirovanja nakon određenog vremena, a pritiskom na njih se ponovno bude (re-loadaju) i vraćaju svoju web stranicu. Postavka se također uspješno pamti.
- **Performance Flags:** Aktivirane su eksperimentalne web zastavice (flags) za brži rad preglednika, poboljšanje performansi `WebGPU`, te `CSS Containment` optimizacije.
- **Multi-Window ponašanje:** Uveden je `windowId` koncept. Sada se sesije tabova spremaju zasebno za svaki otvoreni prozor preglednika, umjesto da se prebrisuju. Ako otvorite novi prozor, on će imati svoje tabove i svoju odvojenu logiku čuvanja sesija.

## 4. Upravljanje Tabovima, Navigacijom i Bookmarkovima

- **Spriječeno otvaranje u drugim programima (Window Open Handler):** Electron sada hvata pokušaje otvaranja eksternih aplikacija (npr. `mailto:`, `skype:`, `zoom:`) i sprječava izlazak iz aplikacije. Normalni `http/https` pop-upovi otvaraju se u novom tabu unutar preglednika.
- **Auto-Bookmarks:** Onemogućeno je agresivno i neželjeno automatsko dodavanje stranica u oznake (bookmarks) na alatnu traku prilikom obične navigacije.
- **"Nedavno posjećeno" (Recently Visited):** Popravljena je funkcija dodavanja u brzi izbornik "Recently Visited" na početnoj stranici (New Tab). Stranice se sada uredno dodaju u popis čim ih se posjeti.

## 5. Rješavanje pogrešaka (Bugs)

- **Riješen `innerHTML` Null TypeError:** Ispravljena je pogreška koja se pojavljivala u redu 17525 gdje je Service Worker pokušavao ažurirati UI prije nego je isti bio spreman.
- **Extensions (Proširenja):** Riješen je temeljni mehanizam učitavanja Chrome proširenja kroz Electron `session.defaultSession.loadExtension` metodu.

## 6. Integracija

- **CryptoPriceTracker Integracija:** Ugrađen je lokalni CryptoPriceTracker izravno u preglednik, a sada je dostupan prema zadanim postavkama. Korisnici mogu isključiti/uključiti ovaj dodatak prema svojim potrebama. Putanja za build je dodana u `package.json` te će se od sada CryptoPriceTracker folder pravilno prenositi u `app.asar` file prilikom builda što će riješiti `ERR_FILE_NOT_FOUND` problem u produkciji.

## 7. Provjera Sintakse i Stabilnosti

- Odrađen temeljit pregled sintakse (`node -c`) za sve ključne datoteke (`main.js`, `preload.js`, `browser.js`, `database.js`, itd.) kako bi se osigurala stabilnost baze koda. Nisu pronađene sintaktičke pogreške.
- Ispravljen problem s Electron `--no-sandbox` flagom u okruženjima s root privilegijama.
