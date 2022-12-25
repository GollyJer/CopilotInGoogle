Context.bangs = () => {
  if (Context.engineName === DuckDuckGo) return;

  const regexp = /[?|&]q=((%21|!)[^&]*)/;
  const reg = window.location.href.match(regexp);
  if (!reg) return;

  debug(reg[1]);
  window.location.href = `https://duckduckgo.com/?q=${reg[1]}`;
};

Context.calculator = () => {
  if (window.location.href.search(/[?|&]q=calculator(&?|$)/) === -1) return;

  Context.appendPanel(el("iframe", {
    className: Context.PANEL_CLASS,
    id: "opticalculator",
    src: "https://www.desmos.com/scientific",
  }));
};

Context.plot = (rep) => {
  Context.appendPanel(el("div", {
    className: Context.PANEL_CLASS,
    id: "optiplot",
  }));

  plotFun({
    expr: rep.expr,
    vars: rep.vars,
  }, "optiplot");
};

Context.compute = (rep) => {
  const panel = el("div", { className: Context.PANEL_CLASS });

  let str = "$" + math.parse(rep.expr).toTex() + "~";
  let answer = rep.answer;
  if (typeof answer == "number") {
    str += "=~" + answer.toPrecision(4);
  } else if (typeof answer == "boolean") {
    str += ":~" + answer;
  } else if (rep.answer.entries) {
    answer = answer.entries[0];
    str += "=~" + answer;
  }
  str += "$";


  const expr = el("div", { id: "optiexpr", textContent: str }, panel);
  toTeX(expr);
  panel.appendChild(createCopyButton(answer.toString()));
  Context.appendPanel(panel);
};

Context.plotOrCompute = () => {
  const rep = isMathExpr(Context.searchString);
  if (!rep) return;

  if (rep.vars.length > 0) {
    Context.isActive("plot") && Context.plot(rep);
  }
  else if (typeof rep.answer === "number" || typeof rep.answer === "boolean" || rep.answer.entries) {
    Context.isActive("calculator") && Context.compute(rep);
  }
};

Context.chatgpt = async () => {
  const body = el("div");
  const textContainer = el("div", { textContent: "Waiting for ChatGPT..." }, body);
  const panel = Context.panelFromSite({
    title: Settings.Tools.chatgpt.name,
    link: Settings.Tools.chatgpt.link,
    body,
  });
  Context.appendPanel(panel);
  panel.querySelector('img').src = chrome.runtime.getURL(Settings.Tools.chatgpt.icon);

  try {
    await Context.gpt.init();
    const text = await Context.gpt.send(Context.searchString, (text) => {
      textContainer.textContent = text;
    });
    console.log(text);
    console.log(await Context.gpt.fetchConversations());
    console.log(await Context.gpt.removeConversation());
    console.log(await Context.gpt.fetchConversations());
  }
  catch (error) {
    console.error(error);
    el("a", {
      href: ChatGPTSession.URL_SESSION,
      textContent: "Click here to verify session"
    }, body);
  }



};
