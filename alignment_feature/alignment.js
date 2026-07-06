import { NT_BOOKS } from './verse_data.js';

const greekInput = document.getElementById('greek-text');
const latinInput = document.getElementById('latin-text');
const requestBtn = document.getElementById('request-realignment');
const popup = document.getElementById('realignment-popup');
const backdrop = document.getElementById('popup-backdrop');
const popupClose = document.getElementById('popup-close');
const popupHeader = document.getElementById('popup-header');
const canvas = document.getElementById('alignment-canvas');
const greekRow = document.getElementById('greek-row');
const latinRow = document.getElementById('latin-row');
const linesSvg = document.getElementById('alignment-lines');
const bookSelect = document.getElementById('book-select');
const chapterSelect = document.getElementById('chapter-select');
const verseSelect = document.getElementById('verse-select');
const submitBtn = document.getElementById('submit-alignment');
const resetBtn = document.getElementById('reset-alignment');
const clearBtn = document.getElementById('clear-alignment');
const jsonOutput = document.getElementById('json-output');
const verseAlignment = document.getElementById('verse-alignment');
const verseAlignmentCanvas = document.getElementById('verse-alignment-canvas');
const verseGreekRow = document.getElementById('verse-greek-row');
const verseLatinRow = document.getElementById('verse-latin-row');
const verseLinesSvg = document.getElementById('verse-alignment-lines');

let verseCorpus = null;
let alignmentByVid = null;

