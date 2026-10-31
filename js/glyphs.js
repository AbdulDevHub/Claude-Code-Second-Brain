// Line icons for badges, drawn on a 24x24 grid (stroked, round caps). The renderer turns them into Path2D
// sprites and the HUD inlines them as SVG. Exposes window.NeuralGlyphs = { PATHS, glyphFor }.
(() => {
  const PATHS = {
    bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8z',
    box: 'M12 2 21 7v10l-9 5-9-5V7l9-5zM3 7l9 5 9-5M12 12v10',
    plug: 'M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7zM12 17v5',
    bot: 'M5 9h14v11H5zM12 4v5M9 14h.01M15 14h.01M2 14h3M19 14h3',
    folder: 'M3 6h6l2 2h10v11H3z',
    globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
    book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 5v16M8 7h7',
    doc: 'M6 2h8l5 5v15H6zM14 2v5h5M9 13h7M9 17h7',
    layers: 'M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5',
    link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
    toolbox: 'M3 8h18v12H3zM9 8V5h6v3M3 13h18',
    flame: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 2-5 0 2 1 3 2 3 0-4 2-6 2-10z',
    tree: 'M4 4h6v4H4zM14 10h6v4h-6zM14 17h6v4h-6zM7 8v11h7M7 12h7',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    gauge: 'M4 18a9 9 0 1 1 16 0M12 14l4-5M12 14h.01',
    arrowUp: 'M12 20V4M5 11l7-7 7 7',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
    branch: 'M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
    mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
    calendar: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
    terminal: 'M4 5h16v14H4zM7 10l3 2-3 2M12 15h5',
    palette: 'M12 3a9 9 0 1 0 0 18c1 0 2-1 1.5-2-.6-1.4.4-3 2-3H19a3 3 0 0 0 3-3c0-5.5-4.5-10-10-10zM7.5 11h.01M10 7h.01M15 7h.01',
    brain: 'M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 0V7a3 3 0 0 0-3-3zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 0',
    cloud: 'M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z',
    sparkle: 'M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z',
    pen: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    check: 'M4 12l5 5L20 6',
  };

  // First match wins, tested against "label id" in lower case. Type defaults come after.
  const RULES = [
    [/github|\bgit\b|commit|branch/, 'branch'],
    [/mail|inbox/, 'mail'],
    [/calendar|schedul/, 'calendar'],
    [/\bloop\b|cron|routine/, 'clock'],
    [/seo|analytics|chart|dataviz|metric/, 'chart'],
    [/review|checker|audit|\bcheck/, 'search'],
    [/find|search|research/, 'search'],
    [/playwright|chrome|browser|devtools|\bweb\b/, 'globe'],
    [/context7|\bdocs?\b|readme|guide/, 'book'],
    [/pdf|docx|xlsx|pptx|markdown|lint/, 'doc'],
    [/shadcn|component/, 'layers'],
    [/design|\bui\b|\bux\b|frontend|image|diagram|drawio|artifact|impeccable/, 'palette'],
    [/reflect|\bview\b|watch/, 'eye'],
    [/pilot|model|optimi/, 'gauge'],
    [/upgrade/, 'arrowUp'],
    [/toolbox/, 'toolbox'],
    [/firebase/, 'flame'],
    [/filetree|\btree\b/, 'tree'],
    [/connector|integration/, 'link'],
    [/cloud|insforge|deploy/, 'cloud'],
    [/remember|memory|imprint|recover|context|brain/, 'brain'],
    [/humaniz|write|style|tone|footer|comment|grammar/, 'pen'],
    [/terminal|\bcli\b|shell|bash|setup|init/, 'terminal'],
    [/brainstorm|architect|plan|idea/, 'sparkle'],
  ];
  const BY_TYPE = { skill: 'bolt', mod: 'box', mcp: 'plug', agent: 'bot', group: 'folder', hub: 'sparkle', core: 'sparkle' };

  function glyphFor(n) {
    const text = `${n.label || ''} ${n.id || ''}`.toLowerCase();
    if (n.type === 'skill' || n.type === 'mod' || n.type === 'mcp' || n.type === 'agent') {
      for (const [re, key] of RULES) if (re.test(text)) return key;
    }
    return BY_TYPE[n.type] || 'sparkle';
  }

  window.NeuralGlyphs = { PATHS, glyphFor };
})();
