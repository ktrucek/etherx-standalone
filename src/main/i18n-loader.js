/**
 * EtherX Browser — i18n Loader & Language Switcher
 * Copyright © 2024–2026 kriptoentuzijasti.io. All Rights Reserved.
 * PROPRIETARY AND CONFIDENTIAL — See LICENSE file.
 * 
 * Loads and merges translations from i18n.js and i18n-extended.js
 * Provides dynamic language switching functionality
 */

'use strict';

// Current language (default: Croatian)
let currentLanguage = localStorage.getItem('etherx_language') || 'hr';

// Merged translations object
let ALL_STRINGS = {};

/**
 * Load and merge all translation strings
 */
function loadTranslations() {
  // Merge base STRINGS with EXTENDED_STRINGS
  const languages = ['hr', 'en', 'de', 'it', 'fr', 'es'];
  
  languages.forEach(lang => {
    ALL_STRINGS[lang] = {};
    
    // Merge base strings (if available)
    if (typeof STRINGS !== 'undefined' && STRINGS[lang]) {
      Object.assign(ALL_STRINGS[lang], STRINGS[lang]);
    }
    
    // Merge extended strings (menu bar & settings)
    if (typeof EXTENDED_STRINGS !== 'undefined' && EXTENDED_STRINGS[lang]) {
      Object.assign(ALL_STRINGS[lang], EXTENDED_STRINGS[lang]);
    }
  });
  
  console.log('[i18n] Translations loaded for:', Object.keys(ALL_STRINGS).join(', '));
}

/**
 * Get translated string by key
 * @param {string} key - Translation key
 * @param {string} lang - Language code (optional, uses currentLanguage)
 * @returns {string} Translated string
 */
function t(key, lang = null) {
  const targetLang = lang || currentLanguage;
  return ALL_STRINGS[targetLang]?.[key] || ALL_STRINGS['en']?.[key] || key;
}

/**
 * Get current language
 * @returns {string} Current language code
 */
function getCurrentLanguage() {
  return currentLanguage;
}

/**
 * Set current language and update UI
 * @param {string} lang - Language code (hr, en, de, it, fr, es)
 */
function setLanguage(lang) {
  if (!ALL_STRINGS[lang]) {
    console.error(`[i18n] Language '${lang}' not supported`);
    return;
  }
  
  currentLanguage = lang;
  localStorage.setItem('etherx_language', lang);
  
  // Update all elements with data-i18n attribute
  translatePage();
  
  console.log(`[i18n] Language changed to: ${lang}`);
  
  // Dispatch custom event
  window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang } }));
}

/**
 * Translate all elements on page with data-i18n attribute
 */
function translatePage() {
  // Translate elements with data-i18n
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translation = t(key);
    
    // Update text content or specific attribute
    if (el.hasAttribute('data-i18n-attr')) {
      const attr = el.getAttribute('data-i18n-attr');
      el.setAttribute(attr, translation);
    } else {
      el.textContent = translation;
    }
  });
  
  // Translate elements with data-i18n-placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });
  
  // Translate elements with data-i18n-title
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key);
  });
}

/**
 * Get available languages
 * @returns {Array} Array of {code, name} objects
 */
function getAvailableLanguages() {
  return [
    { code: 'hr', name: 'Hrvatski', flag: '🇭🇷' },
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'it', name: 'Italiano', flag: '🇮🇹' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
  ];
}

/**
 * Create language selector dropdown
 * @param {HTMLElement} container - Container element to append selector
 */
function createLanguageSelector(container) {
  const languages = getAvailableLanguages();
  const currentLang = languages.find(l => l.code === currentLanguage) || languages[0];
  
  const selector = document.createElement('div');
  selector.className = 'language-selector';
  selector.style.cssText = 'position:relative;display:inline-block;';
  
  const button = document.createElement('button');
  button.className = 'language-selector-btn';
  button.style.cssText = 'background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:6px 12px;color:var(--text);cursor:pointer;font-size:13px;display:flex;align-items:center;gap:6px;';
  button.innerHTML = `${currentLang.flag} <span id="currentLangName">${currentLang.name}</span> ▾`;
  
  const dropdown = document.createElement('div');
  dropdown.className = 'language-dropdown';
  dropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;margin-top:4px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);min-width:180px;z-index:10000;';
  
  languages.forEach(lang => {
    const item = document.createElement('div');
    item.className = 'language-dropdown-item';
    item.style.cssText = 'padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;transition:background .15s;';
    item.innerHTML = `<span style="font-size:18px">${lang.flag}</span><span>${lang.name}</span>`;
    
    if (lang.code === currentLanguage) {
      item.style.background = 'var(--bg3)';
      item.style.fontWeight = '600';
    }
    
    item.addEventListener('mouseenter', () => {
      item.style.background = 'var(--bg3)';
    });
    
    item.addEventListener('mouseleave', () => {
      if (lang.code !== currentLanguage) {
        item.style.background = '';
      }
    });
    
    item.addEventListener('click', () => {
      setLanguage(lang.code);
      dropdown.style.display = 'none';
      button.innerHTML = `${lang.flag} <span id="currentLangName">${lang.name}</span> ▾`;
    });
    
    dropdown.appendChild(item);
  });
  
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  });
  
  document.addEventListener('click', () => {
    dropdown.style.display = 'none';
  });
  
  selector.appendChild(button);
  selector.appendChild(dropdown);
  container.appendChild(selector);
}

/**
 * Initialize i18n system
 * Call this on page load
 */
function initI18n() {
  loadTranslations();
  
  // Auto-translate page after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', translatePage);
  } else {
    translatePage();
  }
}

// Auto-initialize if translations are already loaded
if (typeof STRINGS !== 'undefined' || typeof EXTENDED_STRINGS !== 'undefined') {
  initI18n();
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    t,
    getCurrentLanguage,
    setLanguage,
    translatePage,
    getAvailableLanguages,
    createLanguageSelector,
    initI18n
  };
}

// Global access
window.i18n = {
  t,
  getCurrentLanguage,
  setLanguage,
  translatePage,
  getAvailableLanguages,
  createLanguageSelector,
  initI18n
};
