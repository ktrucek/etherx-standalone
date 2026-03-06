import React, { useRef, useState, useEffect } from 'react';
import {
    SafeAreaView,
    StyleSheet,
    TextInput,
    View,
    TouchableOpacity,
    Text,
    StatusBar,
    Platform,
    Dimensions,
    ScrollView,
    FlatList,
} from 'react-native';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';

const INITIAL_URL = 'https://n8n.kriptoentuzijasti.io/browser.html';

export default function App() {
    const webViewRef = useRef(null);
    const [url, setUrl] = useState(INITIAL_URL);
    const [currentUrl, setCurrentUrl] = useState(INITIAL_URL);
    const [canGoBack, setCanGoBack] = useState(false);
    const [canGoForward, setCanGoForward] = useState(false);
    const [loading, setLoading] = useState(false);
    const [tabs, setTabs] = useState([{ id: 1, url: INITIAL_URL, title: 'EtherX Browser' }]);
    const [activeTabId, setActiveTabId] = useState(1);

    // Inject JavaScript bridge for localStorage and Web3
    const injectedJavaScript = `
    (function() {
      // Mark as EtherX Mobile
      window.ETHERX_MOBILE = true;
      window.ETHERX_PLATFORM = '${Platform.OS}';
      window.ETHERX_VERSION = '1.0.0';

      // Override localStorage to use React Native AsyncStorage
      const originalSetItem = localStorage.setItem;
      const originalGetItem = localStorage.getItem;
      const originalRemoveItem = localStorage.removeItem;

      localStorage.setItem = function(key, value) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'localStorage',
          action: 'setItem',
          key: key,
          value: value
        }));
        return originalSetItem.call(this, key, value);
      };

      // Inject Web3 provider (Ethereum)
      window.ethereum = {
        isMetaMask: true,
        isEtherX: true,
        request: async ({ method, params }) => {
          return new Promise((resolve, reject) => {
            const requestId = 'web3_' + Date.now() + '_' + Math.random();
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'web3',
              requestId: requestId,
              method: method,
              params: params
            }));
            
            // Timeout after 30 seconds
            setTimeout(() => reject(new Error('Request timeout')), 30000);
          });
        },
        on: (event, callback) => {
          console.log('EtherX: Ethereum event listener registered:', event);
        }
      };

      // Notify React Native that page is ready
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'ready',
        userAgent: navigator.userAgent
      }));

      console.log('EtherX Mobile Bridge initialized');
    })();
    true;
  `;

    const handleMessage = async (event) => {
        try {
            const data = JSON.parse(event.nativeEvent.data);

            if (data.type === 'localStorage') {
                if (data.action === 'setItem') {
                    await AsyncStorage.setItem(data.key, data.value);
                } else if (data.action === 'getItem') {
                    const value = await AsyncStorage.getItem(data.key);
                    webViewRef.current?.injectJavaScript(`
            (function() {
              const event = new CustomEvent('storageReply', { 
                detail: { key: '${data.key}', value: ${JSON.stringify(value)} }
              });
              window.dispatchEvent(event);
            })();
          `);
                }
            } else if (data.type === 'web3') {
                // Handle Web3 requests - implement wallet integration here
                console.log('Web3 request:', data.method, data.params);
            } else if (data.type === 'ready') {
                console.log('WebView ready:', data.userAgent);
            }
        } catch (e) {
            console.error('Message handling error:', e);
        }
    };

    const navigateTo = (newUrl) => {
        let finalUrl = newUrl.trim();

        // Add https:// if no protocol
        if (!finalUrl.match(/^https?:\/\//)) {
            if (finalUrl.includes('.')) {
                finalUrl = 'https://' + finalUrl;
            } else {
                // Search query
                finalUrl = 'https://www.google.com/search?q=' + encodeURIComponent(finalUrl);
            }
        }

        setUrl(finalUrl);
        setCurrentUrl(finalUrl);

        // Update active tab
        setTabs(prevTabs => prevTabs.map(tab =>
            tab.id === activeTabId ? { ...tab, url: finalUrl } : tab
        ));
    };

    const createNewTab = () => {
        const newTab = {
            id: Date.now(),
            url: INITIAL_URL,
            title: 'New Tab'
        };
        setTabs([...tabs, newTab]);
        setActiveTabId(newTab.id);
        setUrl(INITIAL_URL);
    };

    const closeTab = (tabId) => {
        if (tabs.length === 1) return; // Don't close last tab

        const newTabs = tabs.filter(tab => tab.id !== tabId);
        setTabs(newTabs);

        if (activeTabId === tabId) {
            setActiveTabId(newTabs[newTabs.length - 1].id);
        }
    };

    const activeTab = tabs.find(tab => tab.id === activeTabId);

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor="#0d0d1a" />

            {/* Tabs Bar */}
            <View style={styles.tabsBar}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {tabs.map(tab => (
                        <TouchableOpacity
                            key={tab.id}
                            style={[
                                styles.tab,
                                activeTabId === tab.id && styles.activeTab
                            ]}
                            onPress={() => setActiveTabId(tab.id)}
                        >
                            <Text style={styles.tabTitle} numberOfLines={1}>
                                {tab.title}
                            </Text>
                            {tabs.length > 1 && (
                                <TouchableOpacity
                                    onPress={() => closeTab(tab.id)}
                                    style={styles.tabClose}
                                >
                                    <Text style={styles.tabCloseText}>×</Text>
                                </TouchableOpacity>
                            )}
                        </TouchableOpacity>
                    ))}
                </ScrollView>
                <TouchableOpacity style={styles.newTabBtn} onPress={createNewTab}>
                    <Text style={styles.newTabText}>+</Text>
                </TouchableOpacity>
            </View>

            {/* URL Bar */}
            <View style={styles.urlBar}>
                <TouchableOpacity
                    style={[styles.navBtn, !canGoBack && styles.navBtnDisabled]}
                    onPress={() => webViewRef.current?.goBack()}
                    disabled={!canGoBack}
                >
                    <Text style={styles.navBtnText}>←</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.navBtn, !canGoForward && styles.navBtnDisabled]}
                    onPress={() => webViewRef.current?.goForward()}
                    disabled={!canGoForward}
                >
                    <Text style={styles.navBtnText}>→</Text>
                </TouchableOpacity>

                <TextInput
                    style={styles.urlInput}
                    value={url}
                    onChangeText={setUrl}
                    onSubmitEditing={() => navigateTo(url)}
                    placeholder="Search or enter URL..."
                    placeholderTextColor="#666"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="go"
                />

                <TouchableOpacity
                    style={styles.navBtn}
                    onPress={() => webViewRef.current?.reload()}
                >
                    <Text style={styles.navBtnText}>{loading ? '×' : '↻'}</Text>
                </TouchableOpacity>
            </View>

            {/* Loading Bar */}
            {loading && (
                <View style={styles.loadingBar}>
                    <View style={[styles.loadingProgress, { width: '60%' }]} />
                </View>
            )}

            {/* WebView */}
            <WebView
                ref={webViewRef}
                source={{ uri: activeTab?.url || INITIAL_URL }}
                injectedJavaScript={injectedJavaScript}
                onMessage={handleMessage}
                onNavigationStateChange={(navState) => {
                    setCanGoBack(navState.canGoBack);
                    setCanGoForward(navState.canGoForward);
                    setCurrentUrl(navState.url);
                    setLoading(navState.loading);

                    // Update tab title
                    setTabs(prevTabs => prevTabs.map(tab =>
                        tab.id === activeTabId
                            ? { ...tab, title: navState.title || 'Loading...', url: navState.url }
                            : tab
                    ));
                }}
                onLoadStart={() => setLoading(true)}
                onLoadEnd={() => setLoading(false)}
                javaScriptEnabled={true}
                domStorageEnabled={true}
                allowsInlineMediaPlayback={true}
                mediaPlaybackRequiresUserAction={false}
                allowFileAccess={true}
                allowUniversalAccessFromFileURLs={true}
                mixedContentMode="always"
                style={styles.webview}
                userAgent="Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 EtherXMobile/1.0"
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0d0d1a',
    },
    tabsBar: {
        flexDirection: 'row',
        backgroundColor: '#16213e',
        borderBottomWidth: 1,
        borderBottomColor: '#2a2a3e',
        height: 40,
    },
    tab: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: '#1a1a2e',
        marginRight: 4,
        borderRadius: 8,
        minWidth: 120,
        maxWidth: 180,
    },
    activeTab: {
        backgroundColor: '#252535',
        borderBottomWidth: 2,
        borderBottomColor: '#667eea',
    },
    tabTitle: {
        flex: 1,
        color: '#e0e0e0',
        fontSize: 12,
    },
    tabClose: {
        marginLeft: 8,
        padding: 2,
    },
    tabCloseText: {
        color: '#aaa',
        fontSize: 18,
        fontWeight: 'bold',
    },
    newTabBtn: {
        width: 40,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#252535',
        borderRadius: 8,
        marginLeft: 4,
        marginRight: 8,
    },
    newTabText: {
        color: '#667eea',
        fontSize: 20,
        fontWeight: 'bold',
    },
    urlBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1a1a2e',
        paddingHorizontal: 8,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#2a2a3e',
    },
    navBtn: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#252535',
        borderRadius: 8,
        marginRight: 6,
    },
    navBtnDisabled: {
        opacity: 0.3,
    },
    navBtnText: {
        fontSize: 18,
        color: '#e0e0e0',
        fontWeight: 'bold',
    },
    urlInput: {
        flex: 1,
        height: 40,
        backgroundColor: '#252535',
        borderRadius: 8,
        paddingHorizontal: 12,
        color: '#e0e0e0',
        fontSize: 14,
    },
    loadingBar: {
        height: 2,
        backgroundColor: '#2a2a3e',
    },
    loadingProgress: {
        height: '100%',
        backgroundColor: '#667eea',
    },
    webview: {
        flex: 1,
        backgroundColor: '#0d0d1a',
    },
});
