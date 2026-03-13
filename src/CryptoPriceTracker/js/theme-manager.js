// by SoKo for kriptoentuzijasti.io
// last update: March 4, 2026

class ThemeManager {
    constructor() {
        this.init();
    }

    init() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        this.setTheme(savedTheme);
        this.createThemeToggle();
    }

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        this.updateToggleSwitch(theme);
    }

    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        this.setTheme(newTheme);
    }

    createThemeToggle() {
        const existingToggle = document.querySelector('.theme-toggle');
        const existingSwitchContainer = document.querySelector('.theme-switch-container');
        if (existingToggle) {
            existingToggle.remove();
        }
        if (existingSwitchContainer) {
            existingSwitchContainer.remove();
        }

        const toggleContainer = document.createElement('div');
        toggleContainer.className = 'theme-switch-container';
        toggleContainer.title = 'Toggle Dark/Light Mode';

        const switchElement = document.createElement('label');
        switchElement.className = 'theme-switch';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.addEventListener('change', () => this.toggleTheme());

        const slider = document.createElement('span');
        slider.className = 'theme-slider';

        const lightIcon = document.createElement('span');
        lightIcon.className = 'light-icon';
        lightIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 100 100" fill="currentColor">
            <circle cx="50" cy="50" r="20" fill="orange" />

            <line x1="50" y1="0" x2="50" y2="15" stroke="orange" stroke-width="3"/>
            <line x1="50" y1="100" x2="50" y2="85" stroke="orange" stroke-width="3"/>
            <line x1="0" y1="50" x2="15" y2="50" stroke="orange" stroke-width="3"/>
            <line x1="100" y1="50" x2="85" y2="50" stroke="orange" stroke-width="3"/>
            
            <line x1="20" y1="20" x2="30" y2="30" stroke="orange" stroke-width="3"/>
            <line x1="80" y1="20" x2="70" y2="30" stroke="orange" stroke-width="3"/>
            <line x1="20" y1="80" x2="30" y2="70" stroke="orange" stroke-width="3"/>
            <line x1="80" y1="80" x2="70" y2="70" stroke="orange" stroke-width="3"/>
        </svg>`;

        const moonIcon = document.createElement('span');
        moonIcon.className = 'moon-icon';
        moonIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21 12.79A9 9 0 1111.21 3a7 7 0 109.79 9.79z"/>
        </svg>`;

        slider.appendChild(lightIcon);
        slider.appendChild(moonIcon);
        switchElement.appendChild(checkbox);
        switchElement.appendChild(slider);
        toggleContainer.appendChild(switchElement);

        const footerContainer = document.querySelector('#theme-toggle-container');
        if (footerContainer) {
            footerContainer.appendChild(toggleContainer);
        } else {
            document.body.appendChild(toggleContainer);
        }

        const currentTheme = document.documentElement.getAttribute('data-theme');
        this.updateToggleSwitch(currentTheme);
    }

    updateToggleSwitch(theme) {
        const checkbox = document.querySelector('.theme-switch input[type="checkbox"]');
        if (checkbox) {
            checkbox.checked = theme === 'dark';
        }
    }
}

document.addEventListener('DOMContentLoaded', function() {
    new ThemeManager();
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        new ThemeManager();
    });
} else {
    new ThemeManager();
}