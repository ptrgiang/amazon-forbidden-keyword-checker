// Runs in the page's MAIN world at document_start on Google Docs/Sheets.
// Opts Google editors into extension-annotation rendering mode: the document is
// still drawn on canvas, but each text line is additionally emitted as an
// SVG <rect aria-label="…"> carrying the line text and font, which is what
// grammar/writing extensions use for inline features. Purely a local
// rendering change; no document data leaves the page.
(function () {
  try {
    window._docs_annotate_canvas_by_ext = 'kbfnbcaeplbcioakkpcpgfkobkghlhen';
    var isSheets = location.pathname.startsWith('/spreadsheets/');
    if (!isSheets) return;
    if (window.__afkcCanvasTextHookInstalled) return;
    window.__afkcCanvasTextHookInstalled = true;

    var originalFillText = CanvasRenderingContext2D.prototype.fillText;
    var originalStrokeText = CanvasRenderingContext2D.prototype.strokeText;
    var queue = [];
    var timer = 0;
    var paintPatterns = [];
    var matcherNodes = [{ next: Object.create(null), fail: 0, out: [] }];
    var configSignature = '';
    var receivedConfig = false;

    window.addEventListener('message', function (event) {
      var data = event.data;
      if (event.source !== window || !data) return;
      if (data.source === 'afkc-sheets-clear') {
        queue = [];
        return;
      }
      if (data.source === 'afkc-sheets-wake') {
        wakeEditor();
        return;
      }
      if (data.source !== 'afkc-sheets-config') return;
      if (!Array.isArray(data.patterns)) return;
      receivedConfig = true;
      var nextPatterns = data.patterns
        .filter(function (pattern) {
          return pattern && typeof pattern.key === 'string' && pattern.key.length > 0;
        })
        .slice(0, 1500)
        .sort(function (a, b) {
          return b.key.length - a.key.length;
        });
      var nextSignature = nextPatterns
        .map(function (pattern) {
          return pattern.id + ':' + pattern.key;
        })
        .join('\n');
      if (nextSignature === configSignature) return;
      paintPatterns = nextPatterns;
      configSignature = nextSignature;
      buildMatcher();
    });
    signalReady();
    [250, 1000, 2000].forEach(function (delay) {
      window.setTimeout(function () {
        if (!receivedConfig) signalReady();
      }, delay);
    });

    function signalReady() {
      window.postMessage({ source: 'afkc-sheets-ready' }, '*');
    }

    function wakeEditor() {
      var events = ['visibilitychange', 'focus', 'pageshow', 'resize'];
      for (var i = 0; i < events.length; i += 1) {
        var name = events[i];
        var target = name === 'visibilitychange' ? document : window;
        var event;
        if (name === 'pageshow') {
          event = new PageTransitionEvent('pageshow', { persisted: false });
        } else if (name === 'focus') {
          event = new FocusEvent('focus');
        } else {
          event = new Event(name);
        }
        target.dispatchEvent(event);
      }
    }

    function fontSize(font) {
      var match = /(\d+(?:\.\d+)?)px/.exec(font || '');
      return match ? Number(match[1]) : 12;
    }

    function flush() {
      timer = 0;
      if (queue.length === 0) return;
      var items = queue;
      queue = [];
      window.postMessage({ source: 'afkc-sheets-canvas', items: items, sentAt: Date.now() }, '*');
    }

    function schedule(item) {
      queue.push(item);
      if (queue.length > 1200) queue.shift();
      if (!timer) timer = window.requestAnimationFrame(flush);
    }

    function pageKey() {
      var gid = sheetGid();
      return location.pathname + '?gid=' + gid;
    }

    function sheetGid() {
      var fromSearch = /[?&]gid=([^&#]+)/.exec(location.search);
      if (fromSearch) return fromSearch[1];
      var fromHash = /[#&?]gid=([^&#]+)/.exec(location.hash);
      return fromHash ? fromHash[1] : '';
    }

    function normalizeForScan(text) {
      var norm = [];
      var map = [];
      var lastWasSpace = false;
      for (var i = 0; i < text.length; i += 1) {
        var ch = text[i];
        if (/\s/.test(ch)) {
          if (!lastWasSpace && norm.length > 0) {
            norm.push(' ');
            map.push(i);
          }
          lastWasSpace = true;
          continue;
        }
        lastWasSpace = false;
        var n = ch.normalize('NFC').toLowerCase();
        for (var j = 0; j < n.length; j += 1) {
          norm.push(n[j]);
          map.push(i);
        }
      }
      while (norm.length > 0 && norm[norm.length - 1] === ' ') {
        norm.pop();
        map.pop();
      }
      map.push(text.length);
      return { norm: norm.join(''), map: map };
    }

    function isWordChar(ch) {
      return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
    }

    function boundaryOk(norm, start, end, key) {
      var first = key[0];
      var last = key[key.length - 1];
      if (isWordChar(first) && isWordChar(norm[start - 1])) return false;
      if (isWordChar(last) && isWordChar(norm[end])) return false;
      return true;
    }

    function addPattern(patternIndex) {
      var key = paintPatterns[patternIndex].key;
      var nodeIndex = 0;
      for (var i = 0; i < key.length; i += 1) {
        var ch = key[i];
        var nextIndex = matcherNodes[nodeIndex].next[ch];
        if (nextIndex === undefined) {
          nextIndex = matcherNodes.length;
          matcherNodes.push({ next: Object.create(null), fail: 0, out: [] });
          matcherNodes[nodeIndex].next[ch] = nextIndex;
        }
        nodeIndex = nextIndex;
      }
      matcherNodes[nodeIndex].out.push(patternIndex);
    }

    function buildMatcher() {
      matcherNodes = [{ next: Object.create(null), fail: 0, out: [] }];
      for (var i = 0; i < paintPatterns.length; i += 1) {
        addPattern(i);
      }
      var queueNodes = [];
      var rootNext = matcherNodes[0].next;
      for (var ch in rootNext) {
        if (Object.prototype.hasOwnProperty.call(rootNext, ch)) {
          matcherNodes[rootNext[ch]].fail = 0;
          queueNodes.push(rootNext[ch]);
        }
      }
      for (var qi = 0; qi < queueNodes.length; qi += 1) {
        var nodeIndex = queueNodes[qi];
        var next = matcherNodes[nodeIndex].next;
        for (var edge in next) {
          if (!Object.prototype.hasOwnProperty.call(next, edge)) continue;
          var childIndex = next[edge];
          var failIndex = matcherNodes[nodeIndex].fail;
          while (failIndex !== 0 && matcherNodes[failIndex].next[edge] === undefined) {
            failIndex = matcherNodes[failIndex].fail;
          }
          var target = matcherNodes[failIndex].next[edge];
          matcherNodes[childIndex].fail = target !== undefined && target !== childIndex ? target : 0;
          if (matcherNodes[matcherNodes[childIndex].fail].out.length > 0) {
            matcherNodes[childIndex].out = matcherNodes[childIndex].out.concat(
              matcherNodes[matcherNodes[childIndex].fail].out
            );
          }
          queueNodes.push(childIndex);
        }
      }
    }

    function scanText(text) {
      if (paintPatterns.length === 0 || !text) return [];
      var normalized = normalizeForScan(text);
      var norm = normalized.norm;
      var raw = [];
      var state = 0;
      for (var i = 0; i < norm.length; i += 1) {
        var ch = norm[i];
        while (state !== 0 && matcherNodes[state].next[ch] === undefined) {
          state = matcherNodes[state].fail;
        }
        state = matcherNodes[state].next[ch] === undefined ? 0 : matcherNodes[state].next[ch];
        var out = matcherNodes[state].out;
        for (var j = 0; j < out.length; j += 1) {
          var pattern = paintPatterns[out[j]];
          var start = i - pattern.key.length + 1;
          var end = i + 1;
          if (boundaryOk(norm, start, end, pattern.key)) {
            raw.push({ start: start, end: end });
          }
        }
      }
      raw.sort(function (a, b) {
        return a.start - b.start || b.end - b.start - (a.end - a.start);
      });
      var picked = [];
      var lastEnd = -1;
      for (var r = 0; r < raw.length; r += 1) {
        if (raw[r].start >= lastEnd) {
          picked.push({
            start: normalized.map[raw[r].start],
            end: normalized.map[raw[r].end]
          });
          lastEnd = raw[r].end;
          if (picked.length >= 30) break;
        }
      }
      return picked;
    }

    function alignedTextX(ctx, x, textWidth) {
      var align = ctx.textAlign || 'start';
      var direction = ctx.direction || 'ltr';
      if (align === 'center') return x - textWidth / 2;
      if (align === 'right' || (align === 'end' && direction !== 'rtl') || (align === 'start' && direction === 'rtl')) {
        return x - textWidth;
      }
      return x;
    }

    function paintMatches(ctx, text, x, y, matches) {
      if (matches.length === 0) return;
      var size = fontSize(ctx.font);
      var totalWidth = ctx.measureText(text).width;
      var left = alignedTextX(ctx, x, totalWidth);
      var inset = 1;
      ctx.save();
      ctx.fillStyle = 'rgba(220, 38, 38, 0.16)';
      for (var i = 0; i < matches.length; i += 1) {
        var match = trimVisualMatch(text, matches[i]);
        if (!match) continue;
        var before = ctx.measureText(text.slice(0, match.start)).width;
        var rawWidth = ctx.measureText(text.slice(match.start, match.end)).width;
        var width = Math.max(2, rawWidth - inset * 2);
        var top = y - size;
        var height = Math.max(12, size * 1.2);
        ctx.fillRect(left + before + inset, top, width, height);
      }
      ctx.fillStyle = 'rgba(220, 38, 38, 0.78)';
      for (var j = 0; j < matches.length; j += 1) {
        var underlineMatch = trimVisualMatch(text, matches[j]);
        if (!underlineMatch) continue;
        var underlineBefore = ctx.measureText(text.slice(0, underlineMatch.start)).width;
        var underlineRawWidth = ctx.measureText(text.slice(underlineMatch.start, underlineMatch.end)).width;
        var underlineWidth = Math.max(2, underlineRawWidth - inset * 2);
        ctx.fillRect(left + underlineBefore + inset, y + 1, underlineWidth, 2);
      }
      ctx.restore();
    }

    function trimVisualMatch(text, match) {
      var start = match.start;
      var end = match.end;
      while (start < end && /\s/.test(text[start] || '')) start += 1;
      while (end > start && /\s/.test(text[end - 1] || '')) end -= 1;
      return start < end ? { start: start, end: end } : null;
    }

    function capture(ctx, text, x, y) {
      if (typeof text !== 'string' && typeof text !== 'number') return;
      var value = String(text);
      var trimmed = value.trim();
      if (!trimmed || value.length > 500) return;
      var canvas = ctx.canvas;
      if (!canvas || !canvas.getBoundingClientRect) return;
      var matches = scanText(value);
      if (matches.length === 0) return matches;
      var rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > innerHeight) return;
      var transform = ctx.getTransform ? ctx.getTransform() : null;
      var px = x;
      var py = y;
      if (transform) {
        px = transform.a * x + transform.c * y + transform.e;
        py = transform.b * x + transform.d * y + transform.f;
      }
      var scaleX = rect.width / (canvas.width || rect.width);
      var scaleY = rect.height / (canvas.height || rect.height);
      var size = fontSize(ctx.font) * Math.max(0.8, Math.min(2, Math.abs(scaleY || 1)));
      var measuredWidth = ctx.measureText(value).width;
      var width = Math.max(4, measuredWidth * Math.abs(scaleX || 1));
      var localLeft = alignedTextX(ctx, x, measuredWidth);
      var screenLeft = transform ? transform.a * localLeft + transform.c * y + transform.e : localLeft;
      var left = rect.left + screenLeft * scaleX;
      var top = rect.top + py * scaleY - size;
      if (left > innerWidth || left + width < 0 || top > innerHeight || top + size < 0) return;
      var item = {
        text: value,
        left: left,
        top: top,
        width: width,
        height: Math.max(12, size * 1.3),
        pageKey: pageKey(),
        painted: true
      };
      schedule(item);
      return matches;
    }

    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      var result = originalFillText.apply(this, arguments);
      var matches = capture(this, text, x, y);
      if (matches && matches.length > 0) paintMatches(this, String(text), x, y, matches);
      return result;
    };
    CanvasRenderingContext2D.prototype.strokeText = function (text, x, y, maxWidth) {
      var result = originalStrokeText.apply(this, arguments);
      var matches = capture(this, text, x, y);
      if (matches && matches.length > 0) paintMatches(this, String(text), x, y, matches);
      return result;
    };
  } catch (e) {
    // The editor simply stays in plain canvas mode.
  }
})();
