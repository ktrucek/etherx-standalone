document.getElementById('openDashboardBtn')?.addEventListener('click', async () => {
  const dashboardUrl = chrome.runtime.getURL('index.html');
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs && tabs[0];
    if (activeTab && typeof activeTab.id === 'number') {
      await chrome.tabs.update(activeTab.id, { url: dashboardUrl });
    } else {
      await chrome.tabs.create({ url: dashboardUrl });
    }
    window.close();
  } catch (error) {
    console.error('[LiveOS Plugin] open dashboard failed:', error);
  }
});
