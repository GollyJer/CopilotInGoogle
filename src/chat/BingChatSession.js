class BingChatSession extends ChatSession {
  properties = {
    name: "Bing",
    link: "https://www.bing.com/search",
    icon: "src/images/bingchat.png",
    local_icon: "bingchat.png",
    href: "https://www.bing.com/search?form=MY0291&OCID=MY0291&q=Bing+AI&showconv=1",
  }
  static errors = {
    session: {
      code: 'BING_CHAT_SESSION',
      url: 'https://login.live.com/login.srf?wa=wsignin1.0&wreply=https%3A%2F%2Fwww.bing.com%2Ffd%2Fauth%2Fsignin%3Faction%3Dinteractive%26provider%3Dwindows_live_id%26return_url%3Dhttps%3A%2F%2Fwww.bing.com%2F%3Fwlexpsignin%3D1%26src%3DEXPLICIT',
      text: "Please login to Bing with your Microsoft account, then refresh :",
      button: "Login to Bing",
    },
    forbidden: {
      code: 'BING_CHAT_FORBIDDEN',
      url: 'https://www.bing.com/new?form=MY028Z&OCID=MY028Z',
      text: "Unfortunately you don't have access to Bing Chat yet, please register to the waitlist",
      button: "Register to the waitlist",
    },
    captcha: {
      code: 'BING_CHAT_CAPTCHA',
      url: 'https://www.bing.com/search?form=MY0291&OCID=MY0291&q=Bing+AI&showconv=1',
      text: "Please solve the captcha on Bing by starting a conversation and refresh the page:",
      button: "Solve the captcha",
    },
  }
  static get storageKey() {
    return "SAVE_BINGCHAT";
  }

  /** @type {HTMLImageElement | null} */
  bingIconElement = null;

  constructor() {
    super('bingchat');
    this.socketID = null;
    this.uuid = generateUUID(); // for conversation continuation
  }

  async init() {
    if (ChatSession.debug) return;
    await this.fetchSession();
  }

  async fetchSession() {
    const sessionURL = await this.parseSessionFromURL();
    if (sessionURL) {
      this.isContinueSession = true;
      this.session = sessionURL;
      return this.session;
    }

    const session = await BingChatSession.offscreenAction({ action: "session" });
    if (session.result?.value === 'UnauthorizedRequest')
      throw BingChatSession.errors.session;
    if (session.result?.value === 'Forbidden')
      throw BingChatSession.errors.forbidden;
    this.session = session;
    this.session.isStartOfSession = true;
    return this.session;
  }

  async parseSessionFromURL() {
    if (!window.location.hostname.endsWith('.bing.com'))
      return;
    const continuesession = new URL(window.location.href).searchParams.get('continuesession');
    if (!continuesession)
      return;
    const session = await bgWorker({ action: 'session-storage', type: 'get', key: continuesession });
    if (!session || session.inputText !== parseSearchParam())
      return;
    return session;
  }

  async send(prompt) {
    super.send(prompt);
    if (ChatSession.debug) {
      return;
    }

    this.bingIconElement?.classList.add('disabled');

    bgWorker({
      action: 'session-storage', type: 'set', key: this.uuid,
      value: { ...this.session, inputText: prompt }
    });

    this.socketID = await this.createSocket();
    const { packet } = await this.socketReceive();
    if (packet !== '{}\x1e') {
      this.onErrorMessage();
      err(`Error with Bing Chat: first packet received is ${packet}`);
      return;
    }

    await this.socketSend({ "type": 6 });
    await this.socketSend(await this.config(prompt));
    return this.next();
  }

  createPanel(directchat = true) {
    super.createPanel(directchat);

    const leftButtonsContainer = el('div'); //$('.left-buttons-container', this.panel)

    const allowInternalSearchButton = el('div', {
      className: 'bing-internal-search-button headerhover',
      title: 'Bing Internal Search',
    }, leftButtonsContainer);

    el('img', { 
      src: chrome.runtime.getURL('src/images/bing_search_allowed.png'),
      className: 'bing-internal-search-allowed',
    }, allowInternalSearchButton);
    el('img', { 
      src: chrome.runtime.getURL('src/images/bing_search_forbidden.png'),
      className: 'bing-internal-search-forbidden',
    }, allowInternalSearchButton);

    allowInternalSearchButton.toggleClass = () => {
      allowInternalSearchButton.classList.toggle('allowed', Context.save['bingInternalSearch']);
      allowInternalSearchButton.classList.toggle('forbidden', !Context.save['bingInternalSearch']);
    };
    allowInternalSearchButton.toggleClass();
    allowInternalSearchButton.onclick = () => {
      Context.save['bingInternalSearch'] = !Context.isActive('bingInternalSearch');
      saveSettings(Context.save);
      allowInternalSearchButton.toggleClass();
    };


    this.bingIconElement = $('img', $('.ai-name', this.panel));
    const setConversationStyle = (mode = 'balanced') => {
      Context.save['bingConvStyle'] = mode;
      saveSettings(Context.save);
      const displayName = Settings['AI Assitant']['bingConvStyle'].options[mode].name;
      this.bingIconElement.title = displayName;
      $('.optiheader', this.panel).dataset['bingConvStyle'] = mode;
    }
    this.bingIconElement.addEventListener('click', async () => {
      if (this.bingIconElement.classList.contains('disabled')) {
        return;
      }

      const modes = ['balanced', 'precise', 'creative'];
      const current = Context.save['bingConvStyle'] || modes[0];
      setConversationStyle(modes.at((modes.indexOf(current) + 1) % modes.length));
    });
    setConversationStyle(Context.save['bingConvStyle']);

    return this.panel;
  }

  async next() {
    const res = await this.socketReceive();
    if (!res) {
      return;
    }
    /**@type {{packet: string, readyState: number}} */
    const { packet, readyState } = res;
    this.session.isStartOfSession = false;

    /**
     * body.type: 1 = Invocation, 2 = StreamItem, 3 = Completion, 4 = StreamInvocation, 5 = CancelInvocation, 6 = Ping, 7 = Close
     * @param {*} body 
     * @returns 
     */
    const parseResponseBody = (body) => {
      let msg = null;
      switch (body.type) {
        case 1: msg = body.arguments[0]?.messages && body.arguments[0]?.messages[0]; break;
        case 2:
          if (!body.item) {
            this.onErrorMessage();
            return;
          }
          if (body.item.result) {
            if (body.item.result.value === 'Throttled') {
              this.onErrorMessage("⚠️&nbsp;Sorry, you've reached the limit of messages you can send to Bing within 24 hours. Check back soon!");
              return;
            }
            if (body.item.result.value === 'UnauthorizedRequest') {
              this.onErrorMessage(body.item.result?.message);
              return;
            }
            if (body.item.result.error) {
              if (body.item.result.error === 'UnauthorizedRequest')
                throw BingChatSession.errors.session;
              if (body.item.result.error === 'Forbidden')
                throw BingChatSession.errors.forbidden;
              if (body.item.result.value === 'CaptchaChallenge')
                throw BingChatSession.errors.captcha;
            }
            if (body.item.result?.message) {
              msg = body.item.result.message;
              break;
            }
          }
          if (!body.item.messages) {
            this.onErrorMessage();
            return;
          }
          msg = body.item.messages.find(m => !m.messageType && m.author === 'bot');
          break;
        case 6:
          this.socketSend({ "type": 6 });
          return;
        case 3: case 7:
          this.allowSend();
          return 'close';
        default: return;
      }
      const validTypes = ['InternalSearchQuery', undefined];
      if (!(msg && validTypes.some(t => t === msg.messageType)))
        return;

      if (msg.messageType === 'InternalSearchQuery') {
        this.onmessage(ChatSession.infoHTML(`🔍 ${msg.text.replace(/`([^`]*)`/, '<strong>$1</strong>')}`));
        return;
      }
      const refText = msg.adaptiveCards && msg.adaptiveCards[0]?.body.find(x => x.text && x.text.startsWith("[1]: http"))?.text;
      const refs = refText?.split('\n')
        .map(s => s.match(/\[(\d+)]: (http[^ ]+) \"(.*)\"/)) // parse links
        .filter(r => !!r).map(([_, n, href, title]) => ({ n, href, title }));
      const learnMore = msg.adaptiveCards && msg.adaptiveCards[0]?.body.find(x => x.text && x.text.startsWith("Learn more:"))?.text;
      let text = msg.text || msg.spokenText;
      if (!text) return;
      const sources = {};
      if (learnMore) {
        [...learnMore.matchAll(/\[(\d+)\. [^\]]+\]\(([^ ]+)\) ?/g)].forEach(([_, n, href]) => sources[href] = n);
        text = text.replace(/\[\^(\d+)\^\]/g, '\uF8FD$1\uF8Fe');
      }

      const bodyHTML = runMarkdown(text).replace(/\uF8FD(\d+)\uF8FE/g, (_, nRef) => {
        const ref = refs.find(r => r.n == nRef);
        const nSource = sources[ref.href];
        return ref ? `<a href="${ref.href}" title="${ref.title}" class="source superscript">${nSource}</a>` : '';
      });
      const maxVisible = 2;
      const invisible = Math.max(0, Object.keys(sources).length - maxVisible);
      const footHTML = Object.keys(sources).length === 0 ? '' : `<div class="learnmore less" 
          >Learn more&nbsp: ${Object.entries(sources).map(([href, n], i) =>
        `<a class="source" href="${href}" ${i >= maxVisible ? 'more' : ''}>${n}. ${new URL(href).host}</a>`).join('\n')}
          <a class="showmore source" title="Show more" invisible=${invisible}>+${invisible} more</a></div>`;
      this.onmessage(bodyHTML, footHTML);
    }
    const doClose = packet.split('\x1e')
      .slice(0, -1)
      .map(json => json.replaceAll('\n', '\\n'))
      .map(json => {
        try {
          return JSON.parse(json);
        } catch (e) {
          console.warn(e, json);
          return;
        }
      })
      .map(parseResponseBody)
      .find(x => x === 'close');

    if (doClose || readyState === WebSocket.CLOSED)
      return;

    return this.next();
  }

  removeConversation() {
    if (ChatSession.debug || !this.session)
      return;
    const { conversationSignature, clientId, conversationId } = this.session;

    return bgFetch('https://sydney.bing.com/sydney/DeleteSingleConversation', {
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        conversationId,
        conversationSignature,
        "participant": {
          "id": clientId
        },
        "source": "cib",
        "optionsSets": [
          "autosave"
        ]
      }),
      method: "POST",
      mode: "cors",
      credentials: "include",
    });
  }

  async createSocket() {
    let url = 'wss://sydney.bing.com/sydney/ChatHub';
    if ('sec_access_token' in this.session) {
      url += `?sec_access_token=${encodeURIComponent(this.session['sec_access_token'])}`;
    }
    const res = await BingChatSession.offscreenAction({
      action: "socket",
      url,
      toSend: JSON.stringify({ "protocol": "json", "version": 1 }) + '\x1e',
    });
    if (!('socketID' in res)) {
      throw "Socket ID not returned";
    }
    return res.socketID;
  }

  socketSend(body) {
    if (this.socketID == null)
      throw "Need socket ID to send";
    return BingChatSession.offscreenAction({
      action: "socket",
      socketID: this.socketID,
      toSend: JSON.stringify(body) + '\x1e',
    });
  }

  socketReceive() {
    if (this.socketID == null)
      throw "Need socket ID to receive";
    return BingChatSession.offscreenAction({
      action: "socket",
      socketID: this.socketID,
    });
  }

  static async offscreenAction(params) {
    if (onChrome()) {
      await bgWorker({ action: "setup-bing-offscreen" });
    }
    return await bgWorker({
      ...params,
      target: 'offscreen',
    });
  }

  async config(prompt) {
    if (!this.session)
      throw "Session has to be fetched first";
    const { conversationSignature, clientId, conversationId, isStartOfSession } = this.session;

    const timestamp = () => {
      const pad0 = (n) => n < 10 ? "0" + n : n;
      let t = (new Date).getTimezoneOffset(), hOff = Math.floor(Math.abs(t / 60)), mOff = Math.abs(t % 60);
      let end = '';
      if (t < 0)
        end = "+" + pad0(hOff) + ":" + pad0(mOff);
      else if (t > 0)
        end = "-" + pad0(hOff) + ":" + pad0(mOff);
      else if (t == 0)
        end = "Z";
      const now = new Date;
      const d = now.getDate(), mo = now.getMonth() + 1, y = now.getFullYear(),
        h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
      return `${pad0(y)}-${pad0(mo)}-${pad0(d)}T${pad0(h)}:${pad0(m)}:${pad0(s)}${end}`;
    }

    const { sliceIds, optionsSets } = {
      sliceIds: ["tnaenableux", "adssqovr", "tnaenable", "0731ziv2s0", "lessttscf", "creatordevcf", "inosanewsmob", "wrapnoins", "gbacf", "wrapuxslimc", "prehome", "sydtransl", "918raianno", "713logprobss0", "926bof108t525", "806log2sph", "927uprofasys0", "919vidsnips0", "917fluxv14"],
      optionsSets: ["nlu_direct_response_filter", "deepleo", "disable_emoji_spoken_text", "responsible_ai_policy_235", "enablemm", "dv3sugg", "autosave", "iyxapbing", "iycapbing", "saharagenconv5", "bof108t525", "log2sph", "eredirecturl"]
    };

    const convStyle = {
      'creative': ["h3imaginative", "clgalileo", "gencontentv3"],
      'balanced': ["galileo"],
      'precise': ["h3precise", "clgalileo", "gencontentv3"],
    }[Context.save['bingConvStyle']];

    if (convStyle) {
      optionsSets.push(...convStyle);
    }

    if (!Context.isActive('bingInternalSearch')) {
      prompt = '#nosearch ' + prompt;
    }

    return {
      arguments: [{
        source: "cib",
        sliceIds,
        optionsSets,
        allowedMessageTypes: [
          "Chat",
          "InternalSearchQuery",
        ],
        verbosity: "verbose",
        isStartOfSession,
        message: {
          timestamp: timestamp(),
          author: "user",
          inputMethod: "Keyboard",
          text: prompt,
          messageType: "Chat"
        },
        conversationSignature,
        participant: {
          id: clientId,
        },
        conversationId
      }],
      invocationId: "0",
      target: "chat",
      type: 4,
    }
  }
}
