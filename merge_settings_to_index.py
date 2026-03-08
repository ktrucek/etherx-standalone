#!/usr/bin/env python3
"""
Merge settings.html sections into index.html
Extracts nav items and section content from settings.html and injects into index.html
"""
import re
from pathlib import Path

# Paths
settings_html = Path('src/renderer/settings.html')
index_html = Path('src/index.html')
standalone_index_html = Path('standalone-browser/src/index.html')

# Read settings.html
settings_content = settings_html.read_text(encoding='utf-8')

# Extract nav items (History, Cookies, etc.)
nav_pattern = r'<div class="nav-item"[^>]*data-section="([^"]+)"[^>]*>\s*<span class="nav-item-icon">([^<]+)</span>\s*<span class="nav-item-text">([^<]+)</span>'
nav_items = re.findall(nav_pattern, settings_content)

print(f"Found {len(nav_items)} nav items in settings.html:")
for section_id, icon, text in nav_items:
    print(f"  - {icon} {text} ({section_id})")

# Extract section content for each nav item
sections = {}
for section_id, icon, text in nav_items:
    # Find section HTML
    section_pattern = rf'<div class="settings-section"[^>]*id="{section_id}"[^>]*>(.*?)</div>\s*</div>\s*<!-- Settings body -->'
    match = re.search(section_pattern, settings_content, re.DOTALL)
    if match:
        sections[section_id] = {
            'icon': icon,
            'text': text,
            'html': match.group(1).strip()
        }
        print(f"✓ Extracted content for {section_id}")
    else:
        print(f"✗ Could not extract content for {section_id}")

# Now inject into index.html
index_content = index_html.read_text(encoding='utf-8')

# 1. Add tab buttons after existing tabs
tab_insert_pattern = r'(<button class="sit-btn" data-stab="ai"><span class="sit-icon">🤖</span>AI</button>)'
new_tabs = []

# Map section IDs to stab- IDs and Croatian names
section_mapping = {
    'history': ('povijest', 'Povijest'),
    'cookies': ('kolacici', 'Kolačići'),
    'permissions': ('dozvole', 'Dozvole'),
    'shortcuts': ('precaci', 'Prečaci'),
    'cache': ('predmemorija', 'Predmemorija'),
    'dns': ('dns', 'DNS'),
    'updates': ('azuriranja', 'Ažuriranja'),
    'backup': ('backup', 'Backup')
}

for section_id, (stab_id, hr_name) in section_mapping.items():
    if section_id in sections:
        icon = sections[section_id]['icon']
        new_tabs.append(f'          <button class="sit-btn" data-stab="{stab_id}"><span class="sit-icon">{icon}</span>{hr_name}</button>')

if new_tabs:
    tabs_replacement = r'\1\n' + '\n'.join(new_tabs)
    index_content = re.sub(tab_insert_pattern, tabs_replacement, index_content)
    print(f"\n✓ Added {len(new_tabs)} tab buttons")

# 2. Add tab panes before closing of settings-body
# Find the closing tags of AI tab pane and settings-body
ai_close_pattern = r'(</div>\s*<!-- ── AI Settings ── -->)\s*(</div>\s*<!-- Settings body -->)'

new_panes = []
for section_id, (stab_id, hr_name) in section_mapping.items():
    if section_id in sections:
        # Convert settings.html structure to index.html structure
        # settings.html uses .settings-section, index.html uses .s-tab-pane
        section_html = sections[section_id]['html']
        
        # Replace class names
        section_html = section_html.replace('settings-group', 's-group')
        section_html = section_html.replace('settings-group-title', 's-group-title')
        section_html = section_html.replace('settings-row', 's-row')
        section_html = section_html.replace('settings-row-icon', 's-row-icon')
        section_html = section_html.replace('settings-row-text', 's-row-text')
        section_html = section_html.replace('settings-row-label', 's-row-label')
        section_html = section_html.replace('settings-row-desc', 's-row-desc')
        
        pane = f'''
          <!-- {hr_name.upper()} -->
          <div class="s-tab-pane" id="stab-{stab_id}">
{section_html}
          </div>
'''
        new_panes.append(pane)

if new_panes:
    panes_replacement = r'\1\n' + '\n'.join(new_panes) + r'\n        \2'
    index_content = re.sub(ai_close_pattern, panes_replacement, index_content, flags=re.DOTALL)
    print(f"✓ Added {len(new_panes)} tab panes")

# 3. Extract JavaScript handlers from settings.html
js_pattern = r'<script>\s*(.*?)\s*</script>'
js_matches = re.findall(js_pattern, settings_content, re.DOTALL)
if js_matches:
    js_code = js_matches[-1]  # Last script block
    
    # Extract event listeners for new sections
    handler_sections = []
    for section_id in section_mapping.keys():
        # Find handlers for this section
        handler_pattern = rf'// ── {section_id.title()}.*?(?=// ──|\Z)'
        handler_match = re.search(handler_pattern, js_code, re.DOTALL | re.IGNORECASE)
        if handler_match:
            handler_sections.append(handler_match.group(0).strip())
    
    if handler_sections:
        # Find where to insert in index.html (before closing script tag)
        script_insert_pattern = r'(\s*)\}\)\(\);\s*</script>\s*</body>'
        handlers_code = '\n\n      // ══════════════════════════════════════════════════════════════════════════\n'
        handlers_code += '      // NEW SETTINGS SECTIONS HANDLERS\n'
        handlers_code += '      // ══════════════════════════════════════════════════════════════════════════\n\n'
        handlers_code += '\n\n'.join(handler_sections)
        
        replacement = handlers_code + r'\1})();\n  </script>\n</body>'
        index_content = re.sub(script_insert_pattern, replacement, index_content)
        print(f"✓ Added JavaScript handlers for new sections")

# Write updated index.html
index_html.write_text(index_content, encoding='utf-8')
print(f"\n✓ Updated {index_html}")

# Copy to standalone
standalone_index_html.write_text(index_content, encoding='utf-8')
print(f"✓ Copied to {standalone_index_html}")

print("\n✅ Done! New settings sections merged into index.html")
