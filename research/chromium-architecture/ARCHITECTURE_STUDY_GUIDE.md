# Chromium Architecture Study Guide for EtherX Browser

## Overview
This guide provides a structured approach to understanding Chromium's architecture
before building EtherX Browser.

## 1. Multi-Process Architecture

### 1.1 Browser Process
- **Purpose**: Main process, manages UI and coordinates other processes
- **Key Responsibilities**:
  - Window management
  - Tab management
  - Network requests
  - File system access
  - User input handling
- **Study Resources**:
  - Code: `chrome/browser/`
  - Docs: `research/chromium-architecture/notes/multi-process-architecture.html`

### 1.2 Renderer Process
- **Purpose**: One per tab, renders web content in isolation
- **Key Responsibilities**:
  - HTML/CSS parsing (Blink)
  - JavaScript execution (V8)
  - DOM tree construction
  - Layout and painting
- **Security**: Sandboxed, limited system access
- **Study Resources**:
  - Code: `content/renderer/`
  - Docs: Multi-process architecture doc

### 1.3 GPU Process
- **Purpose**: Handles GPU operations for multiple renderers
- **Key Responsibilities**:
  - WebGL rendering
  - Video decoding
  - Compositor operations
- **Study Resources**:
  - Code: `content/gpu/`

### 1.4 Plugin Process
- **Purpose**: Runs plugin code (PPAPI, deprecated Flash)
- **Security**: Isolated from browser and renderer
- **Note**: Less relevant for modern browsers

### 1.5 Utility Processes
- **Purpose**: Isolated services for specific tasks
- **Examples**:
  - Audio service
  - Network service
  - Storage service
  - Device service

## 2. Inter-Process Communication (IPC)

### 2.1 Mojo
- Modern IPC system replacing legacy Chrome IPC
- Interface Definition Language (IDL) based
- Type-safe message passing
- **Study**: `mojo/public/`

### 2.2 Legacy Chrome IPC
- Still used in some areas
- Message-based communication
- **Study**: `ipc/`

### 2.3 Key IPC Patterns
```
Browser Process <---> Renderer Process
   |                      |
   |-- RenderViewHost ------ RenderView
   |-- RenderFrameHost ----- RenderFrame
   |-- WebContents
```

## 3. Core Components

### 3.1 Blink Rendering Engine
- **Location**: `third_party/blink/`
- **Components**:
  - HTML Parser: `third_party/blink/renderer/core/html/parser/`
  - CSS Parser: `third_party/blink/renderer/core/css/parser/`
  - Layout: `third_party/blink/renderer/core/layout/`
  - Paint: `third_party/blink/renderer/core/paint/`
  - DOM: `third_party/blink/renderer/core/dom/`

**Study Path**:
1. Understand HTML parsing and tokenization
2. Study CSS cascade and specificity
3. Learn layout tree construction (LayoutNG)
4. Understand paint and compositing

### 3.2 V8 JavaScript Engine
- **Location**: `v8/`
- **Key Concepts**:
  - Just-In-Time (JIT) compilation
  - Garbage collection (Scavenger, Mark-Sweep)
  - Hidden classes for optimization
  - Inline caching

**Study Resources**:
- Official V8 docs: https://v8.dev/docs
- V8 blog: https://v8.dev/blog
- Embedding V8: https://v8.dev/docs/embed

### 3.3 Content API
- **Location**: `content/`
- **Purpose**: Stable API for embedding Chromium
- **Key Classes**:
  - `ContentMainDelegate`: Entry point
  - `ContentBrowserClient`: Browser process customization
  - `ContentRendererClient`: Renderer process customization
  - `WebContents`: Represents a web page
  - `RenderFrameHost`: Represents a frame in browser process
  - `RenderFrame`: Represents a frame in renderer process

**Study Path**:
1. Read `content/README.md`
2. Study `content/public/` interfaces
3. Examine `content/shell/` as reference implementation

### 3.4 UI Framework (Views)
- **Location**: `ui/views/`
- **Purpose**: Cross-platform UI toolkit
- **Key Concepts**:
  - Widget: Top-level window
  - View: UI element (button, label, etc.)
  - Layout managers
  - Event handling

## 4. Chromium-Based Projects Study

### 4.1 Electron
- **Architecture**: Node.js + Chromium
- **Processes**:
  - Main process (Node.js + Browser)
  - Renderer process (Node.js + Renderer)
- **Study**:
  - Clone: `git clone https://github.com/electron/electron`
  - Read: https://www.electronjs.org/docs/latest/