function splitWords(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function getGreekText() {
  return greekInput.textContent;
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

function getVid() {
  const book = NT_BOOKS[bookSelect.selectedIndex];
  const chapter = Number(chapterSelect.value);
  const verse = Number(verseSelect.value);
  return `${book.num}${pad3(chapter)}${pad3(verse)}`;
}

function getSelectedRef() {
  const book = NT_BOOKS[bookSelect.selectedIndex];
  return `${book.abbr} ${chapterSelect.value}:${verseSelect.value}`;
}

function populateChapterOptions(bookIndex) {
  const counts = NT_BOOKS[bookIndex].verseCounts;
  chapterSelect.replaceChildren();
  counts.forEach((_, index) => {
    const chapter = index + 1;
    chapterSelect.appendChild(new Option(chapter, chapter));
  });
}

function populateVerseOptions(bookIndex, chapterIndex) {
  const count = NT_BOOKS[bookIndex].verseCounts[chapterIndex];
  verseSelect.replaceChildren();
  for (let verse = 1; verse <= count; verse += 1) {
    verseSelect.appendChild(new Option(verse, verse));
  }
}

function setVerseSelection(bookIndex, chapter, verse) {
  bookSelect.selectedIndex = bookIndex;
  populateChapterOptions(bookIndex);
  chapterSelect.value = String(chapter);
  populateVerseOptions(bookIndex, chapter - 1);
  verseSelect.value = String(verse);
}

async function loadVerseCorpus() {
  if (verseCorpus) return verseCorpus;

  const [refsText, vidsText, greekText, latinText] = await Promise.all([
    fetch('./files/ntvref.txt').then((res) => res.text()),
    fetch('./files/vref_ids.txt').then((res) => res.text()),
    fetch('./files/greek.txt').then((res) => res.text()),
    fetch('./files/latin.txt').then((res) => res.text()),
  ]);

  // This preserves blank lines for missing verses (e.g., Matthew 23:14, John 5:4, et al)
  const splitLines = (text) => {
    const lines = text.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    return lines;
  };

  const refs = splitLines(refsText);
  const vids = splitLines(vidsText);
  const greek = splitLines(greekText);
  const latin = splitLines(latinText);

  const byRef = new Map();
  refs.forEach((ref, index) => {
    const trimmedRef = ref.trim();
    if (!trimmedRef) return;
    byRef.set(trimmedRef, {
      vid: vids[index]?.trim() ?? '',
      greek: greek[index]?.trim() ?? '',
      latin: latin[index]?.trim() ?? '',
    });
  });

  verseCorpus = { byRef };
  return verseCorpus;
}

function parseAlignmentLine(line) {
  const dashIdx = line.indexOf(' - ');
  if (dashIdx === -1) return null;

  const latinWord = line.slice(0, dashIdx);
  const rest = line.slice(dashIdx + 3).trim();
  const pairs = [];

  if (rest) {
    const parts = rest.split(/\s+/);
    for (let i = 0; i + 2 < parts.length; i += 3) {
      const wordId = Number(parts[i]);
      pairs.push({
        greekIdx: (wordId % 1000) - 1,
        greekWord: parts[i + 1],
        confidence: Number(parts[i + 2]),
        wordId,
      });
    }
  }

  return { latinWord, pairs };
}

async function loadAlignmentData() {
  if (alignmentByVid) return alignmentByVid;

  const text = await fetch('./files/aqua_alignment.txt').then((res) => res.text());
  const byVid = new Map();
  let currentVid = null;

  text.split(/\r?\n/).filter(Boolean).forEach((line) => {
    const entry = parseAlignmentLine(line);
    if (!entry) return;

    if (entry.pairs.length > 0) {
      currentVid = String(Math.floor(entry.pairs[0].wordId / 1000));
    }
    if (!currentVid) return;

    if (!byVid.has(currentVid)) byVid.set(currentVid, []);
    byVid.get(currentVid).push(entry);
  });

  alignmentByVid = byVid;
  return alignmentByVid;
}

function greekWordsFromAlignment(alignments) {
  const byIdx = new Map();
  alignments.forEach(({ pairs }) => {
    pairs.forEach(({ greekIdx, greekWord }) => {
      byIdx.set(greekIdx, greekWord);
    });
  });
  if (byIdx.size === 0) return [];
  const maxIdx = Math.max(...byIdx.keys());
  return Array.from({ length: maxIdx + 1 }, (_, idx) => byIdx.get(idx) ?? '');
}

function alignedGreekIndices(alignments) {
  const idxs = new Set();
  alignments.forEach(({ pairs }) => {
    pairs.forEach(({ greekIdx }) => idxs.add(greekIdx));
  });
  return idxs;
}

function getAlignmentContext() {
  const alignments = alignmentByVid?.get(getVid()) ?? [];
  const alignedIdxs = alignedGreekIndices(alignments);
  const greekWords = splitWords(getGreekText());
  const fallback = greekWordsFromAlignment(alignments);
  const words = greekWords.length >= fallback.length ? greekWords : fallback;
  const latinEntries = alignments.length
    ? alignments
    : splitWords(latinInput.value).map((latinWord) => ({ latinWord, pairs: [] }));
  return { alignments, alignedIdxs, greekWords: words, latinEntries };
}

const verseView = {
  canvas: verseAlignmentCanvas,
  greekRow: verseGreekRow,
  latinRow: verseLatinRow,
  linesSvg: verseLinesSvg,
};

const popupView = {
  canvas,
  greekRow,
  latinRow,
  linesSvg,
};

function buildGreekRow(greekRowEl, words, alignedIdxs) {
  greekRowEl.replaceChildren();

  words.forEach((word, index) => {
    const token = document.createElement('div');
    token.className = 'greek-token';
    if (!alignedIdxs.has(index)) token.classList.add('unmatched');
    token.dataset.index = String(index);

    const idxEl = document.createElement('div');
    idxEl.className = 'greek-index';
    idxEl.textContent = index;

    const wordEl = document.createElement('div');
    wordEl.className = 'greek-word';
    wordEl.textContent = word;

    token.append(idxEl, wordEl);
    greekRowEl.appendChild(token);
  });
}

function buildLatinRowReadonly(latinRowEl, latinEntries) {
  latinRowEl.replaceChildren();

  latinEntries.forEach(({ latinWord, pairs }, latinIndex) => {
    const token = document.createElement('div');
    token.className = 'latin-token readonly';
    token.dataset.latinIndex = String(latinIndex);
    token.dataset.greekIdxs = pairs.map(({ greekIdx }) => greekIdx).join(',');

    const wordEl = document.createElement('div');
    wordEl.className = 'latin-word';
    wordEl.textContent = latinWord;
    token.appendChild(wordEl);

    if (pairs.length === 0) {
      const missing = document.createElement('div');
      missing.className = 'alignment-missing';
      missing.textContent = '—';
      token.appendChild(missing);
    } else {
      pairs.forEach(({ greekIdx, confidence }) => {
        const match = document.createElement('div');
        match.className = 'alignment-confidence';
        match.textContent = `${greekIdx} · ${confidence.toFixed(2)}`;
        match.title = `Greek index ${greekIdx}, confidence ${confidence}`;
        token.appendChild(match);
      });
    }

    latinRowEl.appendChild(token);
  });
}

function buildLatinRowEditable(latinRowEl, latinEntries, greekCount, onInput) {
  latinRowEl.replaceChildren();

  latinEntries.forEach(({ latinWord, pairs }, latinIndex) => {
    const token = document.createElement('div');
    token.className = 'latin-token';
    token.dataset.latinIndex = String(latinIndex);

    const wordEl = document.createElement('div');
    wordEl.className = 'latin-word';
    wordEl.textContent = latinWord;

    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.pattern = '[0-9]*';
    input.placeholder = 'idx';
    input.title = `Greek index for "${latinWord}"`;
    input.setAttribute('aria-label', `Greek index for Latin word ${latinIndex}: ${latinWord}`);
    const defaultValue = pairs.map(({ greekIdx }) => greekIdx).join(',');
    input.value = defaultValue;
    input.dataset.defaultValue = defaultValue;
    input.addEventListener('input', onInput);

    token.append(wordEl, input);
    latinRowEl.appendChild(token);
  });
}

function measureRow(rowEl) {
  const children = [...rowEl.children];
  const minGap = parseFloat(getComputedStyle(rowEl).columnGap)
    || parseFloat(getComputedStyle(rowEl).gap)
    || 3.2;
  const tokenWidth = children.reduce((sum, child) => sum + child.offsetWidth, 0);
  const contentWidth = tokenWidth + Math.max(0, children.length - 1) * minGap;
  return { tokenWidth, contentWidth, count: children.length, minGap };
}

function updateAlignmentLayout(view) {
  const { greekRow: greekRowEl, latinRow: latinRowEl } = view;

  greekRowEl.style.marginBottom = '';
  greekRowEl.style.width = '';
  greekRowEl.style.gap = '';
  greekRowEl.style.justifyContent = '';
  latinRowEl.style.width = '';
  latinRowEl.style.gap = '';
  latinRowEl.style.justifyContent = '';

  if (!greekRowEl.childElementCount) return;

  greekRowEl.offsetHeight;

  const greek = measureRow(greekRowEl);
  const latin = measureRow(latinRowEl);
  const targetWidth = Math.max(greek.contentWidth, latin.contentWidth);

  const fitRow = (rowEl, row) => {
    rowEl.style.width = `${targetWidth}px`;

    if (row.contentWidth >= targetWidth - 0.5) {
      rowEl.style.gap = '';
      rowEl.style.justifyContent = 'flex-start';
      return;
    }

    if (row.count <= 1) {
      rowEl.style.gap = '';
      rowEl.style.justifyContent = 'center';
      return;
    }

    const expandedGap = (targetWidth - row.tokenWidth) / (row.count - 1);
    rowEl.style.gap = `${Math.max(row.minGap, expandedGap)}px`;
    rowEl.style.justifyContent = 'flex-start';
  };

  fitRow(greekRowEl, greek);
  fitRow(latinRowEl, latin);

  greekRowEl.style.marginBottom = `${Math.max(48, targetWidth * 0.06)}px`;
  greekRowEl.offsetHeight;
}

function drawAlignmentLines(view, getGreekIdxs) {
  const { canvas: canvasEl, linesSvg: svgEl, greekRow: greekRowEl, latinRow: latinRowEl } = view;
  const greekTokens = [...greekRowEl.querySelectorAll('.greek-token')];
  const latinTokens = [...latinRowEl.querySelectorAll('.latin-token')];
  const greekCount = greekTokens.length;

  const canvasRect = canvasEl.getBoundingClientRect();
  svgEl.setAttribute('width', canvasRect.width);
  svgEl.setAttribute('height', canvasRect.height);
  svgEl.setAttribute('viewBox', `0 0 ${canvasRect.width} ${canvasRect.height}`);
  svgEl.innerHTML = '';

  latinTokens.forEach((latinToken) => {
    getGreekIdxs(latinToken, greekCount).forEach((greekIdx) => {
      const greekToken = greekTokens[greekIdx];
      if (!greekToken) return;

      const from = topOf(latinToken, canvasEl);
      const to = bottomOf(greekToken.querySelector('.greek-word'), canvasEl);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', from.x);
      line.setAttribute('y1', from.y);
      line.setAttribute('x2', to.x);
      line.setAttribute('y2', to.y);
      svgEl.appendChild(line);
    });
  });
}

function renderAlignmentView(view, getGreekIdxs) {
  requestAnimationFrame(() => {
    updateAlignmentLayout(view);
    drawAlignmentLines(view, getGreekIdxs);
  });
}

function getGreekIdxsFromDataset(latinToken) {
  return latinToken.dataset.greekIdxs
    .split(',')
    .filter(Boolean)
    .map(Number);
}

function buildVerseAlignmentUI() {
  const { alignedIdxs, greekWords, latinEntries } = getAlignmentContext();

  if (!latinEntries.length) {
    verseGreekRow.replaceChildren();
    verseLatinRow.replaceChildren();
    return;
  }

  buildGreekRow(verseGreekRow, greekWords, alignedIdxs);
  buildLatinRowReadonly(verseLatinRow, latinEntries);
}

function buildAlignmentUI() {
  const { alignedIdxs, greekWords, latinEntries } = getAlignmentContext();
  const greekCount = greekWords.length;

  buildGreekRow(greekRow, greekWords, alignedIdxs);
  buildLatinRowEditable(latinRow, latinEntries, greekCount, () => {
    latinRow.querySelectorAll('.latin-token input').forEach((input) => {
      validateInput(input, greekCount);
    });
    refreshPopupAlignment();
  });
}

function renderVerseAlignment() {
  buildVerseAlignmentUI();
  renderAlignmentView(verseView, getGreekIdxsFromDataset);
}

async function loadCurrentVerse() {
  await loadAlignmentData();
  const corpus = await loadVerseCorpus();
  const ref = getSelectedRef();
  const entry = corpus.byRef.get(ref);
  const alignments = alignmentByVid.get(getVid());

  if (!entry) {
    greekInput.textContent = '';
    latinInput.value = '';
    renderVerseAlignment();
    return;
  }

  // if (alignments?.length) {
    // greekInput.textContent = greekWordsFromAlignment(alignments).join(' ');
    // latinInput.value = alignments.map(({ latinWord }) => latinWord).join(' ');
  // } else {
  greekInput.textContent = entry.greek;
  latinInput.value = entry.latin;
  // }

  renderVerseAlignment();
}

function initVerseSelector() {
  NT_BOOKS.forEach((book) => {
    bookSelect.appendChild(new Option(book.name, book.num));
  });

  setVerseSelection(0, 1, 1);

  bookSelect.addEventListener('change', async () => {
    populateChapterOptions(bookSelect.selectedIndex);
    populateVerseOptions(bookSelect.selectedIndex, 0);
    await loadCurrentVerse();
  });

  chapterSelect.addEventListener('change', async () => {
    populateVerseOptions(bookSelect.selectedIndex, Number(chapterSelect.value) - 1);
    await loadCurrentVerse();
  });

  verseSelect.addEventListener('change', loadCurrentVerse);
}

function openPopup() {
  buildAlignmentUI();
  popup.classList.add('open');
  backdrop.classList.add('open');
  renderAlignmentView(popupView, getPopupGreekIdxs);
}

function closePopup() {
  popup.classList.remove('open');
  backdrop.classList.remove('open');
  jsonOutput.classList.remove('visible');
}

function getPopupGreekIdxs(latinToken, greekCount) {
  const input = latinToken.querySelector('input');
  return validateInput(input, greekCount);
}

function refreshPopupAlignment() {
  updateAlignmentLayout(popupView);
  drawAlignmentLines(popupView, getPopupGreekIdxs);
}

function clearRealignmentInputs() {
  latinRow.querySelectorAll('.latin-token input').forEach((input) => {
    input.value = '';
    input.classList.remove('out-of-range');
  });
  jsonOutput.value = '';
  jsonOutput.classList.remove('visible');
  refreshPopupAlignment();
}

function resetRealignmentInputs() {
  const greekCount = splitWords(getGreekText()).length;
  latinRow.querySelectorAll('.latin-token input').forEach((input) => {
    input.value = input.dataset.defaultValue ?? '';
    validateInput(input, greekCount);
  });
  jsonOutput.value = '';
  jsonOutput.classList.remove('visible');
  refreshPopupAlignment();
}

function validateInput(input, greekCount) {
  const idxs = [];
  input.value.trim().split(',').forEach((part) => {
    if (part.trim() === '') return;
    const idx = Number(part);
    const inRange = Number.isInteger(idx) && idx >= 0 && idx < greekCount;
    input.classList.toggle('out-of-range', !inRange);
    if (inRange) idxs.push(idx);
  });
  return [...new Set(idxs)].sort((a, b) => a - b);
}

function buildAlignmentJson() {
  const vid = getVid();
  const greekWords = splitWords(getGreekText());
  const latinTokens = [...latinRow.querySelectorAll('.latin-token')];

  const list = latinTokens.map((token) => {
    const latinWord = token.querySelector('.latin-word').textContent;
    const input = token.querySelector('input');
    const greekIdxs = validateInput(input, greekWords.length);

    const pairs = greekIdxs.map((idx) => [idx, greekWords[idx]]);
    return { [latinWord]: pairs };
  });

  return { [vid]: list };
}

function submitAlignment() {
  try {
    const result = buildAlignmentJson();
    jsonOutput.value = JSON.stringify(result, null, 2);
    jsonOutput.classList.add('visible');
    console.log(result);
  } catch (err) {
    jsonOutput.value = err.message;
    jsonOutput.classList.add('visible');
  }
}

function bottomOf(el, container) {
  const r = el.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  return {
    x: r.left + r.width / 2 - c.left,
    y: r.bottom - c.top,
  };
}

function topOf(el, container) {
  const r = el.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  return {
    x: r.left + r.width / 2 - c.left,
    y: r.top - c.top,
  };
}

initVerseSelector();
loadCurrentVerse().catch((err) => {
  console.error('Failed to load verse data:', err);
  greekInput.textContent = 'Could not load verse data. Serve this folder over HTTP.';
});

requestBtn.addEventListener('click', openPopup);
resetBtn.addEventListener('click', resetRealignmentInputs);
clearBtn.addEventListener('click', clearRealignmentInputs);
submitBtn.addEventListener('click', submitAlignment);
popupClose.addEventListener('click', closePopup);
backdrop.addEventListener('click', closePopup);

window.addEventListener('resize', () => {
  if (popup.classList.contains('open')) refreshPopupAlignment();
  if (alignmentByVid) {
    updateAlignmentLayout(verseView);
    drawAlignmentLines(verseView, getGreekIdxsFromDataset);
  }
});

document.getElementById('alignment-scroll').addEventListener('scroll', refreshPopupAlignment);
verseAlignment.addEventListener('scroll', () => {
  drawAlignmentLines(verseView, getGreekIdxsFromDataset);
});

(function enableDrag() {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  popupHeader.addEventListener('mousedown', (e) => {
    if (e.target === popupClose) return;
    dragging = true;
    const rect = popup.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    popup.style.transform = 'none';
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.top}px`;
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    popup.style.left = `${e.clientX - offsetX}px`;
    popup.style.top = `${e.clientY - offsetY}px`;
    refreshPopupAlignment();
  });

  document.addEventListener('mouseup', () => {
    dragging = false;
  });
})();
