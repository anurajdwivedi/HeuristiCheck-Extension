// 1. GLOBAL GUARD
if (!window.heuristicListenerAttached) {
  window.heuristicListenerAttached = true;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "ping") {
      sendResponse({ status: "alive" });
      return true;
    }

    if (
      request.action === "updateTheme" &&
      window.HeuristicNavigator &&
      window.HeuristicNavigator.instance
    ) {
      window.HeuristicNavigator.instance.updateTheme(request.theme);
      return true;
    }

    if (request.action === "analyze") {
      try {
        if (typeof window.clearOverlays === "function") window.clearOverlays();
        const results = window.runFullAudit
          ? window.runFullAudit(request.settings || {})
          : [];

        const highlightedElements = Array.from(
          document.querySelectorAll(".heuristic-highlight")
        );
        if (highlightedElements.length > 0 && window.HeuristicNavigator) {
          window.HeuristicNavigator.instance = new window.HeuristicNavigator(
            highlightedElements,
            request.apiKey,
            request.aiProvider,
            request.theme,
            request.aiModel
          );
        }
        sendResponse({ results: results, url: window.location.href });
      } catch (e) {
        console.error("Error:", e);
        sendResponse({ error: e.message });
      }
    }
    return true;
  });
}

if (typeof window.runFullAudit === "undefined") {
  window.clearOverlays = function () {
    document.querySelectorAll(".heuristic-highlight").forEach((el) => {
      el.style.border = "";
      el.style.boxShadow = "";
      el.style.zIndex = "";
      el.style.position = "";
      el.classList.remove("heuristic-highlight");
      el.classList.remove("heuristic-focus-target");
      delete el.dataset.heuristicIssue;
      delete el.dataset.heuristicSeverity;
      delete el.dataset.heuristicMeta;
      delete el.dataset.originalPosition;
      delete el.dataset.originalZIndex;
    });
    document
      .querySelectorAll(
        ".heuristic-label, .heuristic-tooltip, .heuristic-dot, .heuristic-dot-tooltip, #heuristic-navigator-widget, #heuristic-spotlight, #heuristic-focus-style, #heuristic-heatmap-container"
      )
      .forEach((el) => el.remove());
    document.getElementById("heuristic-theme-style")?.remove();

    if (
      window.HeuristicNavigator &&
      window.HeuristicNavigator.repositionSpotlight
    ) {
      window.removeEventListener(
        "scroll",
        window.HeuristicNavigator.repositionSpotlight
      );
      window.removeEventListener(
        "resize",
        window.HeuristicNavigator.repositionSpotlight
      );
      document.removeEventListener(
        "keydown",
        window.HeuristicNavigator.handleKeys
      );
    }
  };

  // IMAGE HELPER
  async function urlToBase64(url) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      return null;
    }
  }

  window.HeuristicNavigator = class HeuristicNavigator {
    constructor(elements, apiKey, aiProvider, theme, aiModel) {
      this.elements = elements;
      this.apiKey = apiKey;
      this.aiProvider = aiProvider || "openai";
      this.aiModel = aiModel || "gpt-3.5-turbo";
      this.theme = theme || "dark";
      this.currentIndex = -1;
      this.isFocusMode = false;
      this.isHeatmapMode = false;

      this.injectThemeCSS();
      this.createWidget();
      this.makeDraggable();

      this.handleScroll = () => {
        this.updateSpotlightPosition();
        if (this.isHeatmapMode) this.renderHeatmapDots();
      };
      this.handleKeys = this.handleKeydown.bind(this);

      window.HeuristicNavigator.repositionSpotlight = this.handleScroll;
      window.HeuristicNavigator.handleKeys = this.handleKeys;

      window.addEventListener("scroll", this.handleScroll, { passive: true });
      window.addEventListener("resize", this.handleScroll, { passive: true });
      document.addEventListener("keydown", this.handleKeys);

      this.updateTheme(this.theme);
    }

    injectThemeCSS() {
      const css = `
        /* === WIDGET THEME ENGINE === */
        #heuristic-navigator-widget {
          /* Default Dark Mode */
          --widget-bg: #1E293B;
          --widget-text: #F8FAFC;
          --widget-border: #334155;
          --btn-bg: #334155;
          --btn-text: #F8FAFC;
          --btn-hover: #475569;
          --code-bg: #0F172A; 
          --code-text: #4ADE80;
          --shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.1);
        }

        /* PREMIUM LIGHT MODE OVERRIDES */
        #heuristic-navigator-widget[data-theme="light"] {
          --widget-bg: #FFFFFF;
          --widget-text: #0F172A;
          --widget-border: #E2E8F0;
          --btn-bg: #F1F5F9;
          --btn-text: #334155;
          --btn-hover: #E2E8F0;
          --code-bg: #1E293B;
          --code-text: #86EFAC;
          --shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }

        /* AI SECTION STYLING */
        .ai-section-label { 
            font-size: 10px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; display: block;
        }
        .ai-section-text { 
            font-size: 13px; line-height: 1.5; color: var(--widget-text); margin-bottom: 12px; 
        }
        
        .ai-highlight-error { color: #EF4444; } 
        .ai-highlight-fix { color: #10B981; }   

        #heuristic-navigator-widget[data-theme="light"] .ai-highlight-error { color: #DC2626; }
        #heuristic-navigator-widget[data-theme="light"] .ai-highlight-fix { color: #059669; }

        /* CODE BLOCK STYLING */
        .ai-code-block { 
            display: block; background: var(--code-bg); 
            padding: 12px; border-radius: 8px; 
            font-family: 'Menlo', 'Monaco', monospace; margin-top: 8px; 
            white-space: pre-wrap; word-break: break-word; 
            color: var(--code-text); font-size: 12px; 
            border: 1px solid rgba(255,255,255,0.1);
            box-shadow: inset 0 2px 4px 0 rgba(0,0,0,0.2);
            cursor: pointer; position: relative;
        }
        .ai-code-block:hover { filter: brightness(1.1); }
        .ai-code-block::after {
            content: "Click to Copy"; position: absolute; top: 4px; right: 8px;
            font-size: 9px; opacity: 0.5; color: #fff;
        }
        .ai-inline-code { background: rgba(255,255,255,0.15); padding: 2px 4px; border-radius: 3px; color: #FCD34D; }

        /* TOOLTIPS */
        .heuristic-dot-tooltip { 
            display: none; 
            position: absolute; 
            background: #0F172A; 
            color: white; 
            padding: 6px 10px; 
            border-radius: 6px; 
            font-size: 11px; 
            font-weight: 600; 
            white-space: nowrap; 
            z-index: 2147483647; 
            pointer-events: none; 
            box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); 
            opacity: 0; 
            transition: opacity 0.1s; 
            /* Default Position: Above Center */
            bottom: 24px; 
            left: 50%; 
            transform: translateX(-50%); 
        }
        .heuristic-dot:hover .heuristic-dot-tooltip { opacity: 1; display: block; }
        
        /* SMART TOOLTIP POSITIONING CLASSES */
        .tooltip-down { bottom: auto !important; top: 24px !important; }
        .tooltip-left { left: 0 !important; transform: none !important; }
        .tooltip-right { left: auto !important; right: 0 !important; transform: none !important; }

        /* SCROLLBAR */
        #nav-ai-content { max-height: 240px; overflow-y: auto; padding-right: 8px; }
        #nav-ai-content::-webkit-scrollbar { width: 4px; }
        #nav-ai-content::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.5); border-radius: 2px; }
        `;
      const style = document.createElement("style");
      style.id = "heuristic-theme-style";
      style.textContent = css;
      document.head.appendChild(style);
    }
    updateTheme(newTheme) {
      this.theme = newTheme;
      const widget = document.getElementById("heuristic-navigator-widget");
      if (widget) widget.setAttribute("data-theme", newTheme);
    }

    get icons() {
      return {
        prev: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`,
        next: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`,
        eye: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
        trash: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
        close: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
        copy: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
        check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#27ae60" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,

        magic: `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="magic-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
              <stop offset="0" stop-color="#C084FC"/> 
              <stop offset="1" stop-color="#F472B6"/> 
            </linearGradient>
          </defs>
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" stroke="none" />
          
          <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" 
          stroke="url(#magic-grad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="url(#magic-grad)" fill-opacity="0.2"/>
        </svg>`,

        heatmap: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`,
      };
    }

    createWidget() {
      const widget = document.createElement("div");
      widget.id = "heuristic-navigator-widget";
      widget.innerHTML = `
        <div id="nav-header" style="cursor: move; padding-bottom:10px; margin-bottom:10px; border-bottom:1px solid var(--widget-border); display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:6px;"><strong style="font-size:14px; color:var(--widget-text); font-weight:700;">HeuristiCheck</strong></div>
          <div style="font-size:12px; color:var(--widget-text); opacity:0.7; font-weight:500; background:var(--btn-bg); padding:2px 8px; border-radius:12px;"><span id="nav-counter">0</span> / <span id="nav-total">${this.elements.length}</span></div>
        </div>
        <div id="nav-context" style="margin-bottom:10px; display:flex; align-items:center; gap:8px;">
          <span id="nav-severity" style="font-size:10px; font-weight:700; padding:3px 8px; border-radius:4px; background:var(--btn-bg); color:var(--widget-text); letter-spacing:0.5px; text-transform:uppercase;">PENDING</span>
          <span id="nav-issue" style="font-size:13px; font-weight:600; color:var(--widget-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">Select issue...</span>
        </div>
        <div id="nav-code-container" style="background:var(--code-bg); border:1px solid var(--widget-border); border-radius:6px; margin-bottom:12px; padding:6px 10px; display:flex; align-items:center; justify-content:space-between;">
          <div id="nav-code-text" title="Click to Log" style="font-family:'Menlo', 'Monaco', monospace; font-size:11px; color:var(--code-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; flex-grow:1; margin-right:8px;">&lt;Start&gt;</div>
          <div style="display:flex; gap:4px; align-items:center;">
               <button id="nav-ai-btn" title="Ask AI for Fix" style="${this.toolBtnStyle}">${this.icons.magic}</button>
               <div style="width:1px; height:14px; background:var(--widget-border); margin:0 2px;"></div>
               <button id="nav-copy-btn" title="Copy Selector" style="${this.toolBtnStyle}">${this.icons.copy}</button>
          </div>
        </div>
        <div id="nav-ai-container" style="display:none; position:relative; padding:10px; border-radius:6px; margin-bottom:12px; border:1px solid var(--widget-border); background:var(--btn-bg);">
           <button id="nav-ai-close-btn" title="Dismiss" style="position:absolute; top:2px; right:4px; background:transparent; border:none; color:var(--widget-text); cursor:pointer; font-size:16px; line-height:1;">&times;</button>
           <div id="nav-ai-content" style="font-size:12px; line-height:1.4; color:var(--widget-text);"></div>
        </div>
        <div style="display:flex; gap:8px; justify-content:space-between;">
          <div style="display:flex; gap:4px; background:var(--btn-bg); padding:4px; border-radius:6px;">
            <button id="nav-prev" title="Prev" style="${this.navBtnStyle}">${this.icons.prev}</button>
            <button id="nav-next" title="Next" style="${this.navBtnStyle}">${this.icons.next}</button>
          </div>
          <div style="display:flex; gap:6px;">
             <button id="nav-heatmap" title="Heatmap" style="${this.actionBtnStyle}; color:#10B981; background:rgba(16,185,129,0.1); border-color:rgba(16,185,129,0.2);">${this.icons.heatmap}</button>
             <button id="nav-focus" title="Focus Mode" style="${this.actionBtnStyle}; color:#8B5CF6; background:rgba(139,92,246,0.1); border-color:rgba(139,92,246,0.2);">${this.icons.eye}</button>
             <button id="nav-dismiss" title="Dismiss" style="${this.actionBtnStyle}; color:#F59E0B; background:rgba(245,158,11,0.1); border-color:rgba(245,158,11,0.2);">${this.icons.trash}</button>
             <button id="nav-close" title="Close" style="${this.actionBtnStyle}; color:#EF4444; background:rgba(239,68,68,0.1); border-color:rgba(239,68,68,0.2);">${this.icons.close}</button>
          </div>
        </div>
      `;
      Object.assign(widget.style, {
        position: "fixed",
        bottom: "20px",
        right: "20px",
        width: "320px",
        minWidth: "280px",
        maxWidth: "600px",
        minHeight: "160px",
        maxHeight: "80vh",
        backgroundColor: "var(--widget-bg)",
        color: "var(--widget-text)",
        padding: "16px",
        borderRadius: "12px",
        boxShadow: "var(--shadow)",
        zIndex: "2147483647",
        fontFamily: '"Segoe UI", Roboto, sans-serif',
        border: "1px solid var(--widget-border)",
        transition: "opacity 0.2s",
        resize: "both",
        overflow: "auto",
      });
      document.body.appendChild(widget);

      const spotlight = document.createElement("div");
      spotlight.id = "heuristic-spotlight";
      Object.assign(spotlight.style, {
        position: "fixed",
        top: "-9999px",
        left: "-9999px",
        width: "0",
        height: "0",
        boxShadow: "0 0 0 5000px rgba(0, 0, 0, 0.75)",
        zIndex: "2147483640",
        pointerEvents: "none",
        borderRadius: "4px",
        transition: "all 0.2s ease-out",
        display: "none",
      });
      document.body.appendChild(spotlight);

      const heatmapContainer = document.createElement("div");
      heatmapContainer.id = "heuristic-heatmap-container";
      Object.assign(heatmapContainer.style, {
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: "2147483640",
        display: "none",
        backgroundColor: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(2px)",
      });
      document.body.appendChild(heatmapContainer);

      const style = document.createElement("style");
      style.id = "heuristic-focus-style";
      style.innerHTML = `
          .heuristic-focus-target { position: relative !important; z-index: 2147483645 !important; box-shadow: 0 0 0 4px #fff, 0 0 50px rgba(0,0,0,0.5) !important; transition: all 0.3s ease; }
          #nav-copy-btn:hover, #nav-ai-btn:hover, #nav-ai-close-btn:hover { background: var(--widget-border) !important; opacity: 0.8; }
          #heuristic-navigator-widget button:hover { filter: brightness(0.95); transform: translateY(-1px); }
          #nav-code-text:hover { text-decoration: underline; }
          .heuristic-dot { position: absolute; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); cursor: pointer; pointer-events: auto; z-index: 2147483642; transform: translate(-50%, -50%); transition: transform 0.2s; }
          .heuristic-dot:hover { transform: translate(-50%, -50%) scale(1.5); z-index: 2147483643; }
          .dot-high { background: #DC2626; box-shadow: 0 0 10px #DC2626; }
          .dot-med { background: #EA580C; box-shadow: 0 0 10px #EA580C; }
          .dot-low { background: #0369A1; box-shadow: 0 0 10px #0369A1; }
      `;
      document.head.appendChild(style);

      document
        .getElementById("nav-next")
        .addEventListener("click", () => this.next());
      document
        .getElementById("nav-prev")
        .addEventListener("click", () => this.prev());
      document
        .getElementById("nav-close")
        .addEventListener("click", () => window.clearOverlays());
      document
        .getElementById("nav-dismiss")
        .addEventListener("click", () => this.dismissCurrent());
      document
        .getElementById("nav-focus")
        .addEventListener("click", () => this.toggleFocusMode());
      document
        .getElementById("nav-heatmap")
        .addEventListener("click", () => this.toggleHeatmapMode());
      document
        .getElementById("nav-ai-close-btn")
        .addEventListener("click", () => {
          document.getElementById("nav-ai-container").style.display = "none";
        });

      document.getElementById("nav-copy-btn").addEventListener("click", () => {
        if (this.currentIndex >= 0 && this.elements[this.currentIndex]) {
          const el = this.elements[this.currentIndex];
          let selector = el.tagName.toLowerCase();
          if (el.id) selector += `#${el.id}`;
          if (el.className && typeof el.className === "string") {
            const cls = el.className
              .replace("heuristic-highlight", "")
              .replace("heuristic-focus-target", "")
              .trim()
              .split(" ")[0];
            if (cls) selector += `.${cls}`;
          }
          navigator.clipboard.writeText(selector).then(() => {
            const btn = document.getElementById("nav-copy-btn");
            const orig = btn.innerHTML;
            btn.innerHTML = this.icons.check;
            setTimeout(() => {
              btn.innerHTML = orig;
            }, 1000);
          });
        }
      });

      document.getElementById("nav-code-text").addEventListener("click", () => {
        if (this.currentIndex >= 0 && this.elements[this.currentIndex]) {
          const el = this.elements[this.currentIndex];
          console.log(
            "%c[HeuristiCheck Target]",
            "color:#00ff00; font-weight:bold; font-size:12px;",
            el
          );

          const textEl = document.getElementById("nav-code-text");
          const oldText = textEl.innerText;
          textEl.innerText = "Logged to Console!";
          textEl.style.color = "var(--primary)";
          setTimeout(() => {
            textEl.innerText = oldText;
            textEl.style.color = "var(--code-text)";
          }, 800);
        }
      });

      // --- ENHANCED AI LOGIC ---
      document
        .getElementById("nav-ai-btn")
        .addEventListener("click", async () => {
          if (this.currentIndex < 0) return;
          const aiContainer = document.getElementById("nav-ai-container");
          const aiContent = document.getElementById("nav-ai-content");
          aiContainer.style.display = "block";
          if (!this.apiKey) {
            aiContent.innerHTML =
              "⚠️ <strong>Missing Key</strong><br>Check Settings.";
            return;
          }
          aiContent.innerHTML = `✨ Analyzing with ${this.aiModel}...`;

          const el = this.elements[this.currentIndex];
          const issue = el.dataset.heuristicIssue;

          // --- GATHER CONTEXT ---
          const computed = window.getComputedStyle(el);
          const metaData = el.dataset.heuristicMeta
            ? JSON.parse(el.dataset.heuristicMeta)
            : {};

          const contextData = {
            tagName: el.tagName,
            id: el.id,
            classList: el.className.replace("heuristic-highlight", "").trim(),
            textPreview: el.innerText.substring(0, 50) + "...",
            styles: {
              color: computed.color,
              backgroundColor: computed.backgroundColor,
              fontSize: computed.fontSize,
              display: computed.display,
              position: computed.position,
              width: computed.width,
              height: computed.height,
            },
            meta: metaData,
          };

          const isImage = el.tagName === "IMG";
          let imageBase64 = null;

          if (isImage && el.src) {
            aiContent.innerHTML = `✨ Downloading image...`;
            imageBase64 = await urlToBase64(el.src);
          }

          // --- STRICT FORMAT PROMPT ---
          const basePrompt = `
            You are a Senior Frontend & UX Engineer.
            
            Context:
            - Element: ${contextData.tagName.toLowerCase()}
            - Issue: "${issue}"
            - Current Styles: ${JSON.stringify(contextData.styles)}
            - Metadata: ${JSON.stringify(contextData.meta)}
            - HTML: ${el.outerHTML.substring(0, 300)}
            
            Task:
            1. Start with "❌ **Error:**" and explain what is wrong in 1 sentence (max 15 words).
            2. New line. Start with "✅ **Fix:**" and explain what to do in 1 sentence (max 15 words).
            3. Provide the specific CSS/HTML code fix.
            
            Output format Example:
            ❌ **Error:** The text contrast is too low (2.5:1).
            ✅ **Fix:** Darken the text color to #333333.
            \`\`\`css
            selector { color: #333333; }
            \`\`\`
          `;

          try {
            let reply = "";
            // GEMINI
            if (this.aiProvider === "gemini") {
              const model = isImage ? "gemini-1.5-flash" : "gemini-pro";
              const contents = [{ parts: [{ text: basePrompt }] }];

              if (isImage && imageBase64) {
                const base64Data = imageBase64.split(",")[1];
                const mimeType = imageBase64.split(";")[0].split(":")[1];
                contents[0].parts.push({
                  inline_data: { mime_type: mimeType, data: base64Data },
                });
              }

              const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ contents }),
                }
              );
              const data = await response.json();
              if (data.error) throw new Error(data.error.message);
              reply = data.candidates[0].content.parts[0].text;
            }
            // OPENAI
            else {
              const modelToUse =
                this.aiModel || (isImage ? "gpt-4o-mini" : "gpt-3.5-turbo");

              let messages = [];
              if (isImage && imageBase64) {
                messages = [
                  {
                    role: "user",
                    content: [
                      { type: "text", text: basePrompt },
                      { type: "image_url", image_url: { url: imageBase64 } },
                    ],
                  },
                ];
              } else {
                messages = [{ role: "user", content: basePrompt }];
              }

              const response = await fetch(
                "https://api.openai.com/v1/chat/completions",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.apiKey}`,
                  },
                  body: JSON.stringify({
                    model: modelToUse,
                    messages: messages,
                    max_tokens: 300,
                  }),
                }
              );
              const data = await response.json();
              if (data.error) throw new Error(data.error.message);
              reply = data.choices[0].message.content;
            }

            aiContent.innerHTML = this.formatAIResponse(reply);

            document.querySelectorAll(".ai-code-block").forEach((block) => {
              block.title = "Click to Copy Code";
              block.onclick = function () {
                navigator.clipboard.writeText(this.innerText);
                const orig = this.style.backgroundColor;
                this.style.backgroundColor = "rgba(74, 222, 128, 0.2)";
                setTimeout(() => (this.style.backgroundColor = orig), 200);
              };
            });
          } catch (error) {
            aiContent.innerHTML = `❌ ${error.message}`;
          }
        });
    }

    // --- UPDATED RESPONSE FORMATTER ---
    formatAIResponse(text) {
      let html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      // Format Code Blocks
      html = html.replace(
        /```([\s\S]*?)```/g,
        '<div class="ai-code-block">$1</div>'
      );

      // Format Inline Code
      html = html.replace(
        /`([^`]+)`/g,
        '<span class="ai-inline-code">$1</span>'
      );

      // Format "Error:" Section (Red)
      html = html.replace(
        /❌ \*\*Error:\*\*(.*?)(?=\n|$)/g,
        '<div class="ai-section-label ai-highlight-error">Problem</div><div class="ai-section-text">$1</div>'
      );

      // Format "Fix:" Section (Green)
      html = html.replace(
        /✅ \*\*Fix:\*\*(.*?)(?=\n|$)/g,
        '<div class="ai-section-label ai-highlight-fix">Suggestion</div><div class="ai-section-text">$1</div>'
      );

      return `<div>${html}</div>`;
    }

    get navBtnStyle() {
      return `background: var(--btn-bg); color: var(--btn-text); border: 1px solid var(--widget-border); padding: 8px 12px; border-radius: 8px; cursor: pointer; display:flex; align-items:center; justify-content:center; transition: all 0.2s; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05);`;
    }
    get actionBtnStyle() {
      return `padding: 8px; border-radius: 8px; cursor: pointer; display:flex; align-items:center; justify-content:center; transition: all 0.2s; border: 1px solid transparent;`;
    }
    get toolBtnStyle() {
      return `background: transparent; border: none; cursor: pointer; padding: 6px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: background 0.2s; color: var(--widget-text); opacity: 0.8;`;
    }

    handleKeydown(e) {
      if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName))
        return;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          this.next();
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          this.prev();
          break;
        case "f":
        case "F":
          e.preventDefault();
          this.toggleFocusMode();
          break;
        case "h":
        case "H":
          e.preventDefault();
          this.toggleHeatmapMode();
          break;
        case "d":
        case "D":
        case "Backspace":
        case "Delete":
          e.preventDefault();
          this.dismissCurrent();
          break;
        case "Escape":
          if (this.isFocusMode) this.toggleFocusMode();
          if (this.isHeatmapMode) this.toggleHeatmapMode();
          break;
      }
    }
    toggleHeatmapMode() {
      this.isHeatmapMode = !this.isHeatmapMode;
      const container = document.getElementById("heuristic-heatmap-container");
      const btn = document.getElementById("nav-heatmap");
      if (this.isHeatmapMode) {
        container.style.display = "block";
        btn.style.background = "#059669";
        btn.style.color = "#fff";
        this.renderHeatmapDots();
        if (this.isFocusMode) this.toggleFocusMode();
      } else {
        container.style.display = "none";
        btn.style.background = "rgba(16,185,129,0.1)";
        btn.style.color = "#059669";
      }
    }

    renderHeatmapDots() {
      const container = document.getElementById("heuristic-heatmap-container");
      container.innerHTML = "";
      this.elements.forEach((el, index) => {
        if (el.getBoundingClientRect) {
          const rect = el.getBoundingClientRect();
          const dot = document.createElement("div");
          const sev = el.dataset.heuristicSeverity;
          const issue = el.dataset.heuristicIssue;

          // Position calculations
          const top = rect.top + rect.height / 2;
          const left = rect.left + rect.width / 2;

          // Edge detection for tooltip
          let tooltipClasses = "heuristic-dot-tooltip";
          if (top < 100) tooltipClasses += " tooltip-down"; // Close to top, flip down
          if (left < 100) tooltipClasses += " tooltip-left"; // Close to left, align left
          if (left > window.innerWidth - 100)
            tooltipClasses += " tooltip-right"; // Close to right, align right

          dot.className = `heuristic-dot ${
            sev === "High"
              ? "dot-high"
              : sev === "Medium"
              ? "dot-med"
              : "dot-low"
          }`;
          dot.innerHTML = `<div class="${tooltipClasses}">${sev}: ${issue}</div>`;

          dot.style.left = `${left}px`;
          dot.style.top = `${top}px`;

          dot.addEventListener("click", (e) => {
            e.stopPropagation();
            this.currentIndex = index;
            this.scrollToCurrent();
            this.toggleHeatmapMode();
          });
          container.appendChild(dot);
        }
      });
    }

    toggleFocusMode() {
      this.isFocusMode = !this.isFocusMode;
      const spotlight = document.getElementById("heuristic-spotlight");
      const btn = document.getElementById("nav-focus");
      if (this.isFocusMode) {
        spotlight.style.display = "block";
        btn.style.background = "#8B5CF6";
        btn.style.color = "#fff";
        if (this.currentIndex >= 0) this.updateSpotlightPosition();
        if (this.isHeatmapMode) this.toggleHeatmapMode();
      } else {
        spotlight.style.display = "none";
        btn.style.background = "rgba(139,92,246,0.1)";
        btn.style.color = "#8B5CF6";
      }
    }
    updateSpotlightPosition() {
      if (!this.isFocusMode || this.currentIndex === -1) return;
      const el = this.elements[this.currentIndex];
      const spotlight = document.getElementById("heuristic-spotlight");
      if (el && spotlight) {
        const rect = el.getBoundingClientRect();
        spotlight.style.top = `${rect.top - 4}px`;
        spotlight.style.left = `${rect.left - 4}px`;
        spotlight.style.width = `${rect.width + 8}px`;
        spotlight.style.height = `${rect.height + 8}px`;
      }
    }
    dismissCurrent() {
      if (this.currentIndex === -1 || this.elements.length === 0) return;
      const el = this.elements[this.currentIndex];
      el.style.border = "";
      el.style.boxShadow = "";
      el.classList.remove("heuristic-highlight");
      this.elements.splice(this.currentIndex, 1);
      document.getElementById("nav-total").innerText = this.elements.length;
      document.getElementById("nav-ai-container").style.display = "none";
      if (this.elements.length === 0) {
        document.getElementById("nav-context").innerHTML =
          "<span>All Clean!</span>";
        document.getElementById("heuristic-spotlight").style.display = "none";
        this.currentIndex = -1;
      } else {
        if (this.currentIndex >= this.elements.length) this.currentIndex = 0;
        this.scrollToCurrent();
      }
    }
    updateUI(element) {
      document.getElementById("nav-counter").innerText = this.currentIndex + 1;
      document.getElementById("nav-ai-container").style.display = "none";
      const severity = element.dataset.heuristicSeverity || "INFO";
      const issueName = element.dataset.heuristicIssue || "General Issue";
      const sevBadge = document.getElementById("nav-severity");
      sevBadge.innerText = severity;
      if (severity === "High") {
        sevBadge.style.backgroundColor = "var(--fail-bg)";
        sevBadge.style.color = "var(--fail-text)";
      } else if (severity === "Medium") {
        sevBadge.style.backgroundColor = "#FFF7ED";
        sevBadge.style.color = "#C2410C";
      } else {
        sevBadge.style.backgroundColor = "var(--pass-bg)";
        sevBadge.style.color = "var(--pass-text)";
      }
      const issueEl = document.getElementById("nav-issue");
      issueEl.innerText = issueName;
      issueEl.title = issueName;
      const tagName = element.tagName.toLowerCase();
      const id = element.id ? `#${element.id}` : "";
      let className = element.className;
      if (typeof className === "string") {
        className = className
          .replace("heuristic-highlight", "")
          .replace("heuristic-focus-target", "")
          .trim();
        className = className ? `.${className.split(" ")[0]}` : "";
      } else {
        className = "";
      }
      document.getElementById(
        "nav-code-text"
      ).innerText = `<${tagName}${id}${className}>`;
    }
    scrollToCurrent() {
      const el = this.elements[this.currentIndex];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const originalBorder = el.style.border;
        el.style.border = "4px solid #fff";
        setTimeout(() => {
          el.style.border = originalBorder;
        }, 400);
        this.updateUI(el);
        if (this.isFocusMode) {
          setTimeout(() => this.updateSpotlightPosition(), 100);
          setTimeout(() => this.updateSpotlightPosition(), 300);
        }
      }
    }
    next() {
      if (this.elements.length === 0) return;
      this.currentIndex = (this.currentIndex + 1) % this.elements.length;
      this.scrollToCurrent();
    }
    prev() {
      if (this.elements.length === 0) return;
      this.currentIndex =
        (this.currentIndex - 1 + this.elements.length) % this.elements.length;
      this.scrollToCurrent();
    }
    makeDraggable() {
      const elmnt = document.getElementById("heuristic-navigator-widget");
      const header = document.getElementById("nav-header");
      let pos1 = 0,
        pos2 = 0,
        pos3 = 0,
        pos4 = 0;
      header.onmousedown = (e) => {
        e = e || window.event;
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = () => {
          document.onmouseup = null;
          document.onmousemove = null;
          elmnt.style.opacity = "1";
        };
        document.onmousemove = (e) => {
          e = e || window.event;
          e.preventDefault();
          pos1 = pos3 - e.clientX;
          pos2 = pos4 - e.clientY;
          pos3 = e.clientX;
          pos4 = e.clientY;
          elmnt.style.top = elmnt.offsetTop - pos2 + "px";
          elmnt.style.left = elmnt.offsetLeft - pos1 + "px";
          elmnt.style.bottom = "auto";
          elmnt.style.right = "auto";
        };
        elmnt.style.opacity = "0.9";
      };
    }
  };

  window.highlightElement = function (
    element,
    severity,
    labelText,
    helpfulTip
  ) {
    if (element && element.getBoundingClientRect && element.style) {
      const rect = element.getBoundingClientRect();
      let color = "#0369A1";
      if (severity === "High") color = "#DC2626";
      if (severity === "Medium") color = "#EA580C";
      element.classList.add("heuristic-highlight");
      element.style.border = `3px solid ${color}`;
      element.style.boxShadow = `0 0 8px ${color}`;
      element.dataset.heuristicIssue = labelText;
      element.dataset.heuristicSeverity = severity;
    }
  };
  window.getRGB = function (str) {
    const match = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return match
      ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) }
      : null;
  };
  window.getLuminance = function (r, g, b) {
    const a = [r, g, b].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  };
  window.getRealBackgroundColor = function (element) {
    let current = element;
    while (current) {
      const style = window.getComputedStyle(current);
      const bg = style.backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent")
        return window.getRGB(bg);
      current = current.parentElement;
    }
    return { r: 255, g: 255, b: 255 };
  };
  window.checkContrast = function (element) {
    const style = window.getComputedStyle(element);
    if (
      style.opacity === "0" ||
      style.visibility === "hidden" ||
      style.display === "none"
    )
      return false;
    const fg = window.getRGB(style.color);
    const bg = window.getRealBackgroundColor(element);
    if (fg && bg) {
      const lum1 = window.getLuminance(fg.r, fg.g, fg.b);
      const lum2 = window.getLuminance(bg.r, bg.g, bg.b);
      const ratio =
        (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);

      if (ratio < 3.0) {
        element.dataset.heuristicMeta = JSON.stringify({
          fgColor: style.color,
          bgColor: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
          currentRatio: ratio.toFixed(2),
        });
        return true;
      }
    }
    return false;
  };

  window.runFullAudit = function (settings) {
    const report = [];
    const isEnabled = (id) => settings[id] !== false;
    function addRule(id, name, severity, checks) {
      if (!isEnabled(id)) return;
      let failures = [];
      checks.forEach((check) => {
        if (!check.condition)
          failures.push({ issue: check.issue, solution: check.solution });
      });
      report.push({
        id: id,
        name: name,
        severity: severity,
        status: failures.length === 0 ? "PASS" : "FAIL",
        data: failures,
      });
    }

    const textElements = Array.from(
      document.querySelectorAll("h1, h2, h3, button, a.nav-link")
    );
    const lowContrastElements = textElements.filter((el) =>
      window.checkContrast(el)
    );
    if (isEnabled(1))
      lowContrastElements.forEach((el) =>
        window.highlightElement(
          el,
          "Medium",
          "Hard to Read",
          "Contrast too low."
        )
      );
    addRule(1, "Visibility of System Status", "Medium", [
      {
        condition: lowContrastElements.length === 0,
        issue: `Found ${lowContrastElements.length} low contrast elements.`,
        solution: "Increase contrast.",
      },
    ]);
    addRule(2, "Match between System & Real World", "Medium", [
      {
        condition: document.getElementsByTagName("h1").length > 0,
        issue: "No H1 found.",
        solution: "Add an <h1> tag.",
      },
    ]);
    const hasHome = document.querySelector(
      'a[href="/"], a[href="index.html"], .logo a'
    );
    addRule(3, "User Control and Freedom", "High", [
      {
        condition: !!hasHome,
        issue: "No Home Link",
        solution: "Add a link to Home.",
      },
    ]);
    const links = Array.from(document.querySelectorAll("a"));
    const badLinks = links.filter(
      (a) => !a.getAttribute("href") || a.getAttribute("href") === "#"
    );
    if (isEnabled(4))
      badLinks.forEach((link) =>
        window.highlightElement(
          link,
          "High",
          "Broken Link",
          "Link has no destination."
        )
      );
    addRule(4, "Consistency and Standards", "High", [
      {
        condition: badLinks.length === 0,
        issue: `Found ${badLinks.length} broken links.`,
        solution: "Fix href attributes.",
      },
    ]);
    const inputs = Array.from(
      document.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"])'
      )
    );
    const unnamedInputs = inputs.filter(
      (i) => !i.getAttribute("aria-label") && !i.getAttribute("name") && !i.id
    );
    if (isEnabled(5))
      unnamedInputs.forEach((input) =>
        window.highlightElement(
          input,
          "High",
          "Mystery Input",
          "Missing Label/ID."
        )
      );
    addRule(5, "Error Prevention", "High", [
      {
        condition: unnamedInputs.length === 0,
        issue: "Inputs missing labels.",
        solution: "Add labels.",
      },
    ]);
    const images = Array.from(document.querySelectorAll("img"));
    const missingAlt = images.filter(
      (img) => !img.alt || img.alt.trim() === ""
    );
    if (isEnabled(6))
      missingAlt.forEach((img) =>
        window.highlightElement(
          img,
          "Medium",
          "Accessibility Risk",
          "Missing Alt text."
        )
      );
    addRule(6, "Recognition rather than Recall", "Medium", [
      {
        condition: missingAlt.length === 0,
        issue: `Found ${missingAlt.length} images missing Alt Text.`,
        solution: "Add alt text.",
      },
    ]);
    const smallButtons = Array.from(
      document.querySelectorAll('button, a.btn, [role="button"]')
    ).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
    });
    if (isEnabled(7))
      smallButtons.forEach((btn) =>
        window.highlightElement(
          btn,
          "Medium",
          "Too Small",
          "Touch target < 44px."
        )
      );
    const search = document.querySelector('input[type="search"], .search');
    addRule(7, "Flexibility and Efficiency of Use", "Medium", [
      {
        condition: smallButtons.length === 0,
        issue: `Found ${smallButtons.length} small buttons.`,
        solution: "Resize to 44x44px.",
      },
      {
        condition: !!search || document.body.innerText.length < 1000,
        issue: "No Search Bar",
        solution: "Add search.",
      },
    ]);
    const deprecated = Array.from(
      document.querySelectorAll("font, center, big, marquee")
    );
    if (isEnabled(8))
      deprecated.forEach((el) =>
        window.highlightElement(el, "Low", "Old Code", "Deprecated HTML tag.")
      );
    addRule(8, "Aesthetic and Minimalist Design", "Low", [
      {
        condition: deprecated.length === 0,
        issue: "Deprecated tags found.",
        solution: "Use CSS.",
      },
    ]);
    const forms = document.querySelectorAll("form");
    const validated = Array.from(forms).filter((f) =>
      f.querySelector("[required]")
    );
    if (isEnabled(9) && forms.length > 0 && validated.length === 0)
      forms.forEach((f) =>
        window.highlightElement(
          f,
          "Medium",
          "No Validation",
          "Form missing required fields."
        )
      );
    addRule(9, "Help Users Recover from Errors", "Medium", [
      {
        condition: forms.length === 0 || validated.length > 0,
        issue: "Forms missing validation.",
        solution: "Add required attributes.",
      },
    ]);
    const footerText = document.body.innerText.toLowerCase();
    const hasHelp = ["contact", "help", "faq", "support"].some((t) =>
      footerText.includes(t)
    );
    addRule(10, "Help and Documentation", "Low", [
      {
        condition: hasHelp,
        issue: "No Help Links",
        solution: "Add FAQ/Help link.",
      },
    ]);
    return report;
  };
}