**Pros for EtherX**:
- Easy to get started
- JavaScript/TypeScript development
- Large ecosystem

**Cons**:
- Less control over Chromium internals
- Larger binary size
- Performance overhead from Node.js

### 4.2 CEF (Chromium Embedded Framework)
- **Architecture**: C++ wrapper around Content API
- **Key Interfaces**:
  - `CefApp`: Application entry point
  - `CefClient`: Client callbacks
  - `CefBrowser`: Browser instance
  - `CefFrame`: Frame within browser

**Study Steps**:
1. Download CEF: https://cef-builds.spotifycdn.com/index.html
2. Build cefclient example
3. Study `tests/cefclient/` source code
4. Review CefSchemeHandlerFactory for custom protocols

**Pros for EtherX**:
- Full control over Chromium
- C++ performance
- Custom protocol support (for etherx:// URLs)

**Cons**:
- Steeper learning curve
- More complex build process

### 4.3 Brave Browser
- **Study**: https://github.com/brave/brave-browser
- **Key Features**:
  - Ad blocking
  - Cryptocurrency wallet
  - Tor integration
- **Lessons**: Similar to EtherX goals (privacy, Web3)

### 4.4 Vivaldi Browser
- **Study**: Closed source, but study UI/UX patterns
- **Key Features**: Advanced tab management, customization

## 5. Study Exercises

### Exercise 1: Build Content Shell
```bash
cd ~/chromium/src
autoninja -C out/Default content_shell
out/Default/content_shell --no-sandbox
```
**Goal**: Understand minimal Chromium embedding

### Exercise 2: Build CEF Simple Example
```bash
cd ~/cef
./cef_create_projects.sh
cd build
cmake -G "Ninja" ..
ninja cefsimple
./tests/cefsimple/Release/cefsimple
```
**Goal**: Understand CEF basics

### Exercise 3: Trace IPC Messages
```bash
# Enable IPC logging
out/Default/chrome --enable-logging --v=1 --vmodule=ipc_*=1
```
**Goal**: Understand IPC communication

### Exercise 4: Modify Content Shell
- Add a button to content_shell toolbar
- Handle button click to navigate to a URL
- Goal: Understand UI integration

## 6. Key Code Paths to Study

### Page Load Sequence
```
1. User enters URL in address bar
2. Browser process: NavigationController::LoadURL()
3. Browser process: RenderFrameHost::Navigate()
4. IPC to Renderer: FrameMsg_Navigate
5. Renderer process: RenderFrameImpl::OnNavigate()
6. Renderer: Start network request (via Browser)
7. Renderer: Receive HTML, parse, build DOM
8. Renderer: Layout tree construction
9. Renderer: Paint and composite
10. GPU process: Display on screen
```

### JavaScript Execution
```
1. HTML parser encounters <script>
2. Blink creates ScriptLoader
3. Load JavaScript (inline or external)
4. V8: Compile JavaScript
5. V8: Execute in context
6. If DOM API called: Blink C++ bindings invoked
```

## 7. Recommended Study Order

**Week 1-2**: Multi-Process Architecture
- Read all multi-process docs
- Build and run content_shell
- Trace process creation

**Week 3-4**: Content API
- Study `content/public/` interfaces
- Read content_shell source code
- Build minimal Content API app

**Week 5-6**: Blink and Rendering
- Study HTML/CSS parsing
- Understand layout tree
- Learn paint and compositing

**Week 7-8**: V8 and JavaScript
- Learn V8 embedding
- Study JavaScript-C++ bindings
- Create custom V8 extensions

**Week 9-10**: CEF or Electron
- Choose framework for EtherX
- Build example applications
- Study advanced features

## 8. Resources

### Official Documentation
- Chromium Design Docs: https://www.chromium.org/developers/design-documents/
- Chromium Blog: https://blog.chromium.org/
- Blink Docs: https://www.chromium.org/blink/
- V8 Docs: https://v8.dev/docs

### Books
- "Inside Chromium" (if available)
- "Learning V8" online resources

### Videos
- BlinkOn conference talks: https://www.youtube.com/c/GoogleChromeDevelopers
- Chrome University videos

### Communities
- Chromium-dev mailing list
- #chromium on Freenode IRC
- Stack Overflow chromium tag

## 9. Next Steps

After completing this study guide:
1. ✅ Complete Phase 1.1 checklist in TODO.md
2. → Move to Phase 1.2: Development Environment Setup
3. → Begin Phase 2: Building EtherX MVP

## Notes
- Keep a research journal documenting learnings
- Create code snippets for reference
- Build small proof-of-concept applications
