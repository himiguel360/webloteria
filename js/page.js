// What the server used to do before the page reached the browser: pick the
// locale, write every static label in it, lay out the 160 preset buttons from
// the wallet list, and hand the search controller the string table it reads
// at runtime. It runs once, before Stimulus starts, so the controller never
// sees the page half-built.

const LOCALES = {
  pt: { dir: "ltr", name: "Portugues" },
  en: { dir: "ltr", name: "English" },
  es: { dir: "ltr", name: "Espanol" },
  de: { dir: "ltr", name: "Deutsch" },
  he: { dir: "rtl", name: "עברית" },
  ru: { dir: "ltr", name: "Русский" },
  ja: { dir: "ltr", name: "日本語" },
  id: { dir: "ltr", name: "Bahasa Indonesia" }
}
const DEFAULT_LOCALE = "pt"

export async function preparePage() {
  const locale = pickLocale()
  const html = document.documentElement
  html.lang = locale
  html.dir = LOCALES[locale].dir

  renderLocaleLinks(locale)

  try {
    const [strings, wallets] = await Promise.all([
      loadJSON(`../locales/${locale}.json`),
      loadJSON("../data/wallets.json")
    ])
    applyStrings(strings, locale)
    renderPresets(wallets, strings, locale)
  } catch (error) {
    // The English defaults in the markup are the fallback; the controller
    // logs its own failure to the page's console.
    console.error("weblotery: page setup failed", error)
  } finally {
    delete html.dataset.i18nPending
  }
}

// `?lang=xx` wins, then the browser's own preference, then Portuguese.
function pickLocale() {
  const requested = new URLSearchParams(location.search).get("lang")
  if (requested && LOCALES[requested]) return requested

  for (const tag of navigator.languages ?? []) {
    const code = tag.toLowerCase().split("-")[0]
    if (LOCALES[code]) return code
  }
  return DEFAULT_LOCALE
}

async function loadJSON(path) {
  const response = await fetch(new URL(path, import.meta.url))
  if (!response.ok) throw new Error(`${path}: ${response.status}`)
  return response.json()
}

// Static copy: every element carrying `data-i18n` gets its text, and
// `data-i18n-attr="attr:key;attr:key"` fills attributes the same way.
function applyStrings(strings, locale) {
  const t = (path, vars) => translate(strings, path, vars)

  document.title = t("title")

  document.querySelectorAll("[data-i18n]").forEach(element => {
    element.textContent = t(element.dataset.i18n)
  })

  document.querySelectorAll("[data-i18n-attr]").forEach(element => {
    element.dataset.i18nAttr.split(";").forEach(pair => {
      const [attr, path] = pair.split(":")
      if (attr && path) element.setAttribute(attr.trim(), t(path.trim()))
    })
  })

  // The subset the controller writes into the page itself: engine status,
  // core counts (as CLDR plural categories, picked by Intl.PluralRules),
  // console lines and the found card.
  const controllerStrings = {
    status: strings.status ?? {},
    cores: strings.cores ?? {},
    log: strings.log ?? {},
    found: strings.found ?? {}
  }
  document.querySelector(".wl[data-controller='weblotery']")
    .setAttribute("data-weblotery-strings-value", JSON.stringify(controllerStrings))
}

// All 160 wallets of the 1000 BTC puzzle. The range never travels: wallet N
// holds a key in [2^(N-1), 2^N - 1], so the number on the face of the button
// is the whole interval and only the address has to be written out.
function renderPresets(wallets, strings, locale) {
  const t = (path, vars) => translate(strings, path, vars)
  const solved = wallets.filter(w => w.solved).length

  const filters = document.querySelector(".wl-presets__filters")
  filters.replaceChildren(...[
    ["all", t("config.presets_all"), wallets.length],
    ["open", t("config.presets_open"), wallets.length - solved],
    ["solved", t("config.presets_solved"), solved]
  ].map(([key, label, count], index) => {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "wl-presets__filter"
    button.dataset.action = "click->weblotery#filterPresets"
    button.dataset.filter = key
    button.setAttribute("aria-pressed", String(index === 0))
    button.append(label)

    const badge = document.createElement("span")
    badge.className = "wl-presets__count num"
    badge.textContent = String(count)
    button.append(badge)
    return button
  }))

  const grid = document.querySelector(".wl-presets__grid")
  grid.replaceChildren(...wallets.map(wallet => {
    const button = document.createElement("button")
    button.type = "button"
    button.className = wallet.solved ? "wl-preset num is-solved" : "wl-preset num"
    button.dataset.action = "click->weblotery#loadPreset"
    button.dataset.puzzle = String(wallet.number)
    button.dataset.address = wallet.address
    button.dataset.solved = String(wallet.solved)
    button.setAttribute("aria-pressed", "false")
    button.title = wallet.solved
      ? t("config.preset_title_solved", { number: wallet.number })
      : t("config.preset_title", { number: wallet.number, prize: prizeBtc(wallet.number, locale) })
    button.textContent = String(wallet.number)
    return button
  }))
}

// Since the 2023 prize increase each wallet N holds N/10 BTC.
function prizeBtc(number, locale) {
  return (number / 10).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function renderLocaleLinks(current) {
  const list = document.querySelector("[data-locale-links]")
  if (!list) return

  list.replaceChildren(...Object.entries(LOCALES).map(([code, { name }]) => {
    const item = document.createElement("li")
    const link = document.createElement("a")
    const url = new URL(location.href)
    url.searchParams.set("lang", code)
    link.href = url.search
    link.className = "wl-locales__link"
    link.lang = code
    link.hreflang = code
    link.textContent = name
    if (code === current) link.setAttribute("aria-current", "page")
    item.append(link)
    return item
  }))
}

function translate(strings, path, vars = {}) {
  const value = path.split(".").reduce((node, key) => node?.[key], strings)
  const template = typeof value === "string" ? value : path
  return template.replace(/%\{(\w+)\}/g, (match, key) => (key in vars ? vars[key] : match))
}
