# TikTok Chat AI - Implementacijski Plan

## Cilj
Napraviti TikTok Chat AI koji u realnom vremenu skenira chat, prati poklone i viewers metrike, automatski sprema sesije i nudi AI prijedloge bez ručnog klikanja.

## Status sada
- Uveden je temelj za auto-spremanje sesije i auto-download JSON arhive.
- Dodane su napredne postavke skeniranja (interval, auto suggest prag, auto session).
- Dodan je prošireni scraper output: viewers + top supporter meta + coins po poruci.
- Gift galerija je proširena s coin prikazom i sumarnim brojkama.
- Dodana je statistička traka: session vrijeme, viewers (live/peak), ukupni coins, broj supporter-a.
- Dodana je scraper telemetrija (debug meta), fallback strategija i health status (ok/partial/no-data).
- Faza 5 i 6 su završene: auto-suggest debounce/prioritet, session report, CSV export, oznake poruka i sigurnosni limiti.

## Trenutno stanje faza
- Faza 1: ✅
- Faza 2: ✅
- Faza 3: ✅
- Faza 4: ✅
- Faza 5: ✅
- Faza 6: ✅
- Faza 7: ✅
- Sync browser.js/index.html/browser.html: ✅
- Fix duplog tkaiGiftCount ID-a: ✅

## Faza 1 - Skeniranje i stabilnost
1. Ujednačiti selektore za TikTok DOM varijante (desktop/live/popout).
2. Dodati fallback strategiju kada standardni selektori ne vrate rezultate.
3. Uvesti debug telemetriju skeniranja (broj pronađenih čvorova po selectoru).
4. Dodati jednostavan health indikator: scraper OK / partial / no-data.

### Kriterij prihvata
- Skeniranje radi na najmanje 3 različita TikTok live layouta.
- Lažno prazni scan ciklusi smanjeni na minimum.

## Faza 2 - Auto sesije i pohrana
1. Snapshot svake sesije svakih X minuta (postavka).
2. Auto download arhive po snapshotu (toggle).
3. Arhivirati završetak skeniranja (scan stop) kao poseban event.
4. Dodati pregled zadnjih sesija u settings panelu (restore/export/delete).

### Kriterij prihvata
- Svaka aktivna sesija ima najmanje jedan auto snapshot.
- Manual export i auto export daju isti JSON format.

## Faza 3 - Gift i coin analitika
1. Preciznije parsiranje coin vrijednosti iz gift tekstova.
2. Zbrajanje ukupnih coinova po sesiji.
3. Top 3 leaderboard po korisniku (coins + broj događaja).
4. Prikaz “ostali” kategorije i minimalni coin filter.

### Kriterij prihvata
- Top 3 i total coins se ažuriraju u realnom vremenu.
- Filter minimalnih coinova odmah utječe na Gift galeriju.

## Faza 4 - Viewer analitika
1. Učitavati live viewers broj s vrha TikTok ekrana.
2. Čuvati peak viewers po sesiji.
3. Dodati trend (zadnjih N uzoraka) i osnovnu procjenu rasta/pada.
4. Spremiti viewer seriju u JSON sesije.

### Kriterij prihvata
- Live i peak viewers su vidljivi i točni u većini ciklusa.
- Viewer statistika je dio exported session JSON-a.

## Faza 5 - Auto AI prijedlozi
1. Auto-generate nakon X novih poruka (postavka).
2. Debounce da se AI ne poziva prečesto.
3. Kontekstualni prioritet: gift/sub/superfan poruke imaju veću težinu.
4. Dodati opciju “only when panel open”.

### Kriterij prihvata
- AI se pokreće automatski bez spam poziva.
- Prijedlozi odgovaraju dominantnom tipu poruke u zadnjem batchu.

## Faza 6 - Napredno i “ostalo”
1. Dodati “Session Report” (kratki sažetak: viewers, coins, top supporteri, engagement).
2. Dodati CSV export uz JSON.
3. Dodati opciju ručnog označavanja ključnih poruka za kasniju analizu.
4. Uvesti sigurnosne limite (max poruka u memoriji, max veličina exporta).

## Faza 7 - Analitika i uvidi
1. Dodati “Insights” karticu (top teme, top pitanja, sentiment trend).
2. Prikaz engagement metriке po minuti (mini histogram iz poruka).
3. Detekcija “spike” događaja (nagli rast viewers ili giftova) s oznakom vremena.
4. Preporuke za streamera (npr. kada zahvaliti top supporterima).

### Kriterij prihvata
- Insights sekcija daje najmanje 3 korisna uvida po sesiji.
- Spike eventi su vidljivi i vremenski usklađeni s podacima u session JSON-u.

## Tehničke bilješke
- Primarni file logike: src/renderer/js/browser.js
- Primarni file UI panela: src/renderer/browser.html
- Session storage ključ: ex_tkai_sessions

## Kratki rollout plan
1. Stabilizirati Fazu 1 i Fazu 2.
2. Testirati na stvarnom TikTok live streamu 30-60 minuta.
3. Zaključati format sesijskog JSON-a.
4. Onda širiti Fazu 3-5 bez breaking promjena.