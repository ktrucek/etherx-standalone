/**
 * EtherX Browser — Internationalization (i18n)
 * Copyright © 2024–2026 kriptoentuzijasti.io. All Rights Reserved.
 * PROPRIETARY AND CONFIDENTIAL — See LICENSE file.
 *
 * Supported languages:
 *   hr — Hrvatski (Croatian) [default]
 *   en — English
 *   de — Deutsch
 *   fr — Français
 *   es — Español
 *   it — Italiano
 *   pt — Português
 *   ru — Русский
 *   tr — Türkçe
 *   pl — Polski
 *   bs — Bosanski
 *   sr — Srpski
 *   sl — Slovenščina
 */

'use strict';

const STRINGS = {
  hr: {
    newTab:           'Nova kartica',
    home:             'Početna',
    back:             'Natrag',
    forward:          'Naprijed',
    reload:           'Osvježi',
    stop:             'Zaustavi',
    bookmarks:        'Oznake',
    history:          'Povijest',
    settings:         'Postavke',
    downloads:        'Preuzimanja',
    incognito:        'Privatno pregledavanje',
    search:           'Pretraži ili upiši adresu',
    aiSearch:         'Pitaj AI...',
    adBlocker:        'Blokator reklama',
    adBlockOn:        'Blokator reklama: Uključen',
    adBlockOff:       'Blokator reklama: Isključen',
    secureConn:       'Sigurna veza (TLS 1.3)',
    insecureConn:     'Nesigurna veza',
    phishingWarn:     'Upozorenje: Ova stranica može biti phishing!',
    readingMode:      'Način čitanja',
    translate:        'Prevedi',
    zoomIn:           'Povećaj',
    zoomOut:          'Smanji',
    tabGroup:         'Grupiraj kartice',
    saveAs:           'Spremi stranicu kao...',
    share:            'Dijeli',
    cast:             'Prikaži na TV-u',
    syncQR:           'Sinkronizacija (QR kod)',
    defaultBrowser:   'Postavi kao zadani preglednik',
    passwords:        'Lozinke',
    language:         'Jezik',
    theme:            'Tema',
    about:            'O pregledniku',
    version:          'Verzija',
    close:            'Zatvori',
    cancel:           'Odustani',
    save:             'Spremi',
    ok:               'U redu',
    error:            'Greška',
    loading:          'Učitavam...',
    noResults:        'Nema rezultata',
    groupSocialMedia: 'Društvene mreže',
    groupVideo:       'Video',
    groupShopping:    'Kupovina',
    groupNews:        'Vijesti',
    groupDev:         'Razvoj',
    groupCrypto:      'Kripto / Web3',
    groupFinance:     'Financije',
    groupWork:        'Posao',
    groupAI:          'AI i tehnologija',
    groupEducation:   'Obrazovanje',
    groupOther:       'Ostalo',
    copyUrl:          'Kopiraj URL',
    pasteAndGo:       'Zalijepi i idi',
    devTools:         'Alati za programere',
    fullScreen:       'Cijeli zaslon',
    exitFullScreen:   'Izlaz iz cijelog zaslona',
    lockVault:        'Zaključaj trezor',
    unlockVault:      'Otključaj trezor',
    masterPassword:   'Glavna lozinka',
    addPassword:      'Dodaj lozinku',
    exportPasswords:  'Izvoz lozinki (Bitwarden format)',
    importPasswords:  'Uvoz lozinki',
    disclaimer:       'kriptoentuzijasti.io nema pristup vašim lozinkama.',
    incognitoNote:    'Privatno pregledavanje: stranice se ne sprema u povijest.',
    setDefaultOk:     'EtherX je postavljen kao zadani preglednik.',
    qrScanInfo:       'Skenirajte QR kodom na drugom uređaju za sinkronizaciju.',
  },

  en: {
    newTab:           'New Tab',
    home:             'Home',
    back:             'Back',
    forward:          'Forward',
    reload:           'Reload',
    stop:             'Stop',
    bookmarks:        'Bookmarks',
    history:          'History',
    settings:         'Settings',
    downloads:        'Downloads',
    incognito:        'Private Browsing',
    search:           'Search or type a URL',
    aiSearch:         'Ask AI...',
    adBlocker:        'Ad Blocker',
    adBlockOn:        'Ad Blocker: On',
    adBlockOff:       'Ad Blocker: Off',
    secureConn:       'Secure connection (TLS 1.3)',
    insecureConn:     'Not secure',
    phishingWarn:     'Warning: This page may be a phishing site!',
    readingMode:      'Reading Mode',
    translate:        'Translate',
    zoomIn:           'Zoom In',
    zoomOut:          'Zoom Out',
    tabGroup:         'Group Tabs',
    saveAs:           'Save page as...',
    share:            'Share',
    cast:             'Cast to TV',
    syncQR:           'Sync (QR Code)',
    defaultBrowser:   'Set as Default Browser',
    passwords:        'Passwords',
    language:         'Language',
    theme:            'Theme',
    about:            'About',
    version:          'Version',
    close:            'Close',
    cancel:           'Cancel',
    save:             'Save',
    ok:               'OK',
    error:            'Error',
    loading:          'Loading...',
    noResults:        'No results',
    groupSocialMedia: 'Social Media',
    groupVideo:       'Video',
    groupShopping:    'Shopping',
    groupNews:        'News',
    groupDev:         'Development',
    groupCrypto:      'Crypto / Web3',
    groupFinance:     'Finance',
    groupWork:        'Work',
    groupAI:          'AI & Tech',
    groupEducation:   'Education',
    groupOther:       'Other',
    copyUrl:          'Copy URL',
    pasteAndGo:       'Paste & Go',
    devTools:         'Developer Tools',
    fullScreen:       'Full Screen',
    exitFullScreen:   'Exit Full Screen',
    lockVault:        'Lock Vault',
    unlockVault:      'Unlock Vault',
    masterPassword:   'Master Password',
    addPassword:      'Add Password',
    exportPasswords:  'Export Passwords (Bitwarden format)',
    importPasswords:  'Import Passwords',
    disclaimer:       'kriptoentuzijasti.io has no access to your passwords.',
    incognitoNote:    'Private browsing: pages are not saved to history.',
    setDefaultOk:     'EtherX is now the default browser.',
    qrScanInfo:       'Scan the QR code on another device to sync.',
  },

  de: {
    newTab: 'Neuer Tab', home: 'Startseite', back: 'Zurück',
    forward: 'Vor', reload: 'Neu laden', stop: 'Stopp',
    bookmarks: 'Lesezeichen', history: 'Verlauf', settings: 'Einstellungen',
    downloads: 'Downloads', incognito: 'Privates Surfen',
    search: 'Suchen oder URL eingeben', aiSearch: 'KI fragen...',
    adBlocker: 'Werbeblocker', adBlockOn: 'Werbeblocker: Ein', adBlockOff: 'Werbeblocker: Aus',
    secureConn: 'Sichere Verbindung (TLS 1.3)', insecureConn: 'Nicht sicher',
    phishingWarn: 'Warnung: Diese Seite könnte Phishing sein!',
    readingMode: 'Lesemodus', translate: 'Übersetzen',
    share: 'Teilen', cast: 'Auf TV übertragen', syncQR: 'Synchronisierung (QR-Code)',
    defaultBrowser: 'Als Standardbrowser festlegen', passwords: 'Passwörter',
    language: 'Sprache', theme: 'Design', about: 'Über', version: 'Version',
    close: 'Schließen', cancel: 'Abbrechen', save: 'Speichern', ok: 'OK',
    error: 'Fehler', loading: 'Laden...', noResults: 'Keine Ergebnisse',
    disclaimer: 'kriptoentuzijasti.io hat keinen Zugriff auf Ihre Passwörter.',
    incognitoNote: 'Privates Surfen: Seiten werden nicht im Verlauf gespeichert.',
  },

  fr: {
    newTab: 'Nouvel onglet', home: 'Accueil', back: 'Retour',
    forward: 'Suivant', reload: 'Actualiser', stop: 'Arrêter',
    bookmarks: 'Favoris', history: 'Historique', settings: 'Paramètres',
    downloads: 'Téléchargements', incognito: 'Navigation privée',
    search: 'Rechercher ou saisir une URL', aiSearch: 'Demander à l\'IA...',
    adBlocker: 'Bloqueur de pubs', secureConn: 'Connexion sécurisée (TLS 1.3)',
    insecureConn: 'Non sécurisé', phishingWarn: 'Attention: site de phishing possible!',
    readingMode: 'Mode lecture', translate: 'Traduire',
    share: 'Partager', defaultBrowser: 'Définir comme navigateur par défaut',
    passwords: 'Mots de passe', language: 'Langue', theme: 'Thème',
    close: 'Fermer', cancel: 'Annuler', save: 'Enregistrer', ok: 'OK',
    error: 'Erreur', loading: 'Chargement...', noResults: 'Aucun résultat',
    disclaimer: 'kriptoentuzijasti.io n\'a pas accès à vos mots de passe.',
    incognitoNote: 'Navigation privée: les pages ne sont pas enregistrées.',
  },

  es: {
    newTab: 'Nueva pestaña', home: 'Inicio', back: 'Atrás',
    forward: 'Adelante', reload: 'Recargar', stop: 'Detener',
    bookmarks: 'Marcadores', history: 'Historial', settings: 'Configuración',
    search: 'Buscar o escribe una URL', aiSearch: 'Preguntar a la IA...',
    secure: 'Conexión segura (TLS 1.3)', insecureConn: 'No seguro',
    phishingWarn: '¡Advertencia: posible phishing!',
    readingMode: 'Modo lectura', translate: 'Traducir',
    share: 'Compartir', defaultBrowser: 'Establecer como navegador predeterminado',
    passwords: 'Contraseñas', language: 'Idioma', theme: 'Tema',
    close: 'Cerrar', cancel: 'Cancelar', save: 'Guardar', ok: 'Aceptar',
    error: 'Error', loading: 'Cargando...', noResults: 'Sin resultados',
    disclaimer: 'kriptoentuzijasti.io no tiene acceso a tus contraseñas.',
  },

  it: {
    newTab: 'Nuova scheda', home: 'Home', back: 'Indietro',
    forward: 'Avanti', reload: 'Ricarica', stop: 'Ferma',
    bookmarks: 'Segnalibri', history: 'Cronologia', settings: 'Impostazioni',
    search: 'Cerca o inserisci un URL', aiSearch: 'Chiedi all\'AI...',
    secureConn: 'Connessione sicura (TLS 1.3)', insecureConn: 'Non sicuro',
    phishingWarn: 'Attenzione: possibile phishing!',
    readingMode: 'Modalità lettura', translate: 'Traduci',
    share: 'Condividi', defaultBrowser: 'Imposta come browser predefinito',
    passwords: 'Password', language: 'Lingua', theme: 'Tema',
    close: 'Chiudi', cancel: 'Annulla', save: 'Salva', ok: 'OK',
    error: 'Errore', loading: 'Caricamento...', noResults: 'Nessun risultato',
    disclaimer: 'kriptoentuzijasti.io non ha accesso alle tue password.',
  },

  pt: {
    newTab: 'Nova aba', home: 'Início', back: 'Voltar', forward: 'Avançar',
    reload: 'Recarregar', stop: 'Parar', bookmarks: 'Favoritos',
    history: 'Histórico', settings: 'Configurações',
    search: 'Pesquise ou insira uma URL', aiSearch: 'Perguntar à IA...',
    secureConn: 'Conexão segura (TLS 1.3)', insecureConn: 'Não seguro',
    phishingWarn: 'Aviso: possível phishing!',
    readingMode: 'Modo leitura', translate: 'Traduzir',
    share: 'Compartilhar', defaultBrowser: 'Definir como navegador padrão',
    passwords: 'Senhas', language: 'Idioma', theme: 'Tema',
    close: 'Fechar', cancel: 'Cancelar', save: 'Salvar', ok: 'OK',
    error: 'Erro', loading: 'Carregando...', noResults: 'Nenhum resultado',
    disclaimer: 'kriptoentuzijasti.io não tem acesso às suas senhas.',
  },

  ru: {
    newTab: 'Новая вкладка', home: 'Главная', back: 'Назад', forward: 'Вперёд',
    reload: 'Обновить', stop: 'Стоп', bookmarks: 'Закладки',
    history: 'История', settings: 'Настройки',
    search: 'Поиск или введите URL', aiSearch: 'Спросить ИИ...',
    secureConn: 'Безопасное соединение (TLS 1.3)', insecureConn: 'Небезопасно',
    phishingWarn: 'Внимание: возможный фишинг!',
    readingMode: 'Режим чтения', translate: 'Перевести',
    share: 'Поделиться', defaultBrowser: 'Браузер по умолчанию',
    passwords: 'Пароли', language: 'Язык', theme: 'Тема',
    close: 'Закрыть', cancel: 'Отмена', save: 'Сохранить', ok: 'ОК',
    error: 'Ошибка', loading: 'Загрузка...', noResults: 'Нет результатов',
    disclaimer: 'kriptoentuzijasti.io не имеет доступа к вашим паролям.',
  },

  bs: {
    newTab: 'Nova kartica', home: 'Početna', back: 'Nazad', forward: 'Naprijed',
    reload: 'Osvježi', stop: 'Zaustavi', bookmarks: 'Oznake',
    history: 'Historija', settings: 'Postavke',
    search: 'Pretraži ili upiši adresu', aiSearch: 'Pitaj AI...',
    secureConn: 'Sigurna veza (TLS 1.3)', insecureConn: 'Nije sigurno',
    phishingWarn: 'Upozorenje: Moguci phishing!',
    readingMode: 'Način čitanja', translate: 'Prevedi',
    share: 'Podijeli', defaultBrowser: 'Postavi kao zadani browser',
    passwords: 'Lozinke', language: 'Jezik', theme: 'Tema',
    close: 'Zatvori', cancel: 'Odustani', save: 'Spremi', ok: 'OK',
    error: 'Greška', loading: 'Učitavam...', noResults: 'Nema rezultata',
    disclaimer: 'kriptoentuzijasti.io nema pristup vašim lozinkama.',
  },

  sr: {
    newTab: 'Nova kartica', home: 'Početna', back: 'Nazад', forward: 'Napred',
    reload: 'Osvеži', stop: 'Zaustavi', bookmarks: 'Oznake',
    history: 'Istorija', settings: 'Podešavanja',
    search: 'Pretraži ili unesi adresu', aiSearch: 'Pitaj AI...',
    secureConn: 'Bezbedna veza (TLS 1.3)', insecureConn: 'Nije bezbedno',
    phishingWarn: 'Upozorenje: Moguć phishing!',
    readingMode: 'Mod čitanja', translate: 'Prevedi',
    share: 'Podeli', defaultBrowser: 'Postavi kao podrazumevani pregledač',
    passwords: 'Lozinke', language: 'Jezik', theme: 'Tema',
    close: 'Zatvori', cancel: 'Otkaži', save: 'Sačuvaj', ok: 'OK',
    error: 'Greška', loading: 'Učitavam...', noResults: 'Nema rezultata',
    disclaimer: 'kriptoentuzijasti.io nema pristup vašim lozinkama.',
  },

  sl: {
    newTab: 'Nov zavihek', home: 'Domov', back: 'Nazaj', forward: 'Naprej',
    reload: 'Osveži', stop: 'Ustavi', bookmarks: 'Zaznamki',
    history: 'Zgodovina', settings: 'Nastavitve',
    search: 'Iskanje ali vnesite URL', aiSearch: 'Vprašaj AI...',
    secureConn: 'Varna povezava (TLS 1.3)', insecureConn: 'Ni varno',
    phishingWarn: 'Opozorilo: Možen phishing!',
    readingMode: 'Način branja', translate: 'Prevedi',
    share: 'Deli', defaultBrowser: 'Nastavi kot privzeti brskalnik',
    passwords: 'Gesla', language: 'Jezik', theme: 'Tema',
    close: 'Zapri', cancel: 'Prekliči', save: 'Shrani', ok: 'OK',
    error: 'Napaka', loading: 'Nalaganje...', noResults: 'Ni rezultatov',
    disclaimer: 'kriptoentuzijasti.io nima dostopa do vaših gesel.',
  },

  tr: {
    newTab: 'Yeni Sekme', home: 'Ana Sayfa', back: 'Geri', forward: 'İleri',
    reload: 'Yenile', stop: 'Durdur', bookmarks: 'Yer İşaretleri',
    history: 'Geçmiş', settings: 'Ayarlar',
    search: 'Ara veya URL yaz', aiSearch: 'AI\'ya sor...',
    secureConn: 'Güvenli bağlantı (TLS 1.3)', insecureConn: 'Güvenli değil',
    phishingWarn: 'Uyarı: Olası kimlik avı!',
    readingMode: 'Okuma modu', translate: 'Çevir',
    share: 'Paylaş', defaultBrowser: 'Varsayılan tarayıcı olarak ayarla',
    passwords: 'Şifreler', language: 'Dil', theme: 'Tema',
    close: 'Kapat', cancel: 'İptal', save: 'Kaydet', ok: 'Tamam',
    error: 'Hata', loading: 'Yükleniyor...', noResults: 'Sonuç yok',
    disclaimer: 'kriptoentuzijasti.io şifrelerinize erişemez.',
  },

  pl: {
    newTab: 'Nowa karta', home: 'Strona główna', back: 'Wstecz', forward: 'Dalej',
    reload: 'Odśwież', stop: 'Zatrzymaj', bookmarks: 'Zakładki',
    history: 'Historia', settings: 'Ustawienia',
    search: 'Szukaj lub wpisz URL', aiSearch: 'Zapytaj AI...',
    secureConn: 'Bezpieczne połączenie (TLS 1.3)', insecureConn: 'Niezabezpieczone',
    phishingWarn: 'Ostrzeżenie: możliwy phishing!',
    readingMode: 'Tryb czytania', translate: 'Przetłumacz',
    share: 'Udostępnij', defaultBrowser: 'Ustaw jako domyślną przeglądarkę',
    passwords: 'Hasła', language: 'Język', theme: 'Motyw',
    close: 'Zamknij', cancel: 'Anuluj', save: 'Zapisz', ok: 'OK',
    error: 'Błąd', loading: 'Ładowanie...', noResults: 'Brak wyników',
    disclaimer: 'kriptoentuzijasti.io nie ma dostępu do Twoich haseł.',
  },
};

const LANGUAGE_NAMES = {
  hr: 'Hrvatski', en: 'English', de: 'Deutsch', fr: 'Français',
  es: 'Español', it: 'Italiano', pt: 'Português', ru: 'Русский',
  bs: 'Bosanski', sr: 'Srpski', sl: 'Slovenščina', tr: 'Türkçe', pl: 'Polski',
};

let _instance = null;

class I18nManager {
  constructor() {
    this._lang = 'hr';
  }

  static getInstance() {
    if (!_instance) _instance = new I18nManager();
    return _instance;
  }

  setLanguage(lang) {
    if (STRINGS[lang]) this._lang = lang;
    else this._lang = 'en';
  }

  getStrings(lang) {
    const l = lang || this._lang;
    // Merge with English as fallback for missing keys
    return { ...STRINGS['en'], ...(STRINGS[l] || {}) };
  }

  t(key, lang) {
    const strings = this.getStrings(lang || this._lang);
    return strings[key] || key;
  }

  getAvailableLanguages() {
    return Object.entries(LANGUAGE_NAMES).map(([code, name]) => ({ code, name }));
  }
}

module.exports = I18nManager;
