(async function () {
  /**
   * Create a title and a bar for an section in the options
   * @param {string} name 
   * @returns Element
   */
  const titleSection = (name) => {
    const title = el("span", { className: "menu_title" });
    el("hr", { className: 'flexchild' }, title)
    el("span", { textContent: name }, title);
    el("hr", { className: 'flexchild' }, title)
    return title;
  }

  const ver = document.querySelector('#version');
  ver.textContent = chrome.runtime.getManifest().version;

  const donate = document.getElementById("donate");
  donate.onclick = () => chrome.tabs.create({
    active: true,
    url: "https://www.paypal.com/donate?hosted_button_id=VPF2BYBDBU5AA"
  });

  const liEng = document.querySelector("#engines");

  const [engines, save] = await Promise.all([loadEngines(), loadSettings()]);

  Object.values(engines).forEach((e, i) => {
    if (e.active) {
      const div = el("div", {
        className: "engine",
        style: `--order: ${i + 1};`,
        onclick: () => chrome.tabs.create({ active: true, url: e.link })
      }, liEng);

      el("img", {
        src: e.icon,
        title: Object.keys(engines)[i],
        className: 'icon',
      }, div);
    }
  });


  const optionsContainer = document.getElementById("options-container");

  //options
  Object.keys(Settings).forEach((category) => {
    optionsContainer.append(titleSection(category));

    const sublist = el("ul", { className: "sublist", style: "display: block" }, optionsContainer);

    Object.entries(Settings[category]).forEach(([o, spec]) => {
      const li = el("li", { id: o }, sublist);

      const label = el("label", {
        className: "optiondiv",
        style: "display: inline-block"
      }, li);

      const spanImg = el("span", {
        className: "titleOption",
        innerHTML: spec.href ? `<a href=${spec.href}>${spec.name}</a>` : spec.name,
        title: spec.title ?? "",
        style: "padding-bottom: 2px"
      }, label);

      if (spec.local_icon) {
        const img = el("div", { className: "icon" }, spanImg);
        img.style = `background-image: url(../sites/icons/${spec.local_icon});
                    background-size: contain;
                    width: 14px;
                    height: 14px;
                    display: inline-block;`;
        spanImg.prepend(img);
      }

      if (typeof spec.default === 'number') {
        el("input", {
          type: "number",
          style: "width: 2rem",
          value: save[o],
          min: spec.min,
          max: spec.max,
          onchange: ({ target }) => {
            save[o] = target.value
            saveSettings(save);
          },
        }, label)
        return;
      }

      const checkDiv = el("div", {
        className: 'checkdiv',
        style: "display: inline-block"
      }, label)

      el('input', {
        className: "checkbox",
        type: "checkbox",
        checked: save[o],
        onchange: ({ target }) => {
          save[o] = target.checked
          saveSettings(save);
        }
      }, checkDiv)

    })
  });

  if (onChrome()) hrefPopUp();
})();