# Chromium Quick Reference Cheat Sheet

## Process Types
| Process | Purpose | Sandboxed | Code Location |
|---------|---------|-----------|---------------|
| Browser | Main UI, coordinates others | No | `chrome/browser/` |
| Renderer | Renders web pages | Yes | `content/renderer/` |
| GPU | Graphics operations | Yes | `content/gpu/` |
| Plugin | Plugin code (deprecated) | Yes | `content/plugin/` |
| Utility | Various services | Yes | `content/utility/` |

## Key Classes

### Browser Process
```cpp
// Represents a browser window
class Browser;

// Represents a tab's content
class WebContents;

// Browser-side representation of a frame
class RenderFrameHost;

// Manages navigation
class NavigationController;

// Profile data (bookmarks, history, etc.)
class Profile;
```

### Renderer Process
```cpp
// Renderer-side representation of a frame
class RenderFrame;

// Blink's main frame class
class WebLocalFrame;

// JavaScript context
class v8::Context;
```

## IPC Messages

### Sending from Browser to Renderer
```cpp
// In browser process
RenderFrameHost* rfh = ...;
rfh->GetRemoteFrame()->Navigate(url);
```

### Sending from Renderer to Browser
```cpp
// In renderer process
GetContentClient()->renderer()->RunScriptsAtDocumentStart(this);
```

## Content API Entry Points

### Creating a Content API App
```cpp
class MyMainDelegate : public content::ContentMainDelegate {
 public:
  bool BasicStartupComplete(int* exit_code) override;
  
  content::ContentBrowserClient* CreateContentBrowserClient() override {
    browser_client_ = std::make_unique<MyBrowserClient>();
    return browser_client_.get();
  }
};

int main(int argc, const char** argv) {
  MyMainDelegate delegate;
  content::ContentMainParams params(&delegate);
  return content::ContentMain(params);
}
```

## CEF Key Interfaces

### Application Setup
```cpp
// 1. Initialize CEF
CefMainArgs args(argc, argv);
CefRefPtr<MyApp> app(new MyApp);
CefInitialize(args, settings, app, nullptr);

// 2. Create browser
CefWindowInfo window_info;
CefBrowserSettings browser_settings;
CefBrowserHost::CreateBrowser(window_info, client, url, browser_settings, nullptr, nullptr);

// 3. Run message loop
CefRunMessageLoop();

// 4. Cleanup
CefShutdown();
```

### Handling Page Loads
```cpp
class MyLoadHandler : public CefLoadHandler {
  void OnLoadStart(CefRefPtr<CefBrowser> browser,
                   CefRefPtr<CefFrame> frame,
                   TransitionType transition_type) override {
    // Page load started
  }
  
  void OnLoadEnd(CefRefPtr<CefBrowser> browser,
                 CefRefPtr<CefFrame> frame,
                 int httpStatusCode) override {
    // Page load complete
  }
};
```

## Build System (GN)

### Common Build Targets
```bash
# Content shell (minimal browser)
autoninja -C out/Default content_shell

# Full Chrome
autoninja -C out/Default chrome

# Unit tests
autoninja -C out/Default unit_tests

# Browser tests
autoninja -C out/Default browser_tests
```

### Build Configuration (args.gn)
```gn
is_debug = false           # Release build
is_component_build = true  # Faster linking
symbol_level = 1           # Some symbols for debugging
enable_nacl = false        # Disable NaCl
target_cpu = "x64"         # Architecture
```

## Debugging

### Enable Logging
```bash
chrome --enable-logging --v=1
```

### Specific Module Logging
```bash
chrome --vmodule=render_frame_impl=1,navigation_controller=1
```

### Remote Debugging
```bash
chrome --remote-debugging-port=9222
```

### GDB Debugging
```bash
gdb out/Default/chrome
(gdb) run --no-sandbox
```

## Useful Chrome Flags
| Flag | Description |
|------|-------------|
| `--no-sandbox` | Disable sandbox (development only!) |
| `--disable-gpu` | Disable GPU acceleration |
| `--single-process` | Run in single process (for debugging) |
| `--enable-features=...` | Enable experimental features |
| `--disable-features=...` | Disable features |
| `--user-data-dir=...` | Custom profile directory |
| `--remote-debugging-port=9222` | Enable DevTools Protocol |

## Chrome URLs (chrome://)
- `chrome://version` - Version info
- `chrome://flags` - Experimental features
- `chrome://gpu` - GPU information
- `chrome://net-internals` - Network debugging
- `chrome://tracing` - Performance tracing
- `chrome://extensions` - Installed extensions

## Blink APIs

### DOM Manipulation
```cpp
// In renderer process
blink::WebDocument document = frame->GetDocument();
blink::WebElement body = document.Body();
body.SetAttribute("class", "my-class");
```

### JavaScript Execution
```cpp
frame->ExecuteScript(blink::WebString::FromUTF8(
    "console.log('Hello from C++!')"));
```

## V8 APIs

### Creating JavaScript Context
```cpp
v8::Isolate* isolate = v8::Isolate::GetCurrent();
v8::HandleScope handle_scope(isolate);
v8::Local<v8::Context> context = v8::Context::New(isolate);
v8::Context::Scope context_scope(context);
```

### Exposing C++ Function to JavaScript
```cpp
void MyFunction(const v8::FunctionCallbackInfo<v8::Value>& args) {
  v8::Isolate* isolate = args.GetIsolate();
  args.GetReturnValue().Set(v8::String::NewFromUtf8(isolate, "Hello"));
}

// Register
v8::Local<v8::ObjectTemplate> global = v8::ObjectTemplate::New(isolate);
global->Set(v8::String::NewFromUtf8(isolate, "myFunction"),
            v8::FunctionTemplate::New(isolate, MyFunction));
```

## File Locations

### Important Directories
```
chromium/src/
├── chrome/           - Chrome browser
├── content/          - Content API
│   ├── browser/      - Browser process
│   ├── renderer/     - Renderer process
│   ├── common/       - Shared code
│   └── public/       - Public Content API
├── components/       - Shared components
├── ui/               - UI framework
│   └── views/        - Views toolkit
├── third_party/
│   ├── blink/        - Rendering engine
│   └── WebKit/       - (legacy)
├── v8/               - JavaScript engine
├── net/              - Network stack
├── base/             - Base libraries
└── out/              - Build output
```

## Common Patterns

### Singleton Pattern
```cpp
// Many Chromium classes use singleton
MyService* service = MyService::GetInstance();
```

### Observer Pattern
```cpp
class MyObserver : public content::WebContentsObserver {
 public:
  void DidFinishLoad(content::RenderFrameHost* rfh, const GURL& url) override;
};
```

### Task Posting
```cpp
content::GetUIThreadTaskRunner({})->PostTask(
    FROM_HERE,
    base::BindOnce(&MyFunction, param1, param2));
```
