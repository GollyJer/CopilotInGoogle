class Context {
  static PANEL_CLASS = "optipanel";
  static gpt = new ChatGPTSession();
  /**@type string[] */
  static links = [];
  static async init() {
    debug("Hello !");

    Context.docHead = document.head || document.documentElement;

    await Context.injectStyle();

    const engines = await loadEngines();

    const siteFound = window.location.hostname;
    Context.engineName = Object.entries(engines)
      .find(([_, e]) => siteFound.search(new RegExp(e.regex)) != -1)[0];
    Context.engine = engines[Context.engineName];
    if (!Context.engine)
      return;

    if (!Context.parseSearchString()) {
      debug("No search string detected");
      return;
    }

    debug(`${Context.engineName} — "${Context.searchString}"`);

    
    // Change style based on the search engine
    const style = Context.engine.style;
    if (style) el('style', { textContent: style, className: `optistyle-${Context.engineName}` }, Context.docHead);

    Context.save = await loadSettings();
    // Bigger right column
    if (Context.isActive('wideColumn')) {
      const minW = 600;
      const maxW = 600;
      const widthStyle = Context.engine.widthStyle?.replace("${maxW}", maxW).replace("${minW}", minW);
      if (widthStyle) el('style', { textContent: widthStyle, className: `optistyle-${Context.engineName}` }, Context.docHead);
    }
    Context.parseRightColumn();
    Context.executeTools();

    Context.currentPanelIndex = 0;
    Context.panels = [];
    Context.links = [];
    Context.resultLinks = [];

    Context.parseResults();

    /**
     * Update color if the theme has somehow changed
     */
    let prevBg = null;
    setInterval(() => {
      const bg = getBackgroundColor();
      if (bg === prevBg)
        return;
      prevBg = bg;
      Context.updateColor();
    }, 200)

  }

  static isActive(tool) {
    return Context.save[tool];
  }
  static parseSearchString() {
    Context.searchString = $(Context.engine.searchBox)?.value;
    return Context.searchString;
  }
  static async injectStyle() {
    const styles = ['chatgpt', 'panel', 'tomorrow', 'sunburst', 'w3schools', 'wikipedia', 'genius'];
    const cssContents = await Promise.all(styles.map(s => read(`src/styles/${s}.css`)));
    el('style', { className: 'optistyle', textContent: cssContents.join('\n') }, Context.docHead);
  }
  static executeTools() {
    if (Context.isActive("chatgpt")) Context.chatgpt();
    if (Context.isActive("bangs")) Context.bangs();
    if (Context.isActive("calculator")) Context.calculator();
    if (Context.isActive("calculator") || Context.isActive("plot")) Context.plotOrCompute();
  }

  static parseResults() {
    const results = $$(Context.engine.resultRow);
    if (results.length > 0) {
      results.forEach(Context.handleResult);
      return;
    }
    if (Context.engineName !== DuckDuckGo) {
      debug("No result detected");
      return;
    }

    const resultsContainer = $(Context.engine.resultsContainer);
    const observer = new MutationObserver((mutationRecords) => {
      // Handle mutations
      mutationRecords
        .filter(mr => mr.addedNodes.length > 0)
        .map(mr => mr.addedNodes[0])
        .filter(n => n?.matches(Context.engine.resultRow))
        .forEach(Context.handleResult);
    });

    observer.observe(resultsContainer, { childList: true });
  }

  /**
     * Take the result Element and send a request to the site if it is supported
     * @param {Element} result the result
     */
  static async handleResult(result) {
    if (Context.links.length >= Context.save.maxResults)
      return;

    const linksInResultContainer = $$("a", result).map(a => a.href);
    let siteLink = linksInResultContainer.find(l => !l.startsWith(Context.engine.link) && l !== 'javascript:void(0)');
    let intermediateLink = null;
    if (!siteLink && Context.engineName === Bing) {
      siteLink = $('cite', result)?.textContent;
      intermediateLink = linksInResultContainer[0];
    }
    if (!siteLink)
      return;

    const find = Object.entries(Sites).find(([_, { link }]) => siteLink.search(link) !== -1);
    if (!find)
      return;
    const [siteName, siteProps] = find;
    if (!Context.isActive(siteName))
      return;

    const paramsToSend = {
      engine: Context.engineName,
      link: siteLink,
      site: siteName,
      type: "html",
      ...siteProps.msgApi(siteLink),
    };

    if (intermediateLink) {
      const html = await bgFetch(intermediateLink);
      const start = html.lastIndexOf('"', html.search(siteProps.link)) + 1;
      const end = html.indexOf('"', start);
      siteLink = html.substring(start, end);
      paramsToSend.link = siteLink;
    }

    const isSameURL = (a, b) => a.host === b.host && a.pathname === b.pathname && a.search === b.search;

    const urlLink = new URL(siteLink);
    if (Context.links.some(l => isSameURL(l, urlLink)))
      return;
    const panelIndex = Context.links.length;
    Context.links.push(new URL(siteLink));

    chrome.runtime.sendMessage(paramsToSend, async (resp) => {
      if (!resp)
        return;
      const [msg, text] = resp;
      const site = Sites[msg.site];
      if (!site)
        return;

      let doc;
      switch (msg.type) {
        case 'html': doc = new DOMParser().parseFromString(text, "text/html"); break;
        case 'json': doc = JSON.parse(text); break;
        default: return;
      }

      const siteData = { ...msg, ...(await site.get(msg, doc)) };
      const content = site.set(siteData); // set body and foot

      if (content && content.body.innerHTML && siteData.title !== undefined)
        Context.panels[panelIndex] = Context.panelFromSite({ ...siteData, icon: siteData.icon ?? site.icon, ...content });
      else
        Context.panels[panelIndex] = null;

      Context.updatePanels();
    });
  }

  /**
   * Draw the panels in order. Only when the previous are not undefined
   */
  static updatePanels() {
    while (Context.currentPanelIndex < Context.links.length) {
      const panel = Context.panels[Context.currentPanelIndex];
      if (panel === undefined) {
        return;
      }
      if (panel !== null) {
        Context.appendPanel(panel);
      }
      Context.currentPanelIndex++;
    }
    PR.prettyPrint();
  }

  static prettifyCode(element, runPrettify = false) {
    $$("code, pre", element).forEach(c => c.classList.add("prettyprint"));

    $$("pre", element).forEach((pre) => {
      const surround = el("div", { className: "pre-surround", innerHTML: pre.outerHTML, style: "position: relative" });
      surround.append(createCopyButton(pre.innerText.trim()));

      pre.parentNode.replaceChild(surround, pre);
    });
    runPrettify && PR.prettyPrint();
  }

  static panelFromSite({ site, title, link, icon, header, body, foot }) {
    const panel = el("div", { className: `${Context.PANEL_CLASS}` });

    //watermark
    el("div", { className: "watermark", textContent: "OptiSearch" }, panel);

    const headPanel = el("div", { className: "optiheader" }, panel);

    const a = el("a", { href: link }, headPanel);

    toTeX(el("div", { className: "title result-title", textContent: title }, a), false);

    const linkElement = el("cite", { className: "optilink result-url" }, a);
    el("img", { width: 16, height: 16, src: icon }, linkElement);
    el("span", { textContent: link }, linkElement);

    if (body)
      hline(panel);

    const content = el('div', { className: "opticontent" }, panel);

    // HEADER
    if (header) {
      content.append(header);
      hline(content);
    }
    // BODY
    if (body) {
      body.classList.add("optibody");

      if (site === "stackexchange") {
        $$('.math-container', body).forEach((e) => toTeX(e, true));
      }

      Context.prettifyCode(body);
      content.append(body);
    }

    // FOOT
    if (foot) {
      foot.id = "output";
      hline(content);
      content.append(foot);
    }

    writeHostOnLinks(link, panel);

    return panel;
  }

  /**
   * Append pannel to the side of the result page
   * @param {Element} panel the content of the panel
   * @returns {Element} the box where the panel is 
   */
  static appendPanel(panel, prepend = false) {
    if (!Context.rightColumn)
      return null;

    const box = el("div", { className: `optisearchbox bright ${Context.engineName}` });
    if (prepend)
      Context.rightColumn.prepend(box);
    else
      Context.rightColumn.append(box);

    box.append(panel);
    Context.updateColor();

    return box;
  }

  /**
   * Get and/or add right column to the results page if there isn't one
   * @returns {Node} Context.rightColumn
   */
  static parseRightColumn() {
    const selectorRightCol = Context.engine.rightColumn;
    Context.rightColumn = $(selectorRightCol);
    if (Context.rightColumn)
      return Context.rightColumn;


    const centerColumn = $(Context.engine.centerColumn);
    if (!centerColumn)
      debug("No right column");

    // create a right column with the correct attributes
    const [sr] = selectorRightCol.split(',');
    const arr = [...sr.matchAll(/[\.#\[][^\.#,\[]+/g)]
    const attr = {}
    arr.map(a => a[0]).forEach(token => {
      switch (token[0]) {
        case '.':
          if (!attr.className) attr.className = ''
          attr.className += (attr.className && ' ') + token.slice(1);
          break;
        case '#': attr.id = token.slice(1); break;
        case '[':
          const [ss] = [...token.matchAll(/\[([^\]=]+)(=([^\]]+))?\]/g)];
          attr.attributes = [...(attr.attributes || []), { name: ss[1], value: ss[3] }];
          break;
      }
    });

    Context.rightColumn = el('div', attr);
    insertAfter(Context.rightColumn, centerColumn);
    if (Context.engineName === Ecosia) {
      const searchNav = $(Context.engine.searchNav);

      new MutationObserver(_ => {
        if (!$(Context.engine.searchNav))
          insertAfter(searchNav, $(Context.engine.searchNavNeighbor));
        if (!$(Context.engine.rightColumn))
          insertAfter(Context.rightColumn, $(Context.engine.centerColumn));
      }).observe($('#__layout'), { childList: true });
    }

    return Context.rightColumn;
  }


  static updateColor() {
    const bg = getBackgroundColor();
    const dark = isDarkMode();
    const allPanels = $$(".optisearchbox");

    let style = $('#optisearch-bg');
    if (!style)
      style = el('style', { id: 'optisearch-bg' }, Context.docHead);

    if (dark) {
      style.textContent = `.optisearchbox.dark {background-color: ${colorLuminance(bg, 0.02)}}
      .optisearchbox.dark .optipanel .optibody.w3body .w3-example {background-color: ${colorLuminance(bg, 0.04)}}
      .optisearchbox.dark .prettyprint, .optisearchbox.dark .pre-surround .prettyprint {background-color: ${colorLuminance(bg, -0.02)}}`;
    }
    for (let p of allPanels) {
      if (dark)
        p.className = p.className.replace("bright", "dark");
      else
        p.className = p.className.replace("dark", "bright");
    }
  }
}