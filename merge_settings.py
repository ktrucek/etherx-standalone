#!/usr/bin/env python3
"""
Script za merge-anje novih settings sekcija iz settings.html u index.html
"""
import re
from pathlib import Path

# Putanje
SETTINGS_HTML = Path("/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser/src/renderer/settings.html")
INDEX_HTML = Path("/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser/src/index.html")
OUTPUT_HTML = Path("/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser/src/index_new.html")

# Lista sekcija za ekstraktirati iz settings.html
NEW_SECTIONS = [
    "history",
    "cookies", 
    "permissions",
    "shortcuts",
    "cache",
    "dns",
    "updates",
    "backup"
]

def extract_section_from_settings(html_content, section_id):
    """Ekstraktira HTML sekciju iz settings.html"""
    # Traži section sa id="section-{section_id}"
    pattern = rf'<section[^>]+id="section-{section_id}"[^>]*>(.*?)</section>'
    match = re.search(pattern, html_content, re.DOTALL)
    if match:
        return match.group(1)
    return None

def convert_to_stab_format(section_content, section_id):
    """Konvertuje settings.html format u index.html s-tab-pane format"""
    # Settings.html ima .settings-group, .settings-row format
    # Index.html ima .s-group, .s-row format
    
    content = section_content
    
    # Replace class names
    content = content.replace('class="settings-group"', 'class="s-group"')
    content = content.replace('class="settings-group-title"', 'class="s-group-title"')
    content = content.replace('class="settings-row"', 'class="s-row"')
    content = content.replace('class="settings-row-icon"', 'class="s-row-icon"')
    content = content.replace('class="settings-row-text"', 'class="s-row-text"')
    content = content.replace('class="settings-row-label"', 'class="s-row-label"')
    content = content.replace('class="settings-row-desc"', 'class="s-row-desc"')
    
    # Wrap u s-tab-pane div
    wrapped = f'          <div class="s-tab-pane" id="stab-{section_id}">\n'
    wrapped += content
    wrapped += '\n          </div>\n'
    
    return wrapped

def main():
    print("🔄 Čitam settings.html...")
    settings_content = SETTINGS_HTML.read_text(encoding='utf-8')
    
    print("🔄 Čitam index.html...")
    index_content = INDEX_HTML.read_text(encoding='utf-8')
    
    # Find insertion point - prije zatvaranja settings-body diva (prije </div></div></div>)
    # Traži kraj AI taba
    ai_tab_end_pattern = r'(</div>\s*</div>\s*</div>\s*<!-- Settings body -->)'
    
    # Ili traži closing tag settings-body
    insertion_pattern = r'(\s*</div>\s*</div>\s*</div>\s*<!-- WALLET PANEL -->)'
    
    print("🔍 Tražim insertion point...")
    
    # Lakši pristup - traži gdje se završava AI tab
    # Nalazi se prije zatvaranja settings-body
    ai_section_end = index_content.find('</div>\n\n        </div>\n      </div>')
    
    if ai_section_end == -1:
        print("❌ Ne mogu naći kraj AI sekcije")
        return
    
    print(f"✓ Pronađen insertion point na poziciji {ai_section_end}")
    
    # Ekstrahujem nove sekcije iz settings.html
    new_sections_html = ""
    
    for section_id in NEW_SECTIONS:
        print(f"📝 Ekstrahujem {section_id}...")
        section_content = extract_section_from_settings(settings_content, section_id)
        
        if section_content:
            converted = convert_to_stab_format(section_content, section_id)
            new_sections_html += converted + "\n"
            print(f"  ✓ {section_id} ekstrahovan")
        else:
            print(f"  ⚠️  {section_id} nije pronađen u settings.html")
    
    # Insert nove sekcije prije kraja
    before = index_content[:ai_section_end]
    after = index_content[ai_section_end:]
    
    new_content = before + "\n" + new_sections_html + after
    
    # Zapiši novi file
    OUTPUT_HTML.write_text(new_content, encoding='utf-8')
    
    print(f"\n✅ Gotovo! Novi file: {OUTPUT_HTML}")
    print(f"   Dodano {len(NEW_SECTIONS)} novih sekcija")
    print("\nPregled izmjena:")
    print(f"   Stari: {len(index_content):,} karaktera")
    print(f"   Novi:  {len(new_content):,} karaktera")
    print(f"   Diff:  +{len(new_content) - len(index_content):,} karaktera")

if __name__ == "__main__":
    main()
